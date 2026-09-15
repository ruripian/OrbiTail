/**
 * 실시간 협업 서버 (Hocuspocus)
 *
 * 여기가 이 구조 변경의 요점이다. 전에는 Django(`apps/documents/yroom.py`)가 Yjs 바이트를
 * 중계·보관만 하고 **문서가 무엇인지는 몰랐다.** 그래서 서버가 문서를 읽거나 고칠 방법이 없었고,
 * 검색은 HTML 문자열을 뒤져야 했고, content_html 은 브라우저가 2초마다 덮어쓰는 사본이었다.
 *
 * 이 서버는 프론트가 쓰는 **바로 그 스키마**(`src/components/documents/doc-schema.ts`)를
 * 그대로 불러 쓴다. 스키마를 다른 언어로 다시 구현하지 않았기 때문에 둘이 어긋날 여지가 없다 —
 * 그러라고 frontend 패키지 안에 두었다(node_modules 도 TipTap 버전도 한 벌).
 *
 * 병합은 여전히 Yjs 가 한다. 서버가 문서를 "알게" 됐을 뿐, 동시편집 알고리즘을 직접 떠안지 않는다.
 */

/* ── DOM 셰임 ──
   TipTap 은 HTML 을 읽고 쓸 때 ProseMirror 의 DOMParser·DOMSerializer 를 쓴다. 둘 다 브라우저
   API 라 Node 에는 없다. 여기서 최소한의 전역만 채워 준다 — 다른 import 보다 **먼저** 해야
   TipTap 이 로드되는 시점에 이미 준비돼 있다. */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const g = globalThis as unknown as Record<string, unknown>;
g.window ??= dom.window;
g.document ??= dom.window.document;
g.DOMParser ??= dom.window.DOMParser;
g.HTMLElement ??= dom.window.HTMLElement;
g.Node ??= dom.window.Node;
g.navigator ??= dom.window.navigator;

import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { getSchema, getHTMLFromFragment, generateJSON } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { docExtensions } from "../src/components/documents/doc-schema";

const PORT = Number(process.env.COLLAB_PORT || 1234);
const API_BASE = process.env.COLLAB_API_BASE || "http://backend:8000/api";
const SHARED_SECRET = process.env.COLLAB_SHARED_SECRET || "";

if (!SHARED_SECRET) {
  // 비밀값이 없으면 저장이 전부 403 으로 조용히 실패한다. 그 상태로 뜨느니 즉시 죽는 게 낫다.
  console.error("[collab] COLLAB_SHARED_SECRET 이 비어 있습니다. 저장이 불가능하므로 시작하지 않습니다.");
  process.exit(1);
}

/* 협업 문서이므로 collab: true — StarterKit 의 undoRedo 가 꺼진다.
   스키마 자체는 같지만(doc-schema 테스트가 보장), 프론트와 같은 설정으로 만든다. */
const extensions = docExtensions({ collab: true });
const schema = getSchema(extensions);

/** TipTap Collaboration 이 본문을 담는 기본 조각 이름 */
const FRAGMENT = "default";

function internalHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", "X-Collab-Secret": SHARED_SECRET };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return Buffer.from(binary, "binary").toString("base64");
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** Y.Doc → 브라우저가 저장하던 것과 같은 HTML */
function renderHTML(doc: Y.Doc): string {
  const node = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), schema);
  return getHTMLFromFragment(node.content, schema);
}

const server = new Server({
  port: PORT,
  address: "0.0.0.0",   // 컨테이너 안. 밖으로는 리버스 프록시만 통과한다.

  /* 연결 허용 여부는 Django 가 판정한다 — 권한 규칙이 두 곳에 생기면 반드시 어긋난다.
     사용자 본인의 JWT 를 그대로 넘겨 물어본다. */
  async onAuthenticate({ token, documentName, connectionConfig }) {
    const res = await fetch(`${API_BASE}/internal/collab/documents/${documentName}/auth/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error("forbidden");
    }
    const data = (await res.json()) as { can_edit?: boolean; user?: { id: string; name: string } };
    if (!data.can_edit) {
      // 읽기 권한만 있는 사람은 붙되 쓰지 못한다 — 권한 판정은 Django 한 곳에만 있다
      connectionConfig.readOnly = true;
    }
    return { user: data.user };
  },

  async onLoadDocument({ documentName, document }) {
    const res = await fetch(`${API_BASE}/internal/collab/documents/${documentName}/state/`, {
      headers: internalHeaders(),
    });
    if (!res.ok) {
      console.error(`[collab] ${documentName} 상태를 읽지 못했습니다 (${res.status})`);
      return document;
    }
    const data = (await res.json()) as { yjs_base64?: string; content_html?: string };

    if (data.yjs_base64) {
      Y.applyUpdate(document, base64ToBytes(data.yjs_base64));
      return document;
    }

    /* Yjs 상태가 아직 없는 문서 — 저장된 HTML 로 씨를 뿌린다.
       전에는 이 일을 "먼저 접속한 브라우저"가 했고, 동시에 들어오면 누가 뿌릴지 겨루는 문제가
       있어 300ms 지연까지 넣어야 했다. 서버가 하면 그 경합 자체가 없다. */
    const html = (data.content_html || "").trim();
    if (html) {
      const json = generateJSON(html, extensions);
      prosemirrorJSONToYXmlFragment(schema, json, document.getXmlFragment(FRAGMENT));
    }
    return document;
  },

  /* 편집이 멎으면 Yjs 상태와 HTML 을 **한 번에** 저장한다.
     둘이 같은 시점에 같은 곳에서 나오므로, 예전처럼 사본이 최대 2초 뒤처지는 일이 없다. */
  async onStoreDocument({ documentName, document }) {
    let html = "";
    try {
      html = renderHTML(document);
    } catch (err) {
      /* HTML 을 못 만들더라도 Yjs 상태는 반드시 저장한다 — 그쪽이 원본이다 */
      console.error(`[collab] ${documentName} HTML 생성 실패:`, err);
    }
    const res = await fetch(`${API_BASE}/internal/collab/documents/${documentName}/state/`, {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify({
        yjs_base64: bytesToBase64(Y.encodeStateAsUpdate(document)),
        ...(html ? { content_html: html } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`[collab] ${documentName} 저장 실패 (${res.status})`);
    }
  },
});

server.listen().then(() => {
  console.log(`[collab] Hocuspocus 시작 — 포트 ${PORT}, 백엔드 ${API_BASE}`);
});
