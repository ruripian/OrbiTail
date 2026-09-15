/**
 * 문서 스키마 — 노드·마크 정의만. React·DOM·브라우저 API 없음.
 *
 * 왜 떼어냈나: 실시간 서버(Hocuspocus)가 문서를 **읽고 쓸 수 있으려면** 서버도 같은 스키마를
 * 알아야 한다. 스키마를 파이썬으로 다시 구현하면 두 언어에 같은 문법이 생겨 영원히 어긋날
 * 위험을 안는다 — 그래서 Node 쪽 서버가 이 파일을 그대로 불러 쓴다.
 *
 * 규칙 두 가지. 어기면 서버에서 import 가 터진다.
 *   1) 이 파일에서 React·lucide·DOM 전역(window/document)을 쓰지 않는다.
 *      `parseHTML` 안의 `HTMLElement` 는 타입일 뿐이고, 그 콜백은 HTML 을 파싱할 때만 실행된다
 *      (서버는 Y.Doc → JSON → HTML 방향만 쓰므로 실행되지 않는다).
 *   2) 노드를 새로 만들면 반드시 여기에 넣는다. 에디터는 이 목록을 받아 노드뷰만 덧입히므로,
 *      여기 없는 노드는 에디터에도 없다 — 한쪽에만 추가되는 사고가 구조적으로 막힌다.
 */

import { Node, Mark, Extension, mergeAttributes } from "@tiptap/core";
import type { SingleCommands } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import LinkExt from "@tiptap/extension-link";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Underline } from "@tiptap/extension-underline";
import { Highlight } from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { TextAlign } from "@tiptap/extension-text-align";
import { Superscript } from "@tiptap/extension-superscript";
import { Subscript } from "@tiptap/extension-subscript";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { MathExtension } from "@aarkue/tiptap-math-extension";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

export type CalloutKind = "info" | "success" | "warning" | "danger";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (kind?: CalloutKind) => ReturnType;
    };
    toggleBlock: {
      setToggle: () => ReturnType;
    };
    commentMark: {
      setCommentMark: (threadId: string) => ReturnType;
      unsetCommentMark: () => ReturnType;
    };
  }
}

/** 첨부 카드 라벨용 — renderHTML 안에서 쓰므로 스키마와 같은 자리에 둔다 */
export function formatFileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── 댓글 마크 ── */
export const CommentMarkSchema = Mark.create({
  name: "comment",
  exitable: true,
  inclusive: false,
  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-thread-id"),
        renderHTML: (attrs: Record<string, any>) =>
          attrs.threadId ? { "data-thread-id": attrs.threadId } : {},
      },
    };
  },
  parseHTML() { return [{ tag: "span[data-comment-thread]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, {
      "data-comment-thread": "true",
      class: "doc-comment-mark",
    }), 0];
  },
  addCommands() {
    return {
      setCommentMark: (threadId: string) => ({ commands }) => commands.setMark(this.name, { threadId }),
      unsetCommentMark: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

/* ── 이미지 ── */
export const ImageNodeSchema = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src:   { default: null },
      alt:   { default: null },
      width: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-width") || (el as HTMLImageElement).style.width || null },
      align: { default: "center", parseHTML: (el: HTMLElement) => el.getAttribute("data-align") || "center" },
    };
  },
  parseHTML() { return [{ tag: "img[src]" }]; },
  renderHTML({ HTMLAttributes }) {
    const { width, align, ...rest } = HTMLAttributes;
    /* HTML로 직렬화될 때는 NodeView 없이 유지되도록 data-* 속성으로 원본 메타 보존 */
    const style: string[] = [];
    if (width) style.push(`width:${width}`);
    if (align === "left")   style.push("margin:0 auto 0 0");
    else if (align === "right") style.push("margin:0 0 0 auto");
    else style.push("margin:0 auto");
    style.push("display:block");
    return ["img", mergeAttributes(rest, {
      "data-width": width || undefined,
      "data-align": align || undefined,
      class: "doc-img",
      style: style.join(";"),
    })];
  },
});

/* ── 비디오 ── */
export const VideoNodeSchema = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      filename: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-filename") },
    };
  },
  parseHTML() {
    return [
      { tag: "video[src]" },
      { tag: "div[data-node=\"video\"]", getAttrs: (el) => ({
        src: (el as HTMLElement).getAttribute("data-src"),
        filename: (el as HTMLElement).getAttribute("data-filename"),
      }) },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const { src, filename } = HTMLAttributes;
    return ["div", {
      "data-node": "video",
      "data-src": src,
      "data-filename": filename ?? undefined,
      class: "doc-video",
    }, ["video", { src, controls: "controls", preload: "metadata" }]];
  },
});

/* ── PDF ── */
export const PdfNodeSchema = Node.create({
  name: "pdf",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      filename: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-filename") },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-node=\"pdf\"]", getAttrs: (el) => ({
      src: (el as HTMLElement).getAttribute("data-src"),
      filename: (el as HTMLElement).getAttribute("data-filename"),
    }) }];
  },
  renderHTML({ HTMLAttributes }) {
    const { src, filename } = HTMLAttributes;
    return ["div", {
      "data-node": "pdf",
      "data-src": src,
      "data-filename": filename ?? undefined,
      class: "doc-pdf",
    },
      ["div", { class: "doc-pdf-head" },
        ["span", { class: "doc-pdf-name" }, filename ?? "document.pdf"],
        ["a", { href: src, target: "_blank", rel: "noreferrer", class: "doc-pdf-open" }, "Open"],
      ],
      ["iframe", { src, class: "doc-pdf-frame" }],
    ];
  },
});

/* ── 첨부 카드 ── */
export const AttachmentNodeSchema = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      filename: { default: null },
      size: { default: null, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-size")) || null },
      mime: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-mime") },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-node=\"attachment\"]", getAttrs: (el) => ({
      src: (el as HTMLElement).getAttribute("data-src"),
      filename: (el as HTMLElement).getAttribute("data-filename"),
      size: Number((el as HTMLElement).getAttribute("data-size")) || null,
      mime: (el as HTMLElement).getAttribute("data-mime"),
    }) }];
  },
  renderHTML({ HTMLAttributes }) {
    const { src, filename, size, mime } = HTMLAttributes;
    const sizeLabel = typeof size === "number" ? formatFileSize(size) : "";
    return ["div", {
      "data-node": "attachment",
      "data-src": src,
      "data-filename": filename ?? undefined,
      "data-size": size ?? undefined,
      "data-mime": mime ?? undefined,
      class: "doc-attachment",
    },
      ["a", { href: src, download: filename ?? "file", target: "_blank", rel: "noreferrer", class: "doc-attachment-link" },
        ["span", { class: "doc-attachment-name" }, filename ?? "file"],
        sizeLabel ? ["span", { class: "doc-attachment-size" }, sizeLabel] : "",
      ],
    ];
  },
});

/* ── 콜아웃 ── */
export const CalloutSchema = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      kind: { default: "info", parseHTML: (el: HTMLElement) => el.getAttribute("data-kind") || "info" },
    };
  },
  parseHTML() { return [{ tag: "div[data-node=\"callout\"]" }]; },
  renderHTML({ HTMLAttributes }) {
    const { kind } = HTMLAttributes;
    return ["div", mergeAttributes(HTMLAttributes, {
      "data-node": "callout",
      "data-kind": kind,
      class: `doc-callout doc-callout-${kind ?? "info"}`,
    }), 0];
  },
  addCommands() {
    return {
      /* 슬래시 메뉴에서는 항상 새 callout 삽입. kind 변경은 CalloutView 내부 메뉴로 */
      setCallout: (kind: CalloutKind = "info") => ({ commands }: { commands: SingleCommands }) =>
        commands.insertContent({
          type: "callout",
          attrs: { kind },
          content: [{ type: "paragraph" }],
        }),
    };
  },
});

/* ── 접기 ── */
export const ToggleSchema = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      open: { default: true, parseHTML: (el: HTMLElement) => el.getAttribute("data-open") !== "false" },
    };
  },
  parseHTML() { return [{ tag: "div[data-node=\"toggle\"]" }]; },
  renderHTML({ HTMLAttributes }) {
    const { open } = HTMLAttributes;
    return ["div", mergeAttributes(HTMLAttributes, {
      "data-node": "toggle",
      "data-open": open === false ? "false" : "true",
      class: "doc-toggle",
    }), 0];
  },
  addCommands() {
    return {
      setToggle: () => ({ commands }: { commands: SingleCommands }) =>
        commands.insertContent({
          type: "toggle",
          attrs: { open: true },
          content: [{ type: "paragraph" }],
        }),
    };
  },
});

/* ── 멘션 (사용자 · 문서 · 태그) ── */
export const MentionSchema = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      kind:       { default: "user",  parseHTML: (el: HTMLElement) => el.getAttribute("data-kind") || "user" },
      id:         { default: "",      parseHTML: (el: HTMLElement) => el.getAttribute("data-id") || "" },
      label:      { default: "",      parseHTML: (el: HTMLElement) => el.getAttribute("data-label") || "" },
      identifier: { default: "",      parseHTML: (el: HTMLElement) => el.getAttribute("data-identifier") || "" },
      /* 문서 멘션이 가리키는 문서의 스페이스. 문서 검색은 워크스페이스 전체를 훑으므로
         다른 스페이스 문서도 링크할 수 있는데, 이게 없으면 현재 스페이스로 잘못 이동한다.
         과거에 삽입된 멘션에는 없으므로 비어 있을 수 있다 — 그때는 현재 스페이스로 폴백. */
      space:      { default: "",      parseHTML: (el: HTMLElement) => el.getAttribute("data-space") || "" },
    };
  },
  parseHTML() { return [{ tag: "span[data-mention]" }]; },
  renderHTML({ HTMLAttributes }) {
    const { kind, id, label, identifier, space } = HTMLAttributes;
    const display = kind === "user" ? `@${label}` : kind === "issue" ? `${identifier} ${label}` : `[[${label}]]`;
    return ["span", {
      "data-mention": "", "data-kind": kind, "data-id": id, "data-label": label, "data-identifier": identifier ?? "",
      "data-space": space ?? "",
      class: `doc-mention doc-mention-${kind}`,
    }, display];
  },
});

/* ── 이슈 카드 ── */
export const IssueCardSchema = Node.create({
  name: "issueCard",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      id:         { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-id") || "" },
      identifier: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-identifier") || "" },
      label:      { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-label") || "" },
    };
  },
  parseHTML() {
    return [
      { tag: "div[data-issue-card]" },
      /* legacy: 기존에 inline mention kind=issue로 저장된 건 자동으로 카드로 업그레이드 */
      {
        tag: "span[data-mention]",
        priority: 60,
        getAttrs: (el) => {
          const kind = (el as HTMLElement).getAttribute("data-kind");
          if (kind !== "issue") return false;
          return {
            id: (el as HTMLElement).getAttribute("data-id") || "",
            identifier: (el as HTMLElement).getAttribute("data-identifier") || "",
            label: (el as HTMLElement).getAttribute("data-label") || "",
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const { id, identifier, label } = HTMLAttributes;
    return ["div", {
      "data-issue-card": "", "data-id": id, "data-identifier": identifier, "data-label": label,
      class: "doc-issue-card",
    }, `${identifier ?? ""} ${label ?? ""}`];
  },
});

/* ── 수식 ──
   지금 docExtensions 에 등록하지 않는다(수식 렌더는 MathExtension 이 맡는다).
   과거 문서에 이 형태로 저장된 노드가 있어 정의만 남겨 둔다 — 등록이 필요해지면 목록에 넣으면 된다. */
export const MathInlineSchema = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() { return { latex: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-latex") } }; },
  parseHTML() { return [{ tag: "span[data-math-inline]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-math-inline": "", "data-latex": HTMLAttributes.latex, class: "doc-math" }, HTMLAttributes.latex];
  },
});

export const MathBlockSchema = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes() { return { latex: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-latex") } }; },
  parseHTML() { return [{ tag: "div[data-math-block]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-math-block": "", "data-latex": HTMLAttributes.latex, class: "doc-math doc-math-block" }, HTMLAttributes.latex];
  },
});

/* ── Mermaid ── */
export const MermaidSchema = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  addAttributes() {
    return { code: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-code") || "" } };
  },
  parseHTML() { return [{ tag: "div[data-mermaid]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-mermaid": "", "data-code": HTMLAttributes.code, class: "doc-mermaid" }];
  },
});

/* ── 칼럼 레이아웃 ── */
export const ColumnListSchema = Node.create({
  name: "columnList",
  group: "block",
  content: "column+",
  parseHTML() { return [{ tag: "div[data-column-list]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column-list": "", class: "doc-columns" }), 0];
  },
  addCommands() {
    return {
      setColumns: (n: number) => ({ commands }: any) => {
        const cols = Array.from({ length: n }, () => ({
          type: "column",
          content: [{ type: "paragraph" }],
        }));
        return commands.insertContent({ type: "columnList", content: cols });
      },
    } as any;
  },
});

export const ColumnSchema = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() { return [{ tag: "div[data-column]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "", class: "doc-column" }), 0];
  },
});

/* ── 상태 배지 ── */
export const StatusSchema = Node.create({
  name: "status",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      label: { default: "Status", parseHTML: (el: HTMLElement) => el.getAttribute("data-label") || "Status" },
      color: { default: "gray", parseHTML: (el: HTMLElement) => el.getAttribute("data-color") || "gray" },
    };
  },
  parseHTML() { return [{ tag: "span[data-status]" }]; },
  renderHTML({ HTMLAttributes }) {
    const { label, color } = HTMLAttributes;
    return ["span", { "data-status": "", "data-label": label, "data-color": color, class: `doc-status doc-status-${color}` }, `● ${label}`];
  },
});

/* ── 하위 문서 목록 ── */
export const SubpagesSchema = Node.create({
  name: "subpages",
  group: "block",
  atom: true,
  parseHTML() { return [{ tag: "div[data-subpages]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-subpages": "", class: "doc-subpages" }), ""];
  },
});

/* ── 북마크 카드 ── */
export const BookmarkCardSchema = Node.create({
  name: "bookmarkCard",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      url:         { default: "" },
      title:       { default: "" },
      description: { default: "" },
      image:       { default: "" },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="bookmark-card"]' }]; },
  renderHTML({ HTMLAttributes, node }) {
    return ["div", mergeAttributes(HTMLAttributes, {
      "data-type": "bookmark-card",
      "data-url": node.attrs.url,
      "data-title": node.attrs.title,
    }), `🔗 ${node.attrs.title || node.attrs.url}`];
  },
});

/* ── 이미지 갤러리 ── */
export const ImageGallerySchema = Node.create({
  name: "imageGallery",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      items:   { default: [] },
      columns: { default: 3 },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="image-gallery"]' }]; },
  renderHTML({ HTMLAttributes, node }) {
    const items = (node.attrs.items as { url: string; alt?: string }[]) || [];
    return ["div", mergeAttributes(HTMLAttributes, {
      "data-type": "image-gallery",
      "data-columns": String(node.attrs.columns),
    }), ...items.map((it) => ["img", { src: it.url, alt: it.alt || "" }] as any)];
  },
});

/* ── 이슈 뷰 임베드 ── */
const EMBED_VIEW_LABELS: Record<string, string> = {
  board: "보드", table: "테이블", calendar: "캘린더",
};

export const IssueViewEmbedSchema = Node.create({
  name: "issueViewEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      projectId: { default: "" },
      viewMode:  { default: "board" },
      filters:   { default: {} },
      height:    { default: 480 },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="issue-view-embed"]' }]; },
  renderHTML({ HTMLAttributes, node }) {
    return ["div", mergeAttributes(HTMLAttributes, {
      "data-type": "issue-view-embed",
      "data-project-id": node.attrs.projectId,
      "data-view-mode": node.attrs.viewMode,
      "data-filters": JSON.stringify(node.attrs.filters || {}),
    }), `[이슈 ${EMBED_VIEW_LABELS[node.attrs.viewMode as string] ?? "뷰"} 임베드]`];
  },
});

/**
 * 문서 스키마를 이루는 확장 목록 — **서버와 에디터가 같이 쓰는 단 하나의 원본**.
 *
 * 에디터는 이 배열을 받아 노드뷰·입력규칙 같은 브라우저 전용 확장을 덧입힌다.
 * 서버는 그대로 써서 Y.Doc ↔ JSON ↔ HTML 을 변환한다.
 *
 * @param collab 협업 모드면 StarterKit 의 undoRedo 를 끈다 — Yjs UndoManager 와 겹치면 히스토리가 깨진다.
 */
export function docExtensions(opts: { collab?: boolean } = {}): Extension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
      ...(opts.collab ? { undoRedo: false as const } : {}),
    }),
    LinkExt.configure({ openOnClick: false }),
    CodeBlockLowlight.configure({ lowlight }),
    Underline,
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Superscript,
    Subscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({
      resizable: true,
      cellMinWidth: 60,
      allowTableNodeSelection: false,
      HTMLAttributes: { class: "doc-table" },
    }),
    TableRow,
    TableHeader,
    TableCell,
    MathExtension.configure({ evaluation: false, addInlineMath: true }),
    CalloutSchema,
    ToggleSchema,
    MermaidSchema,
    ColumnListSchema,
    ColumnSchema,
    StatusSchema,
    SubpagesSchema,
    IssueViewEmbedSchema,
    BookmarkCardSchema,
    ImageGallerySchema,
    MentionSchema,
    IssueCardSchema,
    CommentMarkSchema,
    ImageNodeSchema,
    VideoNodeSchema,
    PdfNodeSchema,
    AttachmentNodeSchema,
  ] as unknown as Extension[];
}
