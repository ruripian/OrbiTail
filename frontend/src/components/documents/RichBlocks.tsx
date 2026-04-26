/**
 * 리치 콘텐츠 블록 — 북마크 카드 / 이미지 갤러리.
 *
 * 둘 다 atom 노드 (NodeViewProps로 attrs 관리). content_html에 직렬화돼 영구 저장.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useRef, useState } from "react";
import { Link2, Loader2, ExternalLink, X, Plus, Image as ImageIcon, GripVertical, Columns2, Columns3, Columns4 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────
 * 북마크 카드 — URL 입력 → 미리보기 카드(제목/설명/대표이미지)
 *  메타 추출은 클라 fetch 가능한 oEmbed/OG 의존도가 있어 1차로는 URL/도메인/title만 사용.
 *  추가로 favicon은 google s2 endpoint로 표시.
 * ──────────────────────────────────────────────────────────── */

interface BookmarkAttrs { url: string; title?: string; description?: string; image?: string; }

function BookmarkCardView({ node, updateAttributes }: NodeViewProps) {
  const a = node.attrs as BookmarkAttrs;
  const [editing, setEditing] = useState(!a.url);
  const [draft, setDraft] = useState(a.url);

  const commit = () => {
    const url = draft.trim();
    if (!url) return;
    /* http:// 가 없으면 https:// 자동 부여 */
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    let host = normalized;
    let title = "";
    try {
      const u = new URL(normalized);
      host = u.host;
      /* 경로 마지막 세그먼트를 제목 후보로 */
      title = u.pathname.split("/").filter(Boolean).pop() || u.host;
      title = decodeURIComponent(title).replace(/[-_]/g, " ");
    } catch { /* 잘못된 URL */ }
    updateAttributes({ url: normalized, title: title || host, description: host });
    setEditing(false);
  };

  if (editing || !a.url) {
    return (
      <NodeViewWrapper as="div" className="my-3 rounded-lg border border-dashed bg-muted/20 p-4" contentEditable={false}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Link2 className="h-3.5 w-3.5" />
          북마크 URL
        </div>
        <div className="flex gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
            placeholder="https://..."
            className="flex-1 h-8 px-3 text-sm rounded-md border bg-background outline-none focus:border-primary"
          />
          <button
            onClick={commit}
            disabled={!draft.trim()}
            className="h-8 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            추가
          </button>
        </div>
      </NodeViewWrapper>
    );
  }

  let host = "";
  try { host = new URL(a.url).host; } catch { host = a.url; }
  const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

  return (
    <NodeViewWrapper as="div" className="my-3" contentEditable={false}>
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
      >
        <img
          src={favicon}
          alt=""
          className="h-8 w-8 rounded shrink-0 bg-muted"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate group-hover:text-primary">{a.title || host}</div>
          <div className="text-2xs text-muted-foreground truncate">{a.description || a.url}</div>
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        <button
          onClick={(e) => { e.preventDefault(); setEditing(true); setDraft(a.url); }}
          className="text-2xs text-muted-foreground hover:text-foreground px-2"
        >
          편집
        </button>
      </a>
    </NodeViewWrapper>
  );
}

export const BookmarkCard = Node.create({
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
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "bookmark-card",
        "data-url": node.attrs.url,
        "data-title": node.attrs.title,
      }),
      `🔗 ${node.attrs.title || node.attrs.url}`,
    ];
  },
  addNodeView() { return ReactNodeViewRenderer(BookmarkCardView); },
});


/* ────────────────────────────────────────────────────────────
 * 이미지 갤러리 — 여러 이미지를 그리드로. 컬럼 수 조절(2/3/4).
 *  업로드는 부모(에디터)가 onFileUpload prop을 통해 처리. 여기선 attrs.items 배열만 관리.
 *  attrs.items: Array<{ url: string; alt?: string }>
 *  드래그 재배치는 단순 ↑/↓ 버튼으로 (DnD 라이브러리 의존 회피)
 * ──────────────────────────────────────────────────────────── */

interface GalleryItem { url: string; alt?: string; }
interface GalleryAttrs { items: GalleryItem[]; columns: 2 | 3 | 4; }

function ImageGalleryView({ node, updateAttributes, editor }: NodeViewProps) {
  const a = node.attrs as GalleryAttrs;
  const items = a.items ?? [];
  const cols = a.columns ?? 3;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const editable = editor.isEditable;

  const onUploadStorage = (editor as any).storage?.fileUpload?.uploadFn as
    | ((file: File) => Promise<{ url: string; filename: string }>)
    | undefined;

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    setUploading(true);
    try {
      const uploaded: GalleryItem[] = [];
      for (const f of arr) {
        if (onUploadStorage) {
          const r = await onUploadStorage(f);
          uploaded.push({ url: r.url, alt: r.filename });
        } else {
          /* 폴백 — ObjectURL (페이지 새로고침 시 사라짐). 정상 업로드 인프라 필수 안내 */
          uploaded.push({ url: URL.createObjectURL(f), alt: f.name });
        }
      }
      updateAttributes({ items: [...items, ...uploaded] });
    } finally {
      setUploading(false);
    }
  };

  const removeAt = (i: number) => updateAttributes({ items: items.filter((_, j) => j !== i) });
  const moveAt = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    updateAttributes({ items: next });
  };
  const setCols = (c: 2 | 3 | 4) => updateAttributes({ columns: c });

  const gridCols = { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[cols];

  return (
    <NodeViewWrapper as="div" className="my-4 rounded-lg border bg-card overflow-hidden" contentEditable={false}>
      {editable && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b bg-muted/20">
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">이미지 갤러리</span>
          <span className="text-2xs text-muted-foreground">({items.length})</span>
          <div className="flex-1" />
          <div className="flex items-center rounded-md border bg-background p-0.5">
            {[2, 3, 4].map((c) => (
              <button
                key={c}
                onClick={() => setCols(c as 2 | 3 | 4)}
                className={cn(
                  "h-6 w-7 flex items-center justify-center rounded transition-colors",
                  cols === c ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                title={`${c}열`}
              >
                {c === 2 ? <Columns2 className="h-3 w-3" /> : c === 3 ? <Columns3 className="h-3 w-3" /> : <Columns4 className="h-3 w-3" />}
              </button>
            ))}
          </div>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 h-7 px-2 text-2xs rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            이미지 추가
          </button>
          <input
            ref={inputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }}
          />
        </div>
      )}

      {items.length === 0 ? (
        <div
          className="p-8 text-center text-xs text-muted-foreground"
          onDragOver={(e) => { if (editable) { e.preventDefault(); } }}
          onDrop={(e) => { if (editable) { e.preventDefault(); handleFiles(e.dataTransfer.files); } }}
        >
          {editable ? "이미지를 드래그하거나 위 + 버튼으로 추가" : "이미지 없음"}
        </div>
      ) : (
        <div className={cn("grid gap-2 p-2", gridCols)}>
          {items.map((it, i) => (
            <div key={i} className="relative group rounded-md overflow-hidden bg-muted">
              <img src={it.url} alt={it.alt || ""} className="w-full h-32 object-cover" loading="lazy" />
              {editable && (
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                  <button onClick={() => moveAt(i, -1)} disabled={i === 0}
                    className="h-6 w-6 rounded bg-background/90 text-foreground text-xs disabled:opacity-30" title="앞으로">←</button>
                  <button onClick={() => moveAt(i, 1)} disabled={i === items.length - 1}
                    className="h-6 w-6 rounded bg-background/90 text-foreground text-xs disabled:opacity-30" title="뒤로">→</button>
                  <button onClick={() => removeAt(i)}
                    className="h-6 w-6 rounded bg-background/90 text-destructive flex items-center justify-center" title="제거">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const ImageGallery = Node.create({
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
    const items = (node.attrs.items as GalleryItem[]) || [];
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "image-gallery",
        "data-columns": String(node.attrs.columns),
      }),
      ...items.map((it) => ["img", { src: it.url, alt: it.alt || "" }] as any),
    ];
  },
  addNodeView() { return ReactNodeViewRenderer(ImageGalleryView); },
});

// 사용하지 않는 import 표시 회피
export const __used_grip = GripVertical;
