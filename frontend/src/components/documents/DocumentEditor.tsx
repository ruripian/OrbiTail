/**
 * 문서 에디터 — Heading, 서식, 코드블록, 이미지, 파일 첨부, / 명령어
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import LinkExt from "@tiptap/extension-link";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Node, mergeAttributes } from "@tiptap/core";
import { common, createLowlight } from "lowlight";
import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Quote, Minus, Heading1, Heading2, Heading3,
  Link as LinkIcon, Undo2, Redo2, CodeSquare,
  Paperclip, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

const lowlight = createLowlight(common);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── 이미지 노드 (리사이즈 가능) ── */
const ImageNode = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      width: { default: null },
    };
  },
  parseHTML() { return [{ tag: "img[src]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes, {
      class: "doc-img",
      style: HTMLAttributes.width ? `width:${HTMLAttributes.width}` : undefined,
    })];
  },
});

interface Props {
  content: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  editable?: boolean;
  onFileUpload?: (file: File) => Promise<{ url: string; filename: string }>;
}

/* ── 슬래시 명령어 ── */
interface SlashCmd { title: string; icon: React.ElementType; cmd: (e: any) => void; }
const CMDS: SlashCmd[] = [
  { title: "Heading 1", icon: Heading1, cmd: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { title: "Heading 2", icon: Heading2, cmd: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { title: "Heading 3", icon: Heading3, cmd: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { title: "Bullet List", icon: List, cmd: (e) => e.chain().focus().toggleBulletList().run() },
  { title: "Numbered List", icon: ListOrdered, cmd: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: "Quote", icon: Quote, cmd: (e) => e.chain().focus().toggleBlockquote().run() },
  { title: "Code Block", icon: CodeSquare, cmd: (e) => e.chain().focus().toggleCodeBlock().run() },
  { title: "Divider", icon: Minus, cmd: (e) => e.chain().focus().setHorizontalRule().run() },
];

export function DocumentEditor({ content, onChange, onBlur, placeholder, editable = true, onFileUpload }: Props) {
  const { t } = useTranslation();
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIdx, setSlashIdx] = useState(0);
  const [uploading, setUploading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      Placeholder.configure({ placeholder: placeholder || "Start typing..." }),
      LinkExt.configure({ openOnClick: false }),
      CodeBlockLowlight.configure({ lowlight }),
      ImageNode,
    ],
    content,
    editable,
    editorProps: {
      attributes: { class: "doc-editor outline-none min-h-[400px]" },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
      // 슬래시 트리거 체크
      const { from } = e.state.selection;
      const txt = e.state.doc.textBetween(Math.max(0, from - 20), from, "\n");
      const m = txt.match(/(?:^|\s)\/([\w]*)$/);
      if (m) {
        setSlashFilter(m[1].toLowerCase());
        setSlashIdx(0);
        const coords = e.view.coordsAtPos(from);
        setSlashPos({ top: coords.bottom + 4, left: coords.left });
        setSlashOpen(true);
      } else setSlashOpen(false);
    },
    onBlur: () => { onBlur?.(); setTimeout(() => setSlashOpen(false), 200); },
  });

  // content 동기화
  useEffect(() => {
    if (editor && content !== editor.getHTML()) editor.commands.setContent(content, { emitUpdate: false });
  }, [content]);

  const filtered = CMDS.filter((c) => !slashFilter || c.title.toLowerCase().includes(slashFilter));

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

  // 슬래시 키보드
  useEffect(() => {
    if (!slashOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, filtered.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); filtered[slashIdx] && runSlash(filtered[slashIdx]); }
      else if (e.key === "Escape") setSlashOpen(false);
    };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [slashOpen, slashIdx, filtered, runSlash]);

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
      } else if (onFileUpload) {
        const { url, filename } = await onFileUpload(file);
        // 파일 링크로 삽입 (ProseMirror가 <a> 태그를 지원)
        editor.chain().focus().insertContent(
          `<p><a href="${url}" target="_blank">${filename} (${formatFileSize(file.size)})</a></p>`
        ).run();
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
      for (const item of Array.from(e.clipboardData?.items || [])) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) { e.preventDefault(); insertFile(f); return; }
        }
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

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href;
    const url = window.prompt("URL", prev || "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const pickFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) insertFile(f); };
    input.click();
  }, [insertFile]);

  if (!editor) return null;

  return (
    <div className="flex flex-col h-full relative" ref={wrapperRef}>
      {editable && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b bg-muted/20 flex-wrap sticky top-0 z-10">
          <TB onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo"><Undo2 className="h-4 w-4" /></TB>
          <TB onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo"><Redo2 className="h-4 w-4" /></TB>
          <Sep />
          <TB active={editor.isActive("heading",{level:1})} onClick={()=>editor.chain().focus().toggleHeading({level:1}).run()} title="H1"><Heading1 className="h-4 w-4"/></TB>
          <TB active={editor.isActive("heading",{level:2})} onClick={()=>editor.chain().focus().toggleHeading({level:2}).run()} title="H2"><Heading2 className="h-4 w-4"/></TB>
          <TB active={editor.isActive("heading",{level:3})} onClick={()=>editor.chain().focus().toggleHeading({level:3}).run()} title="H3"><Heading3 className="h-4 w-4"/></TB>
          <Sep />
          <TB active={editor.isActive("bold")} onClick={()=>editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="h-4 w-4"/></TB>
          <TB active={editor.isActive("italic")} onClick={()=>editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="h-4 w-4"/></TB>
          <TB active={editor.isActive("strike")} onClick={()=>editor.chain().focus().toggleStrike().run()} title="Strike"><Strikethrough className="h-4 w-4"/></TB>
          <TB active={editor.isActive("code")} onClick={()=>editor.chain().focus().toggleCode().run()} title="Code"><Code className="h-4 w-4"/></TB>
          <Sep />
          <TB active={editor.isActive("bulletList")} onClick={()=>editor.chain().focus().toggleBulletList().run()} title="Bullets"><List className="h-4 w-4"/></TB>
          <TB active={editor.isActive("orderedList")} onClick={()=>editor.chain().focus().toggleOrderedList().run()} title="Numbers"><ListOrdered className="h-4 w-4"/></TB>
          <Sep />
          <TB active={editor.isActive("blockquote")} onClick={()=>editor.chain().focus().toggleBlockquote().run()} title="Quote"><Quote className="h-4 w-4"/></TB>
          <TB active={editor.isActive("codeBlock")} onClick={()=>editor.chain().focus().toggleCodeBlock().run()} title="Code Block"><CodeSquare className="h-4 w-4"/></TB>
          <TB onClick={()=>editor.chain().focus().setHorizontalRule().run()} title="Divider"><Minus className="h-4 w-4"/></TB>
          <Sep />
          <TB active={editor.isActive("link")} onClick={setLink} title="Link"><LinkIcon className="h-4 w-4"/></TB>
          <TB onClick={pickFile} title="Attach"><Paperclip className="h-4 w-4"/></TB>
        </div>
      )}

      {uploading && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-b text-xs text-primary">
          <div className="h-3 w-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          Uploading...
        </div>
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
                className={cn("flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-left transition-colors",
                  i===slashIdx?"bg-accent text-foreground":"text-muted-foreground hover:bg-accent/50")}
                onMouseEnter={()=>setSlashIdx(i)}
                onMouseDown={(e)=>{e.preventDefault();runSlash(c);}}
              ><Icon className="h-4 w-4 shrink-0"/><span>{c.title}</span></button>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TB({children,active,disabled,onClick,title}:{children:React.ReactNode;active?:boolean;disabled?:boolean;onClick:()=>void;title:string}) {
  return <button type="button" onClick={onClick} disabled={disabled} title={title}
    className={cn("flex items-center justify-center h-8 w-8 rounded-md transition-colors",
      active?"bg-primary/15 text-primary":"text-muted-foreground hover:bg-accent hover:text-foreground",
      disabled&&"opacity-30 pointer-events-none")}>{children}</button>;
}
function Sep(){return <div className="w-px h-5 bg-border mx-1"/>;}
