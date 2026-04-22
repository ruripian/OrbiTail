/**
 * 리치 텍스트 에디터 — tiptap 기반
 *
 * - 기본: 선택 시 플로팅 메뉴(Notion 스타일)
 * - showToolbar: 상단 툴바(제목/볼드/이미지 등 전체 스타일)
 * - onImageUpload: 이미지 업로드 핸들러 (없으면 base64 인라인)
 */

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Bold, Italic, Strikethrough, Code, Quote, List, ListOrdered,
  Link as LinkIcon, Underline as UnderlineIcon, Image as ImageIcon,
  Heading1, Heading2, Heading3,
  AlignLeft, AlignCenter, AlignRight, Highlighter,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  editable?: boolean;
  minHeight?: string;
  autoFocus?: boolean;
  /** true면 상단 툴바를 표시 (이미지/제목/정렬 등 전체 기능) */
  showToolbar?: boolean;
  /** 이미지 업로드 핸들러 — resolve된 URL로 삽입. 미지정 시 base64 임베드. */
  onImageUpload?: (file: File) => Promise<string>;
}

export function RichTextEditor({
  content,
  onChange,
  onBlur,
  placeholder,
  editable = true,
  minHeight = "80px",
  autoFocus = false,
  showToolbar = false,
  onImageUpload,
}: Props) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [uploading, setUploading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: placeholder || t("editor.placeholder"),
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline cursor-pointer" },
      }),
      Underline,
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: "max-w-full rounded-md my-2" },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: false }),
    ],
    content,
    editable,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: "outline-none prose prose-sm dark:prose-invert max-w-none",
        style: `min-height: ${minHeight}`,
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
    onBlur: ({ event }) => {
      const related = (event as FocusEvent)?.relatedTarget as Node | null;
      if (menuRef.current?.contains(related)) return;
      onBlur?.();
    },
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to } = e.state.selection;
      if (from === to) setMenuPos(null);
    },
  });

  /* 외부 content 변경 시 에디터 동기화 */
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content]);

  /* 드래그 완료(mouseup) 시 선택 영역이 있으면 플로팅 메뉴 표시 */
  useEffect(() => {
    const handleMouseUp = () => {
      if (!editor) return;
      requestAnimationFrame(() => {
        if (!editor) return;
        const { from, to } = editor.state.selection;
        if (from === to) { setMenuPos(null); return; }
        const domSel = window.getSelection();
        if (!domSel || domSel.rangeCount === 0) { setMenuPos(null); return; }
        const range = domSel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0) { setMenuPos(null); return; }
        const menuHeight = 40;
        const gap = 8;
        setMenuPos({
          top: rect.top - menuHeight - gap,
          left: rect.left + rect.width / 2,
        });
      });
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [editor]);

  /* 링크 삽입 */
  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href;
    const url = window.prompt("URL", prev || "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  /* 이미지 업로드 — onImageUpload 핸들러가 있으면 그걸로, 없으면 base64 */
  const insertImage = useCallback(async (file: File) => {
    if (!editor) return;
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      let url: string;
      if (onImageUpload) {
        url = await onImageUpload(file);
      } else {
        // base64 임베드 — 5MB 이하만
        if (file.size > 5 * 1024 * 1024) {
          alert("이미지가 5MB 를 초과합니다. 더 작은 파일을 사용해주세요.");
          return;
        }
        url = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      }
      editor.chain().focus().setImage({ src: url }).run();
    } catch (e) {
      console.error(e);
      alert("이미지 업로드 실패");
    } finally {
      setUploading(false);
    }
  }, [editor, onImageUpload]);

  /* 파일 선택 다이얼로그 */
  const openImagePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /* 붙여넣기·드롭 이미지 */
  useEffect(() => {
    if (!editor) return;
    const el = wrapperRef.current;
    if (!el) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            insertImage(f);
            return;
          }
        }
      }
    };
    const handleDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      const img = Array.from(files).find((f) => f.type.startsWith("image/"));
      if (img) {
        e.preventDefault();
        insertImage(img);
      }
    };
    el.addEventListener("paste", handlePaste as any);
    el.addEventListener("drop", handleDrop as any);
    return () => {
      el.removeEventListener("paste", handlePaste as any);
      el.removeEventListener("drop", handleDrop as any);
    };
  }, [editor, insertImage]);

  if (!editor) return null;

  return (
    <div
      ref={wrapperRef}
      className="relative rounded-md border border-border hover:border-border focus-within:border-primary/50 bg-card/50 transition-colors cursor-text"
      onClick={(e) => {
        if (e.target === e.currentTarget && !editor.isFocused) editor.chain().focus().run();
      }}
    >
      {/* 숨겨진 파일 인풋 — 이미지 업로드용 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) insertImage(f);
          e.target.value = "";
        }}
      />

      {/* 상단 툴바 */}
      {showToolbar && (
        <Toolbar editor={editor} onLink={setLink} onImage={openImagePicker} uploading={uploading} />
      )}

      {/* 선택 시 플로팅 메뉴 */}
      {menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] flex items-center gap-0.5 rounded-lg border bg-popover px-1 py-1 shadow-lg animate-in fade-in zoom-in-95 duration-100"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            transform: "translateX(-50%)",
          }}
        >
          <BubbleBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title={t("editor.bold")}><Bold className="h-3.5 w-3.5" /></BubbleBtn>
          <BubbleBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title={t("editor.italic")}><Italic className="h-3.5 w-3.5" /></BubbleBtn>
          <BubbleBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title={t("editor.underline", "밑줄")}><UnderlineIcon className="h-3.5 w-3.5" /></BubbleBtn>
          <BubbleBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title={t("editor.strikethrough")}><Strikethrough className="h-3.5 w-3.5" /></BubbleBtn>
          <BubbleBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title={t("editor.code")}><Code className="h-3.5 w-3.5" /></BubbleBtn>

          <div className="w-px h-4 bg-border/50 mx-0.5" />

          <BubbleBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t("editor.bulletList")}><List className="h-3.5 w-3.5" /></BubbleBtn>
          <BubbleBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t("editor.orderedList")}><ListOrdered className="h-3.5 w-3.5" /></BubbleBtn>
          <BubbleBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={t("editor.quote")}><Quote className="h-3.5 w-3.5" /></BubbleBtn>
          <BubbleBtn active={editor.isActive("link")} onClick={setLink} title={t("editor.link")}><LinkIcon className="h-3.5 w-3.5" /></BubbleBtn>
        </div>,
        document.body
      )}

      <div className={showToolbar ? "p-3" : "p-3"}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/* ── 상단 툴바 ── */
function Toolbar({
  editor, onLink, onImage, uploading,
}: {
  editor: Editor;
  onLink: () => void;
  onImage: () => void;
  uploading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-border bg-card/95 backdrop-blur-sm px-2 py-1.5 rounded-t-md">
      <ToolbarBtn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="H1"><Heading1 className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="H2"><Heading2 className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="H3"><Heading3 className="h-3.5 w-3.5" /></ToolbarBtn>
      <Sep />
      <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title={t("editor.bold")}><Bold className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title={t("editor.italic")}><Italic className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title={t("editor.underline", "밑줄")}><UnderlineIcon className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title={t("editor.strikethrough")}><Strikethrough className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title={t("editor.code")}><Code className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()} title={t("editor.highlight", "형광펜")}><Highlighter className="h-3.5 w-3.5" /></ToolbarBtn>
      <Sep />
      <ToolbarBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t("editor.bulletList")}><List className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t("editor.orderedList")}><ListOrdered className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={t("editor.quote")}><Quote className="h-3.5 w-3.5" /></ToolbarBtn>
      <Sep />
      <ToolbarBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title={t("editor.alignLeft", "왼쪽 정렬")}><AlignLeft className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title={t("editor.alignCenter", "가운데 정렬")}><AlignCenter className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title={t("editor.alignRight", "오른쪽 정렬")}><AlignRight className="h-3.5 w-3.5" /></ToolbarBtn>
      <Sep />
      <ToolbarBtn active={editor.isActive("link")} onClick={onLink} title={t("editor.link")}><LinkIcon className="h-3.5 w-3.5" /></ToolbarBtn>
      <ToolbarBtn onClick={onImage} title={t("editor.image", "이미지")} disabled={uploading}>
        <ImageIcon className="h-3.5 w-3.5" />
        {uploading && <span className="ml-1 text-2xs">…</span>}
      </ToolbarBtn>
    </div>
  );
}

function ToolbarBtn({
  active = false, onClick, title, children, disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
      title={title}
      disabled={disabled}
      className={cn(
        "inline-flex items-center px-1.5 py-1 rounded-md transition-colors",
        disabled && "opacity-50 cursor-wait",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-4 bg-border/50 mx-1 self-center" />;
}

function BubbleBtn({
  active = false, onClick, title, children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      title={title}
      className={cn(
        "p-1.5 rounded-md transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
    >
      {children}
    </button>
  );
}
