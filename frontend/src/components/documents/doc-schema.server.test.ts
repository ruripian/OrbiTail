import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { getSchema, getHTMLFromFragment } from "@tiptap/core";
import { docExtensions } from "./doc-schema";
import fixtures from "./__fixtures__/yjs-docs.json";

/**
 * 서버가 브라우저와 같은 문서를 보는지 — 이 프로젝트에서 가장 중요한 한 가지.
 *
 * 고정 자료는 **실제 DB 에서 뽑은 것**이다. `yjs_state` 는 브라우저가 협업하며 쌓은 바이너리,
 * `content_html` 은 그 브라우저가 뽑아낸 HTML. 여기서는 브라우저 없이 공용 스키마만으로
 * 같은 HTML 이 나오는지 본다.
 *
 * 이게 통과해야 실시간 서버(Hocuspocus)가 문서를 읽고 쓸 수 있다 —
 * 서버가 만든 HTML 이 브라우저가 만든 것과 다르면, 저장할 때마다 본문이 조금씩 달라진다.
 */
describe("서버측 문서 변환", () => {
  const schema = getSchema(docExtensions({ collab: true }));

  /* Buffer 대신 atob — 이 저장소에는 @types/node 가 없어 빌드(tsc -b)에서 Buffer 가 타입 에러가 난다 */
  function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** 협업 문서의 본문은 Y.Doc 의 "default" XmlFragment 에 들어 있다 (TipTap Collaboration 기본값) */
  function renderFromYjs(base64: string): string {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, base64ToBytes(base64));
    const node = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment("default"), schema);
    return getHTMLFromFragment(node.content, schema);
  }

  it.each(fixtures.map((f) => [f.title, f] as const))(
    "%s — Y.Doc 에서 뽑은 HTML 이 브라우저가 저장한 것과 같다",
    (_title, fixture) => {
      expect(renderFromYjs(fixture.yjs_base64)).toBe(fixture.content_html);
    },
  );

  it("고정 자료가 비어 있지 않다", () => {
    // 자료가 사라지면 위 테스트가 0건으로 조용히 통과한다
    expect(fixtures.length).toBeGreaterThan(0);
  });
});
