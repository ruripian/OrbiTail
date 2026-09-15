import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { docExtensions } from "./doc-schema";

/**
 * 스키마 잠금 — 노드·마크 이름 목록을 고정한다.
 *
 * 이 목록이 곧 "서버와 브라우저가 합의한 문서 문법"이다. 실수로 노드가 빠지면 그 노드가 든
 * 기존 문서가 열릴 때 조용히 사라진다. 의도해서 바꿨다면 이 테스트를 같이 고치면 되고,
 * 의도하지 않았다면 여기서 걸린다.
 */
const EXPECTED_NODES = [
  "blockquote", "bulletList", "callout", "codeBlock", "column", "columnList",
  "doc", "hardBreak", "heading", "horizontalRule", "image", "imageGallery", "inlineMath",
  "issueCard", "issueViewEmbed", "listItem", "mention", "mermaid",
  "orderedList", "paragraph", "status", "subpages", "table", "tableCell",
  "tableHeader", "tableRow", "taskItem", "taskList", "text", "toggle",
  "attachment", "bookmarkCard", "pdf", "video",
];

const EXPECTED_MARKS = [
  "bold", "code", "comment", "highlight", "italic", "link", "strike",
  "subscript", "superscript", "textStyle", "underline",
];

describe("문서 스키마", () => {
  const schema = getSchema(docExtensions());

  it("노드 목록이 고정돼 있다", () => {
    const names = Object.keys(schema.nodes).sort();
    expect(names).toEqual([...EXPECTED_NODES].sort());
  });

  it("마크 목록이 고정돼 있다", () => {
    const names = Object.keys(schema.marks).sort();
    expect(names).toEqual([...EXPECTED_MARKS].sort());
  });

  it("협업 모드에서도 스키마가 같다", () => {
    // undoRedo 는 플러그인이라 스키마에 영향이 없어야 한다 — 다르면 서버와 브라우저가 갈라진다
    const collabSchema = getSchema(docExtensions({ collab: true }));
    expect(Object.keys(collabSchema.nodes).sort()).toEqual(Object.keys(schema.nodes).sort());
    expect(Object.keys(collabSchema.marks).sort()).toEqual(Object.keys(schema.marks).sort());
  });

  it("React 를 끌어들이지 않는다", async () => {
    // 서버(Node)가 이 모듈을 그대로 불러 쓴다. 노드뷰가 섞여 들어오면 거기서 터진다.
    const mod = await import("./doc-schema?raw");
    expect(mod.default).not.toMatch(/ReactNodeViewRenderer|from "react"/);
  });
});
