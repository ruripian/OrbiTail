/**
 * 문서 에디터 — Heading, 서식, 코드블록, 이미지, 파일 첨부, / 명령어
 */

import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from "react";
import { createPortal } from "react-dom";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";
import { MathExtension } from "@aarkue/tiptap-math-extension";
import { useAuthStore } from "@/stores/authStore";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent, NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer, type NodeViewProps, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { computePosition, autoUpdate, offset, flip, shift } from "@floating-ui/dom";
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
import { CharacterCount } from "@tiptap/extension-character-count";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import { SearchAndReplace } from "@memfoldai/tiptap-search-and-replace";
import { Node, mergeAttributes } from "@tiptap/core";
import { common, createLowlight } from "lowlight";
import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Quote, Minus, Heading1, Heading2, Heading3,
  Link as LinkIcon, CodeSquare, Paperclip,
  Download, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  FileText, File as FileIcon, FileArchive, FileSpreadsheet,
  Underline as UnderlineIcon, Highlighter, Palette, ChevronDown, ChevronRight,
  Info, AlertTriangle, CheckCircle2, XCircle, ListChecks, Table as TableIcon,
  SquareChevronDown, Calendar, Smile,
  Search, X, ArrowUp, ArrowDown, Replace,
  Sigma, Workflow, Columns2, Columns3, Columns4, Tag, FolderTree,
  AtSign, User as UserIcon, Hash,
  Rows3, Columns as ColumnsIcon, Merge, Split, Trash2, ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

const lowlight = createLowlight(common);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── 이미지 노드 (React NodeView + 플로팅 툴바) ── */
type ImgAlign = "left" | "center" | "right";

function ImageNodeView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const src: string   = node.attrs.src;
  const alt: string   = node.attrs.alt ?? "";
  const width: string = node.attrs.width ?? "";
  const align: ImgAlign = (node.attrs.align ?? "center") as ImgAlign;
  const [tbOpen, setTbOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const isEditable = editor.isEditable;
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const tbRef  = useRef<HTMLDivElement>(null);

  /* 선택 해제되면 툴바 닫기 */
  useEffect(() => { if (!selected) setTbOpen(false); }, [selected]);

  /* Floating UI: 툴바 위치 자동 계산 + 뷰포트 벗어나면 flip/shift */
  useEffect(() => {
    if (!tbOpen || !imgRef.current || !tbRef.current) return;
    const ref = imgRef.current;
    const float = tbRef.current;
    return autoUpdate(ref, float, () => {
      computePosition(ref, float, {
        placement: "top",
        middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        Object.assign(float.style, { left: `${x}px`, top: `${y}px` });
      });
    });
  }, [tbOpen, width, align]);

  const setWidth = (w: string) => updateAttributes({ width: w });
  const setAlign = (a: ImgAlign) => updateAttributes({ align: a });

  /* 마우스 드래그 리사이즈 — 4개 코너 핸들. dir로 x움직임 부호 결정 */
  const boxRef = useRef<HTMLDivElement>(null);
  const startResize = (e: React.MouseEvent, dir: "left" | "right") => {
    e.preventDefault();
    e.stopPropagation();
    if (!boxRef.current) return;
    const startX = e.clientX;
    const startWidthPx = boxRef.current.getBoundingClientRect().width;
    const parent = wrapRef.current;
    const parentWidth = parent?.getBoundingClientRect().width ?? startWidthPx;
    setResizing(true);
    setTbOpen(false);

    const onMove = (ev: MouseEvent) => {
      const delta = (ev.clientX - startX) * (dir === "right" ? 1 : -1);
      const next = Math.max(80, Math.min(parentWidth, startWidthPx + delta));
      const pct = Math.max(10, Math.min(100, Math.round((next / parentWidth) * 100)));
      updateAttributes({ width: `${pct}%` });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizing(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /* 구조: wrapper(full block) > box(width=attrs.width, margin=정렬) > img(width 100%) */
  const boxStyle: React.CSSProperties = {
    width: width || "100%",
    marginLeft:  align === "right" ? "auto" : align === "center" ? "auto" : 0,
    marginRight: align === "left"  ? "auto" : align === "center" ? "auto" : 0,
  };

  return (
    <NodeViewWrapper
      as="div"
      data-drag-handle
      ref={wrapRef as any}
      className="doc-img-wrap"
    >
      <div ref={boxRef} className="doc-img-box" style={boxStyle}>
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          className={cn("doc-img", selected && "is-selected")}
          onClick={(e) => { if (isEditable) { e.preventDefault(); setTbOpen((v) => !v); } }}
        />
        {isEditable && selected && (
          <>
            <span className="doc-img-resize doc-img-resize-tl" onMouseDown={(e) => startResize(e, "left")}  title="Resize" />
            <span className="doc-img-resize doc-img-resize-tr" onMouseDown={(e) => startResize(e, "right")} title="Resize" />
            <span className="doc-img-resize doc-img-resize-bl" onMouseDown={(e) => startResize(e, "left")}  title="Resize" />
            <span className="doc-img-resize doc-img-resize-br" onMouseDown={(e) => startResize(e, "right")} title="Resize" />
          </>
        )}
        {resizing && (
          <div className="doc-img-size-badge" contentEditable={false}>
            {width || "auto"}
          </div>
        )}
      </div>
      {isEditable && tbOpen && selected && createPortal(
        <div
          ref={tbRef}
          contentEditable={false}
          style={{ position: "fixed", top: 0, left: 0, zIndex: 100 }}
          className="flex items-center gap-0.5 rounded-xl border bg-popover shadow-xl px-1 py-1"
          onMouseDown={(e) => e.preventDefault()}
        >
          {(["25%", "50%", "75%", "100%"] as const).map((w) => (
            <button key={w} type="button" onClick={() => setWidth(w)}
              className={cn("px-2 py-1 text-xs rounded-md transition-colors",
                width === w ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              {w}
            </button>
          ))}
          <div className="w-px h-4 bg-border mx-1" />
          <button type="button" onClick={() => setAlign("left")} title="Left"
            className={cn("h-7 w-7 flex items-center justify-center rounded-md transition-colors",
              align === "left" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
            <AlignLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setAlign("center")} title="Center"
            className={cn("h-7 w-7 flex items-center justify-center rounded-md transition-colors",
              align === "center" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
            <AlignCenter className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setAlign("right")} title="Right"
            className={cn("h-7 w-7 flex items-center justify-center rounded-md transition-colors",
              align === "right" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
            <AlignRight className="h-4 w-4" />
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <a href={src} download={alt || "image"} target="_blank" rel="noreferrer" title="Download"
            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <Download className="h-4 w-4" />
          </a>
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  );
}

const ImageNode = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src:   { default: null },
      alt:   { default: null },
      width: { default: null, parseHTML: (el) => (el as HTMLElement).getAttribute("data-width") || (el as HTMLImageElement).style.width || null },
      align: { default: "center", parseHTML: (el) => (el as HTMLElement).getAttribute("data-align") || "center" },
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
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

/* ── 비디오 노드 ── */
const VideoNode = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      filename: { default: null, parseHTML: (el) => (el as HTMLElement).getAttribute("data-filename") },
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

/* ── PDF 노드 — iframe으로 임베드 (nginx가 PDF는 inline으로 서빙) ── */
const PdfNode = Node.create({
  name: "pdf",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      filename: { default: null, parseHTML: (el) => (el as HTMLElement).getAttribute("data-filename") },
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

/* ── 첨부파일 카드 노드 ── */
function iconFor(mime: string | null, filename: string | null) {
  const ext = (filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (mime?.includes("zip") || ["zip", "rar", "7z", "tar", "gz"].includes(ext)) return FileArchive;
  if (mime?.includes("sheet") || ["xls", "xlsx", "csv"].includes(ext)) return FileSpreadsheet;
  if (mime?.includes("text") || mime?.includes("word") || ["txt", "md", "doc", "docx"].includes(ext)) return FileText;
  return FileIcon;
}

function AttachmentCardView({ node }: NodeViewProps) {
  const { src, filename, size, mime } = node.attrs;
  const Icon = iconFor(mime, filename);
  const sizeLabel = typeof size === "number" ? formatFileSize(size) : "";
  return (
    <NodeViewWrapper as="div" data-drag-handle className="doc-attachment">
      <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate text-foreground">{filename || "file"}</div>
        {sizeLabel && <div className="text-xs text-muted-foreground">{sizeLabel}</div>}
      </div>
      <a href={src} download={filename || "file"} target="_blank" rel="noreferrer"
        title="Download"
        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
        onMouseDown={(e) => e.stopPropagation()}>
        <Download className="h-4 w-4" />
      </a>
    </NodeViewWrapper>
  );
}

/* ── Callout 노드 — info/success/warning/danger 4종 ── */
type CalloutKind = "info" | "success" | "warning" | "danger";

const CALLOUT_META: Record<CalloutKind, { icon: any; label: string }> = {
  info:    { icon: Info,         label: "Info" },
  success: { icon: CheckCircle2, label: "Success" },
  warning: { icon: AlertTriangle, label: "Warning" },
  danger:  { icon: XCircle,      label: "Danger" },
};

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const kind = (node.attrs.kind ?? "info") as CalloutKind;
  const Icon = CALLOUT_META[kind].icon;
  const isEditable = editor.isEditable;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <NodeViewWrapper as="div" className={cn("doc-callout", `doc-callout-${kind}`)} data-kind={kind}>
      <div className="doc-callout-icon" contentEditable={false}>
        {isEditable ? (
          <div className="relative">
            <button type="button"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              title="Change type"
            >
              <Icon className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="doc-callout-menu">
                  {(Object.keys(CALLOUT_META) as CalloutKind[]).map((k) => {
                    const KIcon = CALLOUT_META[k].icon;
                    const active = kind === k;
                    return (
                      <button key={k} type="button"
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateAttributes({ kind: k });
                          setMenuOpen(false);
                        }}
                        className={cn("doc-callout-menu-item", `doc-callout-menu-item-${k}`, active && "is-active")}
                      >
                        <KIcon className="h-3.5 w-3.5" />
                        <span>{CALLOUT_META[k].label}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </div>
      <NodeViewContent className="doc-callout-content" />
    </NodeViewWrapper>
  );
}

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: "info",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-kind") || "info",
      },
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
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
  addCommands() {
    return {
      /* 슬래시 메뉴에서는 항상 새 callout 삽입. kind 변경은 CalloutView 내부 메뉴로 */
      setCallout: (kind: CalloutKind = "info") => ({ commands }: any) =>
        commands.insertContent({
          type: "callout",
          attrs: { kind },
          content: [{ type: "paragraph" }],
        }),
    } as any;
  },
});

/* ── Toggle(Details) 노드 ── */
function ToggleView({ node, updateAttributes, editor }: NodeViewProps) {
  const open = !!node.attrs.open;
  return (
    <NodeViewWrapper as="div" className="doc-toggle" data-open={open ? "true" : "false"}>
      <div className="doc-toggle-row">
        <button
          type="button"
          className="doc-toggle-chevron"
          contentEditable={false}
          onClick={() => updateAttributes({ open: !open })}
          aria-label={open ? "Collapse" : "Expand"}
          disabled={!editor.isEditable && false}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <NodeViewContent as="div" className="doc-toggle-body" />
      </div>
    </NodeViewWrapper>
  );
}

const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-open") !== "false",
      },
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
  addNodeView() { return ReactNodeViewRenderer(ToggleView); },
  addCommands() {
    return {
      setToggle: () => ({ commands }: any) =>
        commands.insertContent({
          type: "toggle",
          attrs: { open: true },
          content: [{ type: "paragraph" }],
        }),
    } as any;
  },
});

const AttachmentNode = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      filename: { default: null },
      size: { default: null, parseHTML: (el) => Number((el as HTMLElement).getAttribute("data-size")) || null },
      mime: { default: null, parseHTML: (el) => (el as HTMLElement).getAttribute("data-mime") },
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
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentCardView);
  },
});

/* ── 문서 컨텍스트 (Subpages, Mention에서 사용) ── */
const DocEditorContext = createContext<{
  workspaceSlug?: string;
  spaceId?: string;
  docId?: string;
  projectId?: string;
} | null>(null);

/* ── @Mention 노드 ── */
type MentionKind = "user" | "doc" | "issue";

function MentionView({ node }: NodeViewProps) {
  const ctx = useContext(DocEditorContext);
  const kind = (node.attrs.kind ?? "user") as MentionKind;
  const id: string = node.attrs.id ?? "";
  const label: string = node.attrs.label ?? "";
  const identifier: string = node.attrs.identifier ?? "";

  const href =
    kind === "doc"   ? `/${ctx?.workspaceSlug}/documents/space/${ctx?.spaceId}/${id}` :
    kind === "issue" ? `/${ctx?.workspaceSlug}/projects/${ctx?.projectId}/issues?issue=${id}` :
    undefined;

  /* 이슈 멘션에 상세 정보 hover card */
  const [hoverCard, setHoverCard] = useState(false);
  const [details, setDetails] = useState<any>(null);
  const [subExpanded, setSubExpanded] = useState(false);
  const [subIssues, setSubIssues] = useState<any[]>([]);
  useEffect(() => {
    if (kind !== "issue" || !hoverCard || details || !ctx?.workspaceSlug || !ctx?.projectId) return;
    import("@/api/issues").then(({ issuesApi }) => {
      issuesApi.get(ctx.workspaceSlug!, ctx.projectId!, id).then(setDetails).catch(() => {});
    });
  }, [kind, hoverCard, details, ctx?.workspaceSlug, ctx?.projectId, id]);
  useEffect(() => {
    if (!subExpanded || subIssues.length > 0 || !ctx?.workspaceSlug || !ctx?.projectId) return;
    import("@/api/issues").then(({ issuesApi }) => {
      issuesApi.subIssues.list(ctx.workspaceSlug!, ctx.projectId!, id).then(setSubIssues).catch(() => {});
    });
  }, [subExpanded, subIssues.length, ctx?.workspaceSlug, ctx?.projectId, id]);

  const Body = (
    <span className={cn("doc-mention", `doc-mention-${kind}`)}>
      {kind === "user" && <AtSign className="h-3 w-3" />}
      {kind === "doc"  && <FileText className="h-3 w-3" />}
      {kind === "issue" && <span className="doc-mention-id">{identifier}</span>}
      <span className="doc-mention-label">{label}</span>
    </span>
  );

  return (
    <NodeViewWrapper as="span" contentEditable={false} className="relative inline-block"
      onMouseEnter={() => kind === "issue" && setHoverCard(true)}
      onMouseLeave={() => setHoverCard(false)}
    >
      {href ? <a href={href} className="no-underline" onMouseDown={(e) => e.stopPropagation()}>{Body}</a> : Body}
      {hoverCard && kind === "issue" && details && (
        <span className="doc-mention-card" contentEditable={false}>
          <span className="doc-mention-card-header">
            <span className="doc-mention-card-id">{details.identifier || identifier}</span>
            <span className="doc-mention-card-title">{details.title}</span>
          </span>
          <span className="doc-mention-card-meta">
            {details.assignees_detail?.length > 0 && (
              <span className="doc-mention-card-row">
                <span className="doc-mention-card-k">담당자</span>
                <span>{details.assignees_detail.map((a: any) => a.display_name).join(", ")}</span>
              </span>
            )}
            {(details.start_date || details.due_date) && (
              <span className="doc-mention-card-row">
                <span className="doc-mention-card-k">기간</span>
                <span>{details.start_date || "?"} → {details.due_date || "?"}</span>
              </span>
            )}
            {details.state_detail?.name && (
              <span className="doc-mention-card-row">
                <span className="doc-mention-card-k">상태</span>
                <span style={{ color: details.state_detail.color }}>● {details.state_detail.name}</span>
              </span>
            )}
          </span>
          {/* 하위 이슈 토글 */}
          {(details.sub_issues_count ?? 0) > 0 && (
            <span className="doc-mention-card-sub">
              <button type="button" className="doc-mention-card-sub-btn"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => { e.stopPropagation(); setSubExpanded(!subExpanded); }}
              >
                {subExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span>하위 이슈 {details.sub_issues_count}개</span>
              </button>
              {subExpanded && (
                <span className="doc-mention-card-sub-list">
                  {subIssues.length === 0 ? (
                    <span className="doc-mention-card-sub-empty">불러오는 중...</span>
                  ) : subIssues.map((s: any) => (
                    <a key={s.id}
                      href={`/${ctx?.workspaceSlug}/projects/${ctx?.projectId}/issues?issue=${s.id}`}
                      className="doc-mention-card-sub-item"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <span className="doc-mention-card-id">{s.identifier || `${s.project_identifier ?? ""}-${s.sequence_id ?? ""}`}</span>
                      <span className="truncate">{s.title}</span>
                    </a>
                  ))}
                </span>
              )}
            </span>
          )}
        </span>
      )}
    </NodeViewWrapper>
  );
}

const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      kind:       { default: "user",  parseHTML: (el) => (el as HTMLElement).getAttribute("data-kind") || "user" },
      id:         { default: "",      parseHTML: (el) => (el as HTMLElement).getAttribute("data-id") || "" },
      label:      { default: "",      parseHTML: (el) => (el as HTMLElement).getAttribute("data-label") || "" },
      identifier: { default: "",      parseHTML: (el) => (el as HTMLElement).getAttribute("data-identifier") || "" },
    };
  },
  parseHTML() { return [{ tag: "span[data-mention]" }]; },
  renderHTML({ HTMLAttributes }) {
    const { kind, id, label, identifier } = HTMLAttributes;
    const display = kind === "user" ? `@${label}` : kind === "issue" ? `${identifier} ${label}` : `[[${label}]]`;
    return ["span", {
      "data-mention": "", "data-kind": kind, "data-id": id, "data-label": label, "data-identifier": identifier ?? "",
      class: `doc-mention doc-mention-${kind}`,
    }, display];
  },
  addNodeView() { return ReactNodeViewRenderer(MentionView); },
});

/* ── 이슈 카드 (block) — 이슈 정보를 테이블처럼 영구 임베드 ── */
function IssueCardView({ node }: NodeViewProps) {
  const ctx = useContext(DocEditorContext);
  const id: string = node.attrs.id ?? "";
  const fallbackIdentifier: string = node.attrs.identifier ?? "";
  const fallbackLabel: string = node.attrs.label ?? "";
  const [data, setData] = useState<any>(null);
  const [subOpen, setSubOpen] = useState(false);
  const [subs, setSubs] = useState<any[]>([]);

  useEffect(() => {
    if (!ctx?.workspaceSlug || !ctx?.projectId || !id) return;
    import("@/api/issues").then(({ issuesApi }) => {
      issuesApi.get(ctx.workspaceSlug!, ctx.projectId!, id).then(setData).catch(() => {});
    });
  }, [ctx?.workspaceSlug, ctx?.projectId, id]);

  useEffect(() => {
    if (!subOpen || subs.length > 0 || !ctx?.workspaceSlug || !ctx?.projectId || !id) return;
    import("@/api/issues").then(({ issuesApi }) => {
      issuesApi.subIssues.list(ctx.workspaceSlug!, ctx.projectId!, id).then(setSubs).catch(() => {});
    });
  }, [subOpen, subs.length, ctx?.workspaceSlug, ctx?.projectId, id]);

  const identifier = data?.identifier || (data?.project_identifier ? `${data.project_identifier}-${data.sequence_id}` : fallbackIdentifier);
  const title = data?.title ?? fallbackLabel;
  const href = `/${ctx?.workspaceSlug}/projects/${ctx?.projectId}/issues?issue=${id}`;
  const hasSubs = (data?.sub_issues_count ?? 0) > 0;

  return (
    <NodeViewWrapper as="div" contentEditable={false} data-drag-handle className="doc-issue-card">
      <div className="doc-issue-card-head">
        <span className="doc-issue-card-id">{identifier || "…"}</span>
        <a href={href} className="doc-issue-card-title" onMouseDown={(e) => e.stopPropagation()}>
          {title || "이슈"}
        </a>
        {data?.state_detail && (
          <span className="doc-issue-card-state" style={{ color: data.state_detail.color, borderColor: `${data.state_detail.color}55` }}>
            ● {data.state_detail.name}
          </span>
        )}
      </div>
      {data && (
        <div className="doc-issue-card-meta">
          {data.assignees_detail?.length > 0 && (
            <div className="doc-issue-card-row">
              <span className="doc-issue-card-k">담당자</span>
              <span className="doc-issue-card-assignees">
                {data.assignees_detail.map((a: any) => (
                  <span key={a.id} className="doc-issue-card-assignee">
                    <span className="doc-issue-card-avatar">{(a.display_name ?? "?")[0]}</span>
                    {a.display_name}
                  </span>
                ))}
              </span>
            </div>
          )}
          {(data.start_date || data.due_date) && (
            <div className="doc-issue-card-row">
              <span className="doc-issue-card-k">기간</span>
              <span>{data.start_date || "?"} → {data.due_date || "?"}</span>
            </div>
          )}
          {data.priority && (
            <div className="doc-issue-card-row">
              <span className="doc-issue-card-k">우선순위</span>
              <span>{data.priority}</span>
            </div>
          )}
        </div>
      )}
      {hasSubs && (
        <div className="doc-issue-card-sub">
          <button type="button" className="doc-issue-card-sub-btn"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={() => setSubOpen(!subOpen)}
          >
            {subOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <span>하위 이슈 {data.sub_issues_count}개</span>
          </button>
          {subOpen && (
            <div className="doc-issue-card-sub-list">
              {subs.length === 0 ? (
                <div className="doc-issue-card-sub-empty">불러오는 중...</div>
              ) : subs.map((s: any) => (
                <a key={s.id}
                  href={`/${ctx?.workspaceSlug}/projects/${ctx?.projectId}/issues?issue=${s.id}`}
                  className="doc-issue-card-sub-item"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <span className="doc-issue-card-id">{s.identifier || `${s.project_identifier ?? ""}-${s.sequence_id ?? ""}`}</span>
                  <span className="truncate">{s.title}</span>
                  {s.state_detail && <span style={{ color: s.state_detail.color }}>● {s.state_detail.name}</span>}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

const IssueCard = Node.create({
  name: "issueCard",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      id:         { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-id") || "" },
      identifier: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-identifier") || "" },
      label:      { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-label") || "" },
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
  addNodeView() { return ReactNodeViewRenderer(IssueCardView); },
});

/* ── Math (KaTeX) 인라인/블록 ── */
function MathView({ node, updateAttributes, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex ?? "";
  const isBlock = node.type.name === "mathBlock";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const renderRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (editing || !renderRef.current) return;
    try {
      katex.render(
        latex || (isBlock ? "\\text{수식 입력}" : "x"),
        renderRef.current,
        { throwOnError: false, displayMode: isBlock },
      );
    } catch { /* invalid latex — katex already handles */ }
  }, [latex, isBlock, editing]);

  const commit = () => { updateAttributes({ latex: draft }); setEditing(false); };
  const Tag = isBlock ? "div" : "span";

  return (
    <NodeViewWrapper as={Tag as any} className={cn("doc-math", isBlock && "doc-math-block")}>
      {editing ? (
        <span className="inline-flex items-center gap-1" contentEditable={false}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
            }}
            placeholder="LaTeX..."
            className="text-sm font-mono bg-muted border rounded px-2 py-0.5 outline-none min-w-[200px]"
          />
        </span>
      ) : (
        <span
          ref={renderRef}
          contentEditable={false}
          onClick={(e) => { e.stopPropagation(); if (editor.isEditable) { setDraft(latex); setEditing(true); } }}
          className="cursor-pointer"
        />
      )}
    </NodeViewWrapper>
  );
}

const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() { return { latex: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-latex") } }; },
  parseHTML() { return [{ tag: "span[data-math-inline]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-math-inline": "", "data-latex": HTMLAttributes.latex, class: "doc-math" }, HTMLAttributes.latex];
  },
  addNodeView() { return ReactNodeViewRenderer(MathView); },
});

const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes() { return { latex: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-latex") } }; },
  parseHTML() { return [{ tag: "div[data-math-block]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-math-block": "", "data-latex": HTMLAttributes.latex, class: "doc-math doc-math-block" }, HTMLAttributes.latex];
  },
  addNodeView() { return ReactNodeViewRenderer(MathView); },
});

/* ── Mermaid ── */
mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" });

function MermaidView({ node, updateAttributes, editor }: NodeViewProps) {
  const code: string = node.attrs.code ?? "";
  const [editing, setEditing] = useState(!code);
  const [draft, setDraft] = useState(code);
  const [err, setErr] = useState("");
  const renderRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`m-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (editing || !renderRef.current || !code) return;
    let cancelled = false;
    mermaid.render(idRef.current, code).then(({ svg }) => {
      if (!cancelled && renderRef.current) { renderRef.current.innerHTML = svg; setErr(""); }
    }).catch((e) => {
      if (!cancelled) setErr(String(e?.message ?? e));
    });
    return () => { cancelled = true; };
  }, [code, editing]);

  return (
    <NodeViewWrapper as="div" className="doc-mermaid" contentEditable={false}>
      <div className="doc-mermaid-head">
        <span className="doc-mermaid-label">Mermaid</span>
        {editor.isEditable && (
          <button type="button" className="doc-mermaid-btn"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => {
              e.stopPropagation();
              if (editing) { updateAttributes({ code: draft }); setEditing(false); }
              else { setDraft(code); setEditing(true); }
            }}
          >
            {editing ? "렌더" : "편집"}
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={"flowchart TD\n  A[Start] --> B[End]"}
          className="doc-mermaid-editor"
        />
      ) : (
        <>
          <div ref={renderRef} className="doc-mermaid-render" />
          {err && <pre className="doc-mermaid-err">{err}</pre>}
        </>
      )}
    </NodeViewWrapper>
  );
}

const Mermaid = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  addAttributes() {
    return { code: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-code") || "" } };
  },
  parseHTML() { return [{ tag: "div[data-mermaid]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-mermaid": "", "data-code": HTMLAttributes.code, class: "doc-mermaid" }];
  },
  addNodeView() { return ReactNodeViewRenderer(MermaidView); },
});

/* ── Columns 레이아웃 ── */
const ColumnList = Node.create({
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

const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() { return [{ tag: "div[data-column]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "", class: "doc-column" }), 0];
  },
});

/* ── Status 배지 (인라인) ── */
const STATUS_COLORS = ["gray", "red", "orange", "green", "blue", "purple", "pink"] as const;
type StatusColor = typeof STATUS_COLORS[number];

const STATUS_HEX: Record<StatusColor, string> = {
  gray: "#9ca3af", red: "#ef4444", orange: "#f59e0b",
  green: "#22c55e", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899",
};

function StatusView({ node, updateAttributes, editor }: NodeViewProps) {
  const label: string = node.attrs.label ?? "Status";
  const color: StatusColor = (node.attrs.color ?? "gray") as StatusColor;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const hex = STATUS_HEX[color] ?? STATUS_HEX.gray;

  if (editing && editor.isEditable) {
    return (
      <NodeViewWrapper as="span" className="doc-status-edit" contentEditable={false}>
        {STATUS_COLORS.map((c) => (
          <button key={c} type="button" title={c}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); updateAttributes({ color: c }); }}
            className="doc-status-swatch"
            style={{ background: STATUS_HEX[c], outline: color === c ? "2px solid hsl(var(--primary))" : "none" }}
          />
        ))}
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => { updateAttributes({ label: draft || "Status" }); setEditing(false); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); updateAttributes({ label: draft || "Status" }); setEditing(false); }
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
          }}
          className="doc-status-input"
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="doc-status" contentEditable={false}
      style={{ background: `${hex}22`, color: hex, borderColor: `${hex}55` }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); if (editor.isEditable) { setDraft(label); setEditing(true); } }}
    >
      <span className="doc-status-dot" style={{ background: hex }} />
      {label}
    </NodeViewWrapper>
  );
}

const Status = Node.create({
  name: "status",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      label: { default: "Status", parseHTML: (el) => (el as HTMLElement).getAttribute("data-label") || "Status" },
      color: { default: "gray", parseHTML: (el) => (el as HTMLElement).getAttribute("data-color") || "gray" },
    };
  },
  parseHTML() { return [{ tag: "span[data-status]" }]; },
  renderHTML({ HTMLAttributes }) {
    const { label, color } = HTMLAttributes;
    return ["span", { "data-status": "", "data-label": label, "data-color": color, class: `doc-status doc-status-${color}` }, `● ${label}`];
  },
  addNodeView() { return ReactNodeViewRenderer(StatusView); },
});

/* ── Subpages (현재 문서의 하위 문서 자동 리스트) ── */
function SubpagesView() {
  const ctx = useContext(DocEditorContext);
  const [children, setChildren] = useState<any[]>([]);
  useEffect(() => {
    if (!ctx?.workspaceSlug || !ctx?.spaceId || !ctx?.docId) return;
    /* 동적 import로 cyclic 방지 */
    import("@/api/documents").then(({ documentsApi }) => {
      documentsApi.list(ctx.workspaceSlug!, ctx.spaceId!, { parent: ctx.docId! })
        .then((data) => setChildren(data));
    });
  }, [ctx?.workspaceSlug, ctx?.spaceId, ctx?.docId]);

  return (
    <NodeViewWrapper as="div" className="doc-subpages" contentEditable={false}>
      <div className="doc-subpages-label">하위 문서</div>
      {children.length === 0 ? (
        <p className="doc-subpages-empty">하위 문서 없음</p>
      ) : (
        <div className="doc-subpages-grid">
          {children.map((child) => (
            <a key={child.id}
              href={`/${ctx?.workspaceSlug}/documents/space/${ctx?.spaceId}/${child.id}`}
              className="doc-subpages-item"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <span>{child.is_folder ? "📁" : "📄"}</span>
              <span className="truncate">{child.title}</span>
            </a>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

const Subpages = Node.create({
  name: "subpages",
  group: "block",
  atom: true,
  parseHTML() { return [{ tag: "div[data-subpages]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-subpages": "", class: "doc-subpages" }), ""];
  },
  addNodeView() { return ReactNodeViewRenderer(SubpagesView); },
});

interface Props {
  content: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  editable?: boolean;
  onFileUpload?: (file: File) => Promise<{ url: string; filename: string }>;
  workspaceSlug?: string;
  spaceId?: string;
  docId?: string;
  projectId?: string;
}

/* ── 슬래시 명령어 ── */
interface SlashCmd { title: string; icon: React.ElementType; cmd: (e: any) => void; }
const CMDS: SlashCmd[] = [
  { title: "Heading 1", icon: Heading1, cmd: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { title: "Heading 2", icon: Heading2, cmd: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { title: "Heading 3", icon: Heading3, cmd: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { title: "Bullet List", icon: List, cmd: (e) => e.chain().focus().toggleBulletList().run() },
  { title: "Numbered List", icon: ListOrdered, cmd: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: "Task List", icon: ListChecks, cmd: (e) => e.chain().focus().toggleTaskList().run() },
  { title: "Quote", icon: Quote, cmd: (e) => e.chain().focus().toggleBlockquote().run() },
  { title: "Code Block", icon: CodeSquare, cmd: (e) => e.chain().focus().toggleCodeBlock().run() },
  { title: "Table", icon: TableIcon, cmd: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: "Callout", icon: Info, cmd: (e) => e.chain().focus().setCallout("info").run() },
  { title: "Toggle", icon: SquareChevronDown, cmd: (e) => e.chain().focus().setToggle().run() },
  { title: "Divider", icon: Minus, cmd: (e) => e.chain().focus().setHorizontalRule().run() },
  { title: "Date", icon: Calendar, cmd: (e) => {
      const d = new Date();
      const locale = (typeof navigator !== "undefined" && navigator.language) || "en-US";
      const txt = d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
      e.chain().focus().insertContent(txt + " ").run();
    }
  },
  { title: "Emoji", icon: Smile, cmd: (e) => e.chain().focus().insertContent(":").run() },
  { title: "Mention user", icon: AtSign, cmd: (e) => e.chain().focus().insertContent("@").run() },
  { title: "Reference doc", icon: FileText, cmd: (e) => e.chain().focus().insertContent("#").run() },
  { title: "Reference issue", icon: Hash, cmd: (e) => e.chain().focus().insertContent("$").run() },
  { title: "Math (inline)", icon: Sigma, cmd: (e) => e.chain().focus().insertContent("$x$").run() },
  { title: "Math (block)",  icon: Sigma, cmd: (e) => e.chain().focus().insertContent("$$x$$").run() },
  { title: "Mermaid",       icon: Workflow, cmd: (e) => e.chain().focus().insertContent({ type: "mermaid",  attrs: { code: "" } }).run() },
  { title: "2 Columns",     icon: Columns2, cmd: (e) => (e as any).chain().focus().setColumns(2).run() },
  { title: "3 Columns",     icon: Columns3, cmd: (e) => (e as any).chain().focus().setColumns(3).run() },
  { title: "4 Columns",     icon: Columns4, cmd: (e) => (e as any).chain().focus().setColumns(4).run() },
  { title: "Status",        icon: Tag, cmd: (e) => e.chain().focus().insertContent({ type: "status", attrs: { label: "Status", color: "gray" } }).run() },
  { title: "Subpages",      icon: FolderTree, cmd: (e) => e.chain().focus().insertContent({ type: "subpages" }).run() },
];

/* ── 이모지 사전 ── */
const EMOJIS: Array<{ name: string; char: string; kw?: string }> = [
  { name: "smile", char: "😊" }, { name: "grin", char: "😀" }, { name: "laugh", char: "😂" },
  { name: "wink", char: "😉" }, { name: "heart_eyes", char: "😍" }, { name: "thinking", char: "🤔" },
  { name: "cry", char: "😢" }, { name: "sob", char: "😭" }, { name: "angry", char: "😠" },
  { name: "sleep", char: "😴" }, { name: "cool", char: "😎" }, { name: "neutral", char: "😐" },
  { name: "heart", char: "❤️" }, { name: "broken_heart", char: "💔" }, { name: "sparkles", char: "✨" },
  { name: "fire", char: "🔥" }, { name: "star", char: "⭐" }, { name: "thumbsup", char: "👍" },
  { name: "thumbsdown", char: "👎" }, { name: "clap", char: "👏" }, { name: "wave", char: "👋" },
  { name: "pray", char: "🙏" }, { name: "ok", char: "👌" }, { name: "point_right", char: "👉" },
  { name: "check", char: "✅" }, { name: "x", char: "❌" }, { name: "warning", char: "⚠️" },
  { name: "info", char: "ℹ️" }, { name: "question", char: "❓" }, { name: "exclamation", char: "❗" },
  { name: "tada", char: "🎉" }, { name: "rocket", char: "🚀" }, { name: "bulb", char: "💡" },
  { name: "bug", char: "🐛" }, { name: "zap", char: "⚡" }, { name: "boom", char: "💥" },
  { name: "eyes", char: "👀" }, { name: "memo", char: "📝" }, { name: "book", char: "📚" },
  { name: "calendar", char: "📅" }, { name: "pin", char: "📌" }, { name: "lock", char: "🔒" },
  { name: "key", char: "🔑" }, { name: "gear", char: "⚙️" }, { name: "hammer", char: "🔨" },
  { name: "wrench", char: "🔧" }, { name: "chart", char: "📊" }, { name: "hourglass", char: "⏳" },
  { name: "hundred", char: "💯" }, { name: "muscle", char: "💪" }, { name: "coffee", char: "☕" },
];

export function DocumentEditor({ content, onChange, onBlur, placeholder, editable = true, onFileUpload, workspaceSlug, spaceId, docId, projectId }: Props) {
  const docCtx = useMemo(() => ({ workspaceSlug, spaceId, docId, projectId }), [workspaceSlug, spaceId, docId, projectId]);
  const { t } = useTranslation();
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIdx, setSlashIdx] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiPos, setEmojiPos] = useState<{ top: number; left: number } | null>(null);
  const [emojiFilter, setEmojiFilter] = useState("");
  const [emojiIdx, setEmojiIdx] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionKind, setMentionKind] = useState<MentionKind>("user");
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number } | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionResults, setMentionResults] = useState<Array<{ kind: MentionKind; id: string; label: string; sublabel?: string; identifier?: string; parent?: string | null; depth?: number; hasChildren?: boolean }>>([]);
  const [mentionCollapsed, setMentionCollapsed] = useState<Set<string>>(new Set());
  const currentUser = useAuthStore((s) => s.user);
  const [uploading, setUploading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [replaceShown, setReplaceShown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
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
      Callout,
      Toggle,
      CharacterCount,
      GlobalDragHandle.configure({
        dragHandleWidth: 20,
        scrollTreshold: 100,
      }),
      SearchAndReplace.configure({
        searchResultClass: "doc-search-hit",
        disableRegex: false,
      }),
      MathExtension.configure({ evaluation: false, addInlineMath: true }),
      Mermaid,
      ColumnList,
      Column,
      Status,
      Subpages,
      Mention,
      IssueCard,
      ImageNode,
      VideoNode,
      PdfNode,
      AttachmentNode,
    ],
    content,
    editable,
    editorProps: {
      attributes: { class: "doc-editor outline-none min-h-[400px]" },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
      // 슬래시/이모지/멘션 트리거 체크
      //  @ → 사용자, # → 문서, $ → 이슈
      const { from } = e.state.selection;
      const txt = e.state.doc.textBetween(Math.max(0, from - 30), from, "\n");
      /* 트리거 앞 문자가 word char(\w=영숫자_)가 아니면 OK.
         `\s`만 쓰면 한글 뒤엔 매치 안 됨(한글은 \w도 \s도 아님). */
      const ms  = txt.match(/(?:^|[^\w])\/([\w]*)$/);
      const me  = txt.match(/(?:^|[^\w]):([\w]*)$/);
      const mAt  = txt.match(/(?:^|[^\w])@([\w가-힣ㄱ-ㅎㅏ-ㅣ\- ]*)$/);
      const mHash = txt.match(/(?:^|[^\w])#([\w가-힣ㄱ-ㅎㅏ-ㅣ\- ]*)$/);
      const mDollar = txt.match(/(?:^|[^\w])\$([\w\-]*)$/);
      /* 팝업 위치 계산 — 뷰포트 벗어나면 위로 뒤집고, 좌우도 clamp */
      const placePopup = (coords: { top: number; bottom: number; left: number }, w: number, h: number) => {
        const topCandidate = coords.bottom + 4;
        const topFlipped = coords.top - h - 4;
        const top = topCandidate + h + 8 > window.innerHeight && topFlipped > 8
          ? topFlipped
          : Math.max(8, Math.min(topCandidate, window.innerHeight - h - 8));
        const left = Math.max(8, Math.min(coords.left, window.innerWidth - w - 8));
        return { top, left };
      };
      const openMention = (kind: MentionKind, q: string) => {
        setMentionKind(kind);
        setMentionQuery(q.toLowerCase());
        setMentionIdx(0);
        const coords = e.view.coordsAtPos(from);
        setMentionPos(placePopup(coords, 288, 320));
        setMentionOpen(true);
        setSlashOpen(false); setEmojiOpen(false);
      };
      if (ms) {
        setSlashFilter(ms[1].toLowerCase());
        setSlashIdx(0);
        const coords = e.view.coordsAtPos(from);
        setSlashPos(placePopup(coords, 224, 320));
        setSlashOpen(true);
        setEmojiOpen(false); setMentionOpen(false);
      } else if (me) {
        setEmojiFilter(me[1].toLowerCase());
        setEmojiIdx(0);
        const coords = e.view.coordsAtPos(from);
        setEmojiPos(placePopup(coords, 256, 320));
        setEmojiOpen(true);
        setSlashOpen(false); setMentionOpen(false);
      } else if (mAt) {
        openMention("user", mAt[1]);
      } else if (mHash) {
        openMention("doc", mHash[1]);
      } else if (mDollar) {
        openMention("issue", mDollar[1]);
      } else {
        setSlashOpen(false);
        setEmojiOpen(false);
        setMentionOpen(false);
      }
    },
    onBlur: () => { onBlur?.(); setTimeout(() => { setSlashOpen(false); setEmojiOpen(false); setMentionOpen(false); }, 200); },
  });

  // content 동기화
  useEffect(() => {
    if (editor && content !== editor.getHTML()) editor.commands.setContent(content, { emitUpdate: false });
  }, [content]);

  const filtered = CMDS.filter((c) => !slashFilter || c.title.toLowerCase().includes(slashFilter));
  const emojiFiltered = EMOJIS.filter((em) => !emojiFilter || em.name.toLowerCase().includes(emojiFilter));

  const runSlash = useCallback((cmd: SlashCmd) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const txt = editor.state.doc.textBetween(Math.max(0, from - 20), from, "\n");
    const m = txt.match(/(?:^|\s)\/([\w]*)$/);
    if (m) {
      const df = from - m[0].length + (m[0].startsWith(" ") ? 1 : 0);
      editor.chain().focus().deleteRange({ from: df, to: from }).run();
    }
    cmd.cmd(editor);
    setSlashOpen(false);
  }, [editor]);

  const runEmoji = useCallback((em: { char: string }) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const txt = editor.state.doc.textBetween(Math.max(0, from - 20), from, "\n");
    const m = txt.match(/(?:^|\s):([\w]*)$/);
    if (m) {
      const df = from - m[0].length + (m[0].startsWith(" ") ? 1 : 0);
      editor.chain().focus().deleteRange({ from: df, to: from }).insertContent(em.char).run();
    } else {
      editor.chain().focus().insertContent(em.char).run();
    }
    setEmojiOpen(false);
  }, [editor]);

  // 슬래시 키보드 — wrap around + 스크롤 따라가기
  useEffect(() => {
    if (!slashOpen) return;
    const h = (e: KeyboardEvent) => {
      const n = filtered.length;
      if (!n) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => (i + 1) % n); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => (i - 1 + n) % n); }
      else if (e.key === "Enter") { e.preventDefault(); filtered[slashIdx] && runSlash(filtered[slashIdx]); }
      else if (e.key === "Escape") setSlashOpen(false);
    };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [slashOpen, slashIdx, filtered, runSlash]);

  // 슬래시 선택 항목 자동 스크롤
  useEffect(() => {
    if (!slashOpen) return;
    const el = document.querySelector<HTMLElement>(`[data-slash-item="${slashIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [slashIdx, slashOpen]);

  // 이모지 키보드
  useEffect(() => {
    if (!emojiOpen) return;
    const h = (e: KeyboardEvent) => {
      const n = Math.min(emojiFiltered.length, 12);
      if (!n) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setEmojiIdx((i) => (i + 1) % n); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setEmojiIdx((i) => (i - 1 + n) % n); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); emojiFiltered[emojiIdx] && runEmoji(emojiFiltered[emojiIdx]); }
      else if (e.key === "Escape") setEmojiOpen(false);
    };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [emojiOpen, emojiIdx, emojiFiltered, runEmoji]);

  // 이모지 선택 항목 자동 스크롤
  useEffect(() => {
    if (!emojiOpen) return;
    const el = document.querySelector<HTMLElement>(`[data-emoji-item="${emojiIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [emojiIdx, emojiOpen]);

  // @Mention 검색 — kind별로 해당 종류만 검색 (@=user, #=doc, $=issue)
  useEffect(() => {
    if (!mentionOpen || !workspaceSlug) { setMentionResults([]); return; }
    const q = mentionQuery.trim().toLowerCase();
    const kind = mentionKind;
    const handle = setTimeout(async () => {
      try {
        if (kind === "user") {
          const wkMod = await import("@/api/workspaces");
          const members = await wkMod.workspacesApi.members(workspaceSlug).catch(() => [] as any[]);
          /* 본인도 포함 — members에 없더라도 currentUser 추가 */
          const pool = [
            ...(currentUser ? [{ member: currentUser }] : []),
            ...(members as any[]).filter((m) => m.member?.id !== currentUser?.id),
          ];
          const items = pool
            .filter((m) => !q || m.member?.display_name?.toLowerCase().includes(q) || m.member?.email?.toLowerCase().includes(q))
            .slice(0, 8)
            .map((m) => ({ kind: "user" as MentionKind, id: m.member.id, label: m.member.display_name || m.member.email, sublabel: m.member.email }));
          setMentionResults(items);
        } else if (kind === "doc") {
          const docMod = await import("@/api/documents");
          const docs = await docMod.documentsApi.search(workspaceSlug, q || "").catch(() => [] as any[]);
          const items = (docs as any[]).slice(0, 10).map((d) => ({ kind: "doc" as MentionKind, id: d.id, label: d.title }));
          setMentionResults(items);
        } else if (kind === "issue") {
          if (!projectId) { setMentionResults([]); return; }
          const issueMod = await import("@/api/issues");
          const raw = await issueMod.issuesApi.searchByWorkspace(workspaceSlug, q || "").catch(() => [] as any[]);
          const filtered = (raw as any[]).filter((i) => i.project === projectId || i.project_id === projectId);
          /* 트리 빌드 — parent가 결과 내에 있으면 children으로, 없으면 root로 취급 */
          const byId = new Map(filtered.map((i) => [i.id, i] as const));
          const childrenOf = new Map<string | null, string[]>();
          for (const iss of filtered) {
            const pid = iss.parent && byId.has(iss.parent) ? iss.parent : null;
            if (!childrenOf.has(pid)) childrenOf.set(pid, []);
            childrenOf.get(pid)!.push(iss.id);
          }
          const ordered: any[] = [];
          const walk = (pid: string | null, depth: number) => {
            for (const cid of childrenOf.get(pid) ?? []) {
              const it = byId.get(cid)!;
              const hasChildren = (childrenOf.get(cid) ?? []).length > 0;
              ordered.push({
                kind: "issue" as MentionKind, id: it.id, label: it.title,
                identifier: it.identifier || (it.project_identifier ? `${it.project_identifier}-${it.sequence_id}` : ""),
                parent: it.parent ?? null, depth, hasChildren,
              });
              walk(cid, depth + 1);
            }
          };
          walk(null, 0);
          setMentionResults(ordered);
        }
        setMentionIdx(0);
      } catch { setMentionResults([]); }
    }, 200);
    return () => clearTimeout(handle);
  }, [mentionOpen, mentionKind, mentionQuery, workspaceSlug, projectId, currentUser]);

  const runMention = useCallback((item: { kind: MentionKind; id: string; label: string; identifier?: string }) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const txt = editor.state.doc.textBetween(Math.max(0, from - 30), from, "\n");
    /* kind에 맞는 트리거 문자로 텍스트 제거 범위 결정 */
    const regex = item.kind === "user"
      ? /(?:^|[^\w])@([\w가-힣ㄱ-ㅎㅏ-ㅣ\- ]*)$/
      : item.kind === "doc"
        ? /(?:^|[^\w])#([\w가-힣ㄱ-ㅎㅏ-ㅣ\- ]*)$/
        : /(?:^|[^\w])\$([\w\-]*)$/;
    const m = txt.match(regex);
    let df = from;
    if (m) df = from - m[0].length + (m[0].startsWith(" ") ? 1 : 0);
    /* 이슈는 block 카드로, user/doc은 inline mention */
    if (item.kind === "issue") {
      editor.chain().focus()
        .deleteRange({ from: df, to: from })
        .insertContent({ type: "issueCard", attrs: { id: item.id, identifier: item.identifier ?? "", label: item.label } })
        .run();
    } else {
      editor.chain().focus()
        .deleteRange({ from: df, to: from })
        .insertContent([
          { type: "mention", attrs: { kind: item.kind, id: item.id, label: item.label, identifier: item.identifier ?? "" } },
          { type: "text", text: " " },
        ])
        .run();
    }
    setMentionOpen(false);
  }, [editor]);

  // 멘션 키보드
  useEffect(() => {
    if (!mentionOpen) return;
    const h = (e: KeyboardEvent) => {
      const n = mentionResults.length;
      if (!n) { if (e.key === "Escape") setMentionOpen(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => (i + 1) % n); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx((i) => (i - 1 + n) % n); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); mentionResults[mentionIdx] && runMention(mentionResults[mentionIdx]); }
      else if (e.key === "Escape") setMentionOpen(false);
    };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [mentionOpen, mentionIdx, mentionResults, runMention]);

  // 멘션 스크롤
  useEffect(() => {
    if (!mentionOpen) return;
    const el = document.querySelector<HTMLElement>(`[data-mention-item="${mentionIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [mentionIdx, mentionOpen]);

  // Cmd+F — 검색 바 열기 (editable일 때만)
  useEffect(() => {
    if (!editor || !editable) return;
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        /* 에디터 영역 포커스이거나 이미 검색 열려있을 때만 가로챔 */
        const active = document.activeElement as HTMLElement | null;
        if (searchOpen || (active && wrapperRef.current?.contains(active))) {
          e.preventDefault();
          setSearchOpen(true);
        }
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setReplaceShown(false);
        editor.commands.setSearchTerm("");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [editor, editable, searchOpen]);

  // 검색어 바뀔 때마다 extension에 반영
  useEffect(() => {
    if (!editor) return;
    editor.commands.setSearchTerm(searchQuery);
    editor.commands.setReplaceTerm(replaceQuery);
  }, [editor, searchQuery, replaceQuery]);

  // 파일 삽입
  const insertFile = useCallback(async (file: File) => {
    if (!editor) return;
    if (file.name.endsWith(".docx")) {
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
        editor.chain().focus().insertContent(result.value).run();
      } catch {}
      return;
    }
    setUploading(true);
    try {
      if (file.type.startsWith("image/")) {
        if (onFileUpload) {
          const { url, filename } = await onFileUpload(file);
          // HTML 문자열로 삽입 — ImageNode가 parseHTML로 파싱
          editor.chain().focus().insertContent(`<img src="${url}" alt="${filename}" />`).run();
        } else {
          const r = new FileReader();
          r.onload = () => { editor.chain().focus().insertContent(`<img src="${r.result}" alt="${file.name}" />`).run(); };
          r.readAsDataURL(file);
        }
      } else if (file.type.startsWith("video/") && onFileUpload) {
        const { url, filename } = await onFileUpload(file);
        editor.chain().focus().insertContent({ type: "video", attrs: { src: url, filename } }).run();
      } else if (file.type === "application/pdf" && onFileUpload) {
        const { url, filename } = await onFileUpload(file);
        editor.chain().focus().insertContent({ type: "pdf", attrs: { src: url, filename } }).run();
      } else if (onFileUpload) {
        const { url, filename } = await onFileUpload(file);
        editor.chain().focus().insertContent({
          type: "attachment",
          attrs: { src: url, filename, size: file.size, mime: file.type || null },
        }).run();
      }
    } catch {}
    setUploading(false);
  }, [editor, onFileUpload]);

  // DOM 드래그앤드롭
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onDrop = (e: DragEvent) => {
      const f = e.dataTransfer?.files[0];
      if (!f) return;
      e.preventDefault();
      e.stopPropagation();
      insertFile(f);
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onPaste = (e: ClipboardEvent) => {
      /* 1) 이미지 붙여넣기 */
      for (const item of Array.from(e.clipboardData?.items || [])) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) { e.preventDefault(); insertFile(f); return; }
        }
      }
      /* 2) 문서 링크 자동 변환 — /:ws/documents/space/:space/:doc 패턴이면 doc mention 노드로 */
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text || !editor) return;
      const docMatch = text.match(/\/([^\/]+)\/documents\/space\/([0-9a-f-]{36})\/([0-9a-f-]{36})/);
      if (docMatch) {
        const [, , , docId] = docMatch;
        e.preventDefault();
        import("@/api/documents").then(({ documentsApi }) => {
          /* 문서 제목 fetch 후 mention 삽입 */
          documentsApi.list(workspaceSlug!, docMatch[2], { all: "true" }).then((docs) => {
            const doc = docs.find((d) => d.id === docId);
            editor.chain().focus().insertContent([
              { type: "mention", attrs: { kind: "doc", id: docId, label: doc?.title ?? "문서", identifier: "" } },
              { type: "text", text: " " },
            ]).run();
          }).catch(() => {
            editor.chain().focus().insertContent([
              { type: "mention", attrs: { kind: "doc", id: docId, label: "문서", identifier: "" } },
              { type: "text", text: " " },
            ]).run();
          });
        });
        return;
      }
      /* 3) 이슈 링크 자동 변환 — /:ws/projects/:project/issues/:issue */
      const issueMatch = text.match(/\/([^\/]+)\/projects\/([0-9a-f-]{36})\/issues\/([0-9a-f-]{36})/);
      if (issueMatch && projectId) {
        const [, , , issueId] = issueMatch;
        e.preventDefault();
        import("@/api/issues").then(({ issuesApi }) => {
          issuesApi.get(workspaceSlug!, projectId, issueId).then((iss: any) => {
            const identifier = iss.identifier || (iss.project_identifier ? `${iss.project_identifier}-${iss.sequence_id}` : "");
            editor.chain().focus().insertContent({
              type: "issueCard",
              attrs: { id: issueId, identifier, label: iss.title ?? "이슈" },
            }).run();
          }).catch(() => {
            editor.chain().focus().insertContent({
              type: "issueCard",
              attrs: { id: issueId, identifier: "", label: "이슈" },
            }).run();
          });
        });
      }
    };
    el.addEventListener("drop", onDrop, true);
    el.addEventListener("dragover", onOver, true);
    el.addEventListener("paste", onPaste, true);
    return () => {
      el.removeEventListener("drop", onDrop, true);
      el.removeEventListener("dragover", onOver, true);
      el.removeEventListener("paste", onPaste, true);
    };
  }, [insertFile]);

  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  /* 링크 편집을 인라인 UI로 처리 — BubbleMenu 내부에서 사용 */
  const setLink = useCallback(() => {
    if (!editor) return;
    setLinkEditorOpen(true);
  }, [editor]);

  const applyLink = useCallback((url: string) => {
    if (!editor) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const normalized = /^https?:\/\//i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("mailto:")
        ? trimmed
        : `https://${trimmed}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
    }
    setLinkEditorOpen(false);
  }, [editor]);

  const pickFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) insertFile(f); };
    input.click();
  }, [insertFile]);

  if (!editor) return null;

  return (
    <DocEditorContext.Provider value={docCtx}>
    <div className="flex flex-col h-full relative" ref={wrapperRef}>
      {/* 편집 중 업로드 인디케이터 */}
      {uploading && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-b text-xs text-primary">
          <div className="h-3 w-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          Uploading...
        </div>
      )}

      {/* Bubble menu — 텍스트 선택 시에만 표시 */}
      {editable && <EditorBubbleMenu
        editor={editor}
        onPickFile={pickFile}
        onSetLink={setLink}
        linkEditorOpen={linkEditorOpen}
        onCloseLinkEditor={() => setLinkEditorOpen(false)}
        onApplyLink={applyLink}
      />}
      {editable && <TableBubbleMenu editor={editor} />}

      {/* Search & Replace bar */}
      {editable && searchOpen && (
        <SearchBar
          editor={editor}
          query={searchQuery}
          setQuery={setSearchQuery}
          replaceQuery={replaceQuery}
          setReplaceQuery={setReplaceQuery}
          replaceShown={replaceShown}
          setReplaceShown={setReplaceShown}
          onClose={() => {
            setSearchOpen(false);
            setReplaceShown(false);
            editor.commands.setSearchTerm("");
          }}
        />
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4 cursor-text"
        onClick={() => { if (!editor.isFocused) editor.chain().focus().run(); }}>
        <EditorContent editor={editor} />
      </div>

      {slashOpen && slashPos && filtered.length > 0 && (
        <div className="fixed z-50 w-56 rounded-xl border bg-popover shadow-xl overflow-hidden" style={{top:slashPos.top,left:slashPos.left}}>
          <div className="p-1 max-h-64 overflow-y-auto">
            {filtered.map((c,i) => {
              const Icon = c.icon;
              return <button key={c.title}
                data-slash-item={i}
                className={cn("flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-left transition-colors",
                  i===slashIdx?"bg-accent text-foreground":"text-muted-foreground hover:bg-accent/50")}
                onMouseEnter={()=>setSlashIdx(i)}
                onMouseDown={(e)=>{e.preventDefault();runSlash(c);}}
              ><Icon className="h-4 w-4 shrink-0"/><span>{c.title}</span></button>;
            })}
          </div>
        </div>
      )}

      {mentionOpen && mentionPos && (
        <div className="fixed z-50 w-72 rounded-xl border bg-popover shadow-xl overflow-hidden" style={{top:mentionPos.top,left:mentionPos.left}}>
          {/* 헤더 — 현재 검색 대상 명시 */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {mentionKind === "user"  && <><AtSign className="h-3 w-3" /> {t("documents.mentionUser", "사용자 멘션")}</>}
            {mentionKind === "doc"   && <><FileText className="h-3 w-3" /> {t("documents.mentionDoc", "문서 참조")}</>}
            {mentionKind === "issue" && <><Hash className="h-3 w-3" /> {t("documents.mentionIssue", "이슈 참조")}</>}
          </div>
          <div className="p-1 max-h-72 overflow-y-auto">
            {mentionResults.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                {mentionKind === "issue" && !projectId
                  ? "프로젝트 스페이스에서만 가능"
                  : (mentionQuery ? "검색 결과 없음" : "이름/제목 입력...")}
              </div>
            ) : (() => {
              /* 접힌 부모의 자손을 숨김 */
              const visible: typeof mentionResults = [];
              const hidden = new Set<string>();
              for (const it of mentionResults) {
                if (it.parent && hidden.has(it.parent)) {
                  hidden.add(it.id);
                  continue;
                }
                visible.push(it);
                if (it.hasChildren && mentionCollapsed.has(it.id)) hidden.add(it.id);
              }
              return visible.map((item) => {
                const i = mentionResults.indexOf(item);
                const indent = (item.depth ?? 0) * 16;
                const isCollapsed = mentionCollapsed.has(item.id);
                return (
                  <button key={`${item.kind}-${item.id}`}
                    data-mention-item={i}
                    className={cn("flex items-center gap-2 w-full pr-3 py-2 rounded-lg text-sm text-left transition-colors",
                      i===mentionIdx?"bg-accent text-foreground":"text-muted-foreground hover:bg-accent/50")}
                    style={{ paddingLeft: `${12 + indent}px` }}
                    onMouseEnter={()=>setMentionIdx(i)}
                    onMouseDown={(e)=>{e.preventDefault();runMention(item);}}
                  >
                    {item.hasChildren ? (
                      <span
                        onMouseDown={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          setMentionCollapsed((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          });
                        }}
                        className="p-0.5 rounded hover:bg-foreground/10 shrink-0 cursor-pointer"
                      >
                        {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </span>
                    ) : <span className="w-4 shrink-0" />}
                    {item.kind === "user" && <UserIcon className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    {item.kind === "doc"  && <FileText className="h-3.5 w-3.5 shrink-0 text-blue-400" />}
                    {item.kind === "issue" && <Hash className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {item.identifier && <span className="text-2xs font-mono font-semibold text-muted-foreground/70">{item.identifier}</span>}
                        <span className="truncate text-foreground">{item.label}</span>
                      </div>
                      {item.sublabel && <div className="text-2xs text-muted-foreground truncate">{item.sublabel}</div>}
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>
      )}

      {emojiOpen && emojiPos && emojiFiltered.length > 0 && (
        <div className="fixed z-50 w-64 rounded-xl border bg-popover shadow-xl overflow-hidden" style={{top:emojiPos.top,left:emojiPos.left}}>
          <div className="p-1 max-h-64 overflow-y-auto">
            {emojiFiltered.slice(0, 12).map((em, i) => (
              <button key={em.name}
                data-emoji-item={i}
                className={cn("flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-left transition-colors",
                  i===emojiIdx?"bg-accent text-foreground":"text-muted-foreground hover:bg-accent/50")}
                onMouseEnter={()=>setEmojiIdx(i)}
                onMouseDown={(e)=>{e.preventDefault();runEmoji(em);}}
              >
                <span className="text-lg shrink-0 leading-none">{em.char}</span>
                <span className="text-xs">:{em.name}:</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
    </DocEditorContext.Provider>
  );
}

/* ── Bubble Menu — 선택 시 플로팅 서식 바 ── */

const HIGHLIGHT_COLORS = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#e9d5ff"];
const TEXT_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#64748b"];

function EditorBubbleMenu({
  editor, onPickFile, onSetLink,
  linkEditorOpen, onCloseLinkEditor, onApplyLink,
}: {
  editor: Editor;
  onPickFile: () => void;
  onSetLink: () => void;
  linkEditorOpen: boolean;
  onCloseLinkEditor: () => void;
  onApplyLink: (url: string) => void;
}) {
  const [colorPickerOpen, setColorPickerOpen] = useState<"text" | "highlight" | null>(null);
  const [linkInput, setLinkInput] = useState("");

  /* 링크 편집 모드 열릴 때 기존 URL로 초기화 */
  useEffect(() => {
    if (linkEditorOpen) {
      setLinkInput(editor.getAttributes("link").href ?? "");
    }
  }, [linkEditorOpen, editor]);

  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: "top",
        pluginKey: "textBubbleMenu",
        middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
      }}
      shouldShow={({ editor, from, to, state }) => {
        /* 코드블록/노드 내부에서는 bubble 숨김. 테이블 안은 table-menu가 처리 */
        if (!editor.isEditable) return false;
        if (from === to) return false;
        if (editor.isActive("codeBlock")) return false;
        if (editor.isActive("table")) return false;
        if (editor.isActive("image") || editor.isActive("video") || editor.isActive("pdf") || editor.isActive("attachment")) return false;
        const empty = state.doc.textBetween(from, to).trim().length === 0;
        return !empty;
      }}
    >
      <div className="flex items-center gap-0.5 rounded-xl border bg-popover shadow-xl px-1 py-1"
        onMouseDown={(e) => e.preventDefault()}>
        {/* Node transform */}
        <NodeSelector editor={editor} />
        <BMSep />

        {/* Marks */}
        <BMBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)"><Bold className="h-3.5 w-3.5"/></BMBtn>
        <BMBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)"><Italic className="h-3.5 w-3.5"/></BMBtn>
        <BMBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (Ctrl+U)"><UnderlineIcon className="h-3.5 w-3.5"/></BMBtn>
        <BMBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><Strikethrough className="h-3.5 w-3.5"/></BMBtn>
        <BMBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code"><Code className="h-3.5 w-3.5"/></BMBtn>

        <BMSep />

        {/* Text color */}
        <div className="relative">
          <BMBtn active={colorPickerOpen === "text"} onClick={() => setColorPickerOpen(colorPickerOpen === "text" ? null : "text")} title="Text color">
            <Palette className="h-3.5 w-3.5" />
          </BMBtn>
          {colorPickerOpen === "text" && (
            <ColorPalette colors={TEXT_COLORS}
              onPick={(c) => { editor.chain().focus().setColor(c).run(); setColorPickerOpen(null); }}
              onClear={() => { editor.chain().focus().unsetColor().run(); setColorPickerOpen(null); }}
              onClose={() => setColorPickerOpen(null)}
            />
          )}
        </div>

        {/* Highlight */}
        <div className="relative">
          <BMBtn active={colorPickerOpen === "highlight" || editor.isActive("highlight")} onClick={() => setColorPickerOpen(colorPickerOpen === "highlight" ? null : "highlight")} title="Highlight">
            <Highlighter className="h-3.5 w-3.5" />
          </BMBtn>
          {colorPickerOpen === "highlight" && (
            <ColorPalette colors={HIGHLIGHT_COLORS}
              onPick={(c) => { editor.chain().focus().toggleHighlight({ color: c }).run(); setColorPickerOpen(null); }}
              onClear={() => { editor.chain().focus().unsetHighlight().run(); setColorPickerOpen(null); }}
              onClose={() => setColorPickerOpen(null)}
            />
          )}
        </div>

        <BMSep />

        {/* Alignment */}
        <BMBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left"><AlignLeft className="h-3.5 w-3.5"/></BMBtn>
        <BMBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center"><AlignCenter className="h-3.5 w-3.5"/></BMBtn>
        <BMBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align right"><AlignRight className="h-3.5 w-3.5"/></BMBtn>
        <BMBtn active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} title="Justify"><AlignJustify className="h-3.5 w-3.5"/></BMBtn>

        <BMSep />

        {/* Link + Attach */}
        <BMBtn active={editor.isActive("link")} onClick={onSetLink} title="Link"><LinkIcon className="h-3.5 w-3.5"/></BMBtn>
        <BMBtn onClick={onPickFile} title="Attach"><Paperclip className="h-3.5 w-3.5"/></BMBtn>

        {/* 링크 편집 인라인 팝오버 */}
        {linkEditorOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 flex items-center gap-1 rounded-xl border bg-popover shadow-xl px-2 py-1.5"
               onMouseDown={(e) => e.stopPropagation()}>
            <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={linkInput}
              placeholder="https://..."
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); onApplyLink(linkInput); }
                if (e.key === "Escape") { e.preventDefault(); onCloseLinkEditor(); }
              }}
              className="flex-1 bg-transparent outline-none text-sm px-1 min-w-0"
            />
            {editor.isActive("link") && (
              <button title="Unlink" type="button"
                onClick={() => onApplyLink("")}
                className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" onClick={() => onApplyLink(linkInput)}
              className="text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
              적용
            </button>
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}

/* Node selector — 선택한 텍스트를 H1/H2/Paragraph 등으로 변환 */
function NodeSelector({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const items = [
    { label: "Text",       check: () => editor.isActive("paragraph") && !editor.isActive("heading"), run: () => editor.chain().focus().setParagraph().run() },
    { label: "Heading 1",  check: () => editor.isActive("heading", { level: 1 }), run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: "Heading 2",  check: () => editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Heading 3",  check: () => editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "Bullet List",   check: () => editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbered List", check: () => editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Task List",     check: () => editor.isActive("taskList"), run: () => editor.chain().focus().toggleTaskList().run() },
    { label: "Quote",      check: () => editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: "Code Block", check: () => editor.isActive("codeBlock"), run: () => editor.chain().focus().toggleCodeBlock().run() },
  ];
  const current = items.find((i) => i.check())?.label ?? "Text";
  return (
    <div className="relative">
      <button type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-7 px-2 rounded-md text-xs font-medium text-foreground/80 hover:bg-accent flex items-center gap-1 transition-colors">
        {current}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 w-40 rounded-lg border bg-popover shadow-xl p-1">
            {items.map((it) => (
              <button key={it.label} type="button"
                onMouseDown={(e) => { e.preventDefault(); it.run(); setOpen(false); }}
                className={cn("flex w-full px-2 py-1.5 text-xs rounded text-left transition-colors",
                  it.check() ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50")}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ColorPalette({ colors, onPick, onClear, onClose }: {
  colors: string[];
  onPick: (c: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 rounded-lg border bg-popover shadow-xl p-2 flex items-center gap-1">
        {colors.map((c) => (
          <button key={c} type="button" onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
            title={c}
            className="h-5 w-5 rounded-md border border-border/50 hover:scale-110 transition-transform"
            style={{ background: c }} />
        ))}
        <div className="w-px h-4 bg-border mx-0.5" />
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onClear(); }}
          title="Clear" className="text-2xs text-muted-foreground hover:text-foreground px-1.5">
          None
        </button>
      </div>
    </>
  );
}

/* ── 테이블 전용 BubbleMenu ── */
function TableBubbleMenu({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: "top",
        pluginKey: "tableBubbleMenu",
        middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
      }}
      shouldShow={({ editor }) => editor.isEditable && editor.isActive("table")}
    >
      <div className="flex items-center gap-0.5 rounded-xl border bg-popover shadow-xl px-1 py-1"
        onMouseDown={(e) => e.preventDefault()}>
        <BMBtn onClick={() => editor.chain().focus().addColumnBefore().run()} title="Column before">
          <span className="text-xs font-semibold">+◀</span>
        </BMBtn>
        <BMBtn onClick={() => editor.chain().focus().addColumnAfter().run()} title="Column after">
          <span className="text-xs font-semibold">▶+</span>
        </BMBtn>
        <BMBtn onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column">
          <ColumnsIcon className="h-3.5 w-3.5" />
        </BMBtn>
        <BMSep />
        <BMBtn onClick={() => editor.chain().focus().addRowBefore().run()} title="Row before">
          <span className="text-xs font-semibold">+▲</span>
        </BMBtn>
        <BMBtn onClick={() => editor.chain().focus().addRowAfter().run()} title="Row after">
          <span className="text-xs font-semibold">▼+</span>
        </BMBtn>
        <BMBtn onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row">
          <Rows3 className="h-3.5 w-3.5" />
        </BMBtn>
        <BMSep />
        <BMBtn onClick={() => editor.chain().focus().toggleHeaderRow().run()} title="Toggle header row">
          <span className="text-xs font-bold">H↔</span>
        </BMBtn>
        <BMBtn onClick={() => editor.chain().focus().toggleHeaderColumn().run()} title="Toggle header column">
          <span className="text-xs font-bold">H↕</span>
        </BMBtn>
        <BMSep />
        <BMBtn onClick={() => editor.chain().focus().mergeCells().run()} title="Merge cells">
          <Merge className="h-3.5 w-3.5" />
        </BMBtn>
        <BMBtn onClick={() => editor.chain().focus().splitCell().run()} title="Split cell">
          <Split className="h-3.5 w-3.5" />
        </BMBtn>
        <BMSep />
        <button type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().deleteTable().run()}
          title="Delete table"
          className="h-7 w-7 flex items-center justify-center rounded-md text-destructive hover:bg-destructive/15 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </BubbleMenu>
  );
}

function BMBtn({ children, active, onClick, title }: { children: React.ReactNode; active?: boolean; onClick: () => void; title: string }) {
  return (
    <button type="button" onClick={onClick} title={title}
      onMouseDown={(e) => e.preventDefault()}
      className={cn("h-7 w-7 flex items-center justify-center rounded-md transition-colors",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
      {children}
    </button>
  );
}
function BMSep() { return <div className="w-px h-4 bg-border mx-0.5" />; }

/* ── Search & Replace 바 ── */
function SearchBar({
  editor, query, setQuery, replaceQuery, setReplaceQuery, replaceShown, setReplaceShown, onClose,
}: {
  editor: Editor;
  query: string; setQuery: (s: string) => void;
  replaceQuery: string; setReplaceQuery: (s: string) => void;
  replaceShown: boolean; setReplaceShown: (b: boolean) => void;
  onClose: () => void;
}) {
  const results = (editor.storage as any).searchAndReplace?.results ?? [];
  const resultIdx = (editor.storage as any).searchAndReplace?.resultIndex ?? 0;
  const total = results.length;

  return (
    <div className="absolute top-2 right-4 z-40 flex items-center gap-1 rounded-xl border bg-popover shadow-xl px-2 py-1.5">
      <Search className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) editor.commands.previousSearchResult();
            else editor.commands.nextSearchResult();
          }
        }}
        className="w-44 bg-transparent outline-none text-sm px-1"
      />
      <span className="text-2xs text-muted-foreground tabular-nums px-1 min-w-[42px] text-center">
        {total === 0 ? "0/0" : `${Math.min(resultIdx + 1, total)}/${total}`}
      </span>
      <button title="Previous" onClick={() => editor.commands.previousSearchResult()}
        className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button title="Next" onClick={() => editor.commands.nextSearchResult()}
        className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      <button title="Replace" onClick={() => setReplaceShown(!replaceShown)}
        className={cn("h-6 w-6 flex items-center justify-center rounded-md transition-colors",
          replaceShown ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
        <Replace className="h-3.5 w-3.5" />
      </button>
      {replaceShown && (
        <>
          <div className="w-px h-4 bg-border mx-0.5" />
          <input
            placeholder="Replace with..."
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            className="w-36 bg-transparent outline-none text-sm px-1"
          />
          <button onClick={() => editor.commands.replace()}
            className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            Replace
          </button>
          <button onClick={() => editor.commands.replaceAll()}
            className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            All
          </button>
        </>
      )}
      <div className="w-px h-4 bg-border mx-0.5" />
      <button title="Close (Esc)" onClick={onClose}
        className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
