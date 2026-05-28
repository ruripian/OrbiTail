/**
 * 리사이즈 가능한 이미지 노드 — TipTap 확장.
 *
 * 기능:
 *   - 4 코너 드래그로 크기 조절(width: %)
 *   - 클릭 시 상단 플로팅 툴바: 25/50/75/100% preset + 좌/중/우 정렬 + 다운로드
 *   - draggable + atom: 블록 단위 이동/선택
 *
 * 디자인 의도:
 *   DocumentEditor 의 ImageNode 와 동등한 UX 를 RichTextEditor(댓글/요청) 에서도 제공.
 *   CSS 는 index.css 의 `.doc-img*` 글로벌 클래스 재사용 — 두 에디터 시각 일관.
 *
 * 제한:
 *   - 위치 계산은 직접 (floating-ui 의존 회피). 스크롤/리사이즈 시 update 리스너로 갱신.
 *   - HTML 직렬화 시 NodeView 가 없으므로 data-width/data-align + 인라인 style 로 메타 보존.
 */
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { AlignLeft, AlignCenter, AlignRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";

type ImgAlign = "left" | "center" | "right";

/* TipTap commands 타입 보강 — editor.chain().setImage({...}) 호출 가능하도록 */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    resizableImage: {
      setImage: (options: { src: string; alt?: string }) => ReturnType;
    };
  }
}

function ImageNodeView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const src: string = node.attrs.src;
  const alt: string = node.attrs.alt ?? "";
  const width: string = node.attrs.width ?? "";
  const align: ImgAlign = (node.attrs.align ?? "center") as ImgAlign;
  const [tbOpen, setTbOpen] = useState(false);
  const [tbPos, setTbPos] = useState<{ top: number; left: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const isEditable = editor.isEditable;
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /* 선택 해제 시 툴바 자동 닫기 */
  useEffect(() => { if (!selected) setTbOpen(false); }, [selected]);

  /* 툴바 위치 — 이미지 상단 중앙. scroll/resize 시 자동 갱신. */
  useEffect(() => {
    if (!tbOpen || !imgRef.current) return;
    const update = () => {
      const el = imgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setTbPos({ top: r.top - 44, left: r.left + r.width / 2 });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [tbOpen, width, align]);

  const setWidth = (w: string) => updateAttributes({ width: w });
  const setAlign = (a: ImgAlign) => updateAttributes({ align: a });

  /* 마우스 드래그 리사이즈 — 코너 4개. dir 로 x 이동 부호 결정. */
  const startResize = (e: React.MouseEvent, dir: "left" | "right") => {
    e.preventDefault();
    e.stopPropagation();
    if (!boxRef.current) return;
    const startX = e.clientX;
    const startWidthPx = boxRef.current.getBoundingClientRect().width;
    const parentWidth = wrapRef.current?.getBoundingClientRect().width ?? startWidthPx;
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

  const boxStyle: React.CSSProperties = {
    width: width || "100%",
    marginLeft:  align === "right"  ? "auto" : align === "center" ? "auto" : 0,
    marginRight: align === "left"   ? "auto" : align === "center" ? "auto" : 0,
  };

  return (
    <NodeViewWrapper as="div" data-drag-handle ref={wrapRef as any} className="doc-img-wrap">
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
      {isEditable && tbOpen && selected && tbPos && createPortal(
        <div
          contentEditable={false}
          style={{
            position: "fixed",
            top: tbPos.top,
            left: tbPos.left,
            transform: "translateX(-50%)",
            zIndex: 10000,
          }}
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

export const ResizableImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src:   { default: null },
      alt:   { default: null },
      width: {
        default: null,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-width") ||
          (el as HTMLImageElement).style.width ||
          null,
      },
      align: {
        default: "center",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-align") || "center",
      },
    };
  },
  parseHTML() { return [{ tag: "img[src]" }]; },
  renderHTML({ HTMLAttributes }) {
    const { width, align, ...rest } = HTMLAttributes;
    /* NodeView 없는 환경(저장된 댓글 렌더 등)에서도 크기/정렬 메타 보존되도록 data-* + inline style. */
    const style: string[] = [];
    if (width) style.push(`width:${width}`);
    if (align === "left")        style.push("margin:0 auto 0 0");
    else if (align === "right")  style.push("margin:0 0 0 auto");
    else                         style.push("margin:0 auto");
    style.push("display:block");
    return ["img", mergeAttributes(rest, {
      "data-width": width || undefined,
      "data-align": align || undefined,
      class: "doc-img",
      style: style.join(";"),
    })];
  },
  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: options }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});
