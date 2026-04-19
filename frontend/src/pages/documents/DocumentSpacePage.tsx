/**
 * 문서 스페이스 페이지 — 에디터 + 도구 모음.
 * 사이드바(트리)는 DocumentLayout에서 관리.
 */

import { useState, useMemo, useCallback } from "react";
import { useParams, useOutletContext, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  FileText, Loader2, Pencil, Eye, Share2, MessageSquare,
  List, MoreHorizontal, Copy, Maximize2, Minimize2,
  History, FolderInput, Download, Printer, FileDown, Trash2, LayoutGrid,
} from "lucide-react";
import { documentsApi } from "@/api/documents";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Document as DocType } from "@/types";

interface LayoutContext {
  activeSpaceId: string;
  invalidate: () => void;
}

export default function DocumentSpacePage() {
  const { t } = useTranslation();
  const { workspaceSlug, spaceId, docId } = useParams<{
    workspaceSlug: string;
    spaceId: string;
    docId?: string;
  }>();
  const qc = useQueryClient();
  const ctx = useOutletContext<LayoutContext | undefined>();

  const { data: currentDoc, isLoading } = useQuery({
    queryKey: ["document", workspaceSlug, spaceId, docId],
    queryFn: () => documentsApi.get(workspaceSlug!, spaceId!, docId!),
    enabled: !!docId && !!spaceId,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<DocType>) =>
      documentsApi.update(workspaceSlug!, spaceId!, docId!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document", workspaceSlug, spaceId, docId] });
      ctx?.invalidate();
    },
  });

  if (!docId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <FileText className="h-12 w-12 opacity-20" />
        <p className="text-sm">{t("documents.selectDoc")}</p>
      </div>
    );
  }

  if (isLoading || !currentDoc) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <DocumentEditorView
      doc={currentDoc}
      onUpdate={(data) => updateMutation.mutate(data)}
      onDelete={() => {
        if (window.confirm(t("documents.deleteConfirm"))) {
          documentsApi.delete(workspaceSlug!, spaceId!, docId!).then(() => {
            toast.success(t("documents.deleted"));
            ctx?.invalidate();
            window.history.back();
          });
        }
      }}
    />
  );
}

/* ── 에디터 뷰 + 도구 모음 ── */

function DocumentEditorView({
  doc, onUpdate, onDelete,
}: {
  doc: DocType;
  onUpdate: (data: Partial<DocType>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { workspaceSlug, spaceId } = useParams<{ workspaceSlug: string; spaceId: string }>();
  const navigate = useNavigate();
  const [title, setTitle] = useState(doc.title);
  const [editMode, setEditMode] = useState(true);
  const [fullWidth, setFullWidth] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const contentRef = { current: doc.content_html };

  // 마크다운 복사
  const copyAsMarkdown = useCallback(() => {
    // 간단한 HTML → Markdown 변환
    let md = contentRef.current
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n")
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n")
      .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
      .replace(/<em>(.*?)<\/em>/gi, "*$1*")
      .replace(/<code>(.*?)<\/code>/gi, "`$1`")
      .replace(/<li>(.*?)<\/li>/gi, "- $1\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<p>(.*?)<\/p>/gi, "$1\n\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    navigator.clipboard.writeText(md);
    toast.success(t("documents.copiedMarkdown"));
  }, [t]);

  // 인쇄
  const handlePrint = useCallback(() => window.print(), []);

  // HTML 내보내기 (다운로드)
  const exportDocx = useCallback(() => {
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.2em}code{background:#f4f4f4;padding:2px 6px;border-radius:3px}pre{background:#f4f4f4;padding:16px;border-radius:8px;overflow-x:auto}blockquote{border-left:3px solid #ddd;margin:0;padding-left:16px;color:#666}</style></head><body><h1>${title}</h1>${contentRef.current}</body></html>`;
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "document"}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("documents.exported"));
  }, [title, t]);

  // docx 가져오기
  const importDocx = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const mammoth = await import("mammoth");
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        onUpdate({ content_html: result.value });
        toast.success(t("documents.imported"));
      } catch {
        toast.error(t("documents.importFailed"));
      }
    };
    input.click();
  }, [onUpdate, t]);

  return (
    <div className="flex flex-col h-full">
      {/* 도구 모음 바 */}
      <div className="flex items-center gap-1.5 h-11 px-4 border-b shrink-0" data-print-hide>
        {/* 편집/읽기 토글 */}
        <div className="flex items-center rounded-lg border bg-muted/30 p-0.5">
          <button
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              editMode ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setEditMode(true)}
          >
            <Pencil className="h-3 w-3" />
            {t("documents.edit")}
          </button>
          <button
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              !editMode ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              // 읽기 모드 전환 전 저장
              if (contentRef.current !== doc.content_html) onUpdate({ content_html: contentRef.current });
              setEditMode(false);
            }}
          >
            <Eye className="h-3 w-3" />
            {t("documents.read")}
          </button>
        </div>

        <div className="flex-1" />

        {/* 우측 도구 */}
        {/* 공유 */}
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 px-2.5"
          onClick={() => {
            navigator.clipboard.writeText(window.location.href);
            toast.success(t("documents.linkCopied"));
          }}
        >
          <Share2 className="h-3.5 w-3.5" />
          {t("documents.share")}
        </Button>

        {/* 댓글 */}
        <Button
          variant={commentsOpen ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs gap-1.5 px-2.5"
          onClick={() => setCommentsOpen(!commentsOpen)}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {t("documents.comments")}
        </Button>

        {/* 목차 */}
        <Button
          variant={tocOpen ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs gap-1.5 px-2.5"
          onClick={() => setTocOpen(!tocOpen)}
        >
          <List className="h-3.5 w-3.5" />
          {t("documents.toc")}
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 전체 너비 토글 */}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFullWidth(!fullWidth)}>
          {fullWidth ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>

        {/* 설정 드롭다운 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}/explorer`)}>
              <LayoutGrid className="h-3.5 w-3.5 mr-2" />
              {t("documents.explorer")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={copyAsMarkdown}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              {t("documents.copyMarkdown")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFullWidth(!fullWidth)}>
              {fullWidth ? <Minimize2 className="h-3.5 w-3.5 mr-2" /> : <Maximize2 className="h-3.5 w-3.5 mr-2" />}
              {t("documents.fullWidth")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setHistoryOpen(!historyOpen)}>
              <History className="h-3.5 w-3.5 mr-2" />
              {t("documents.pageHistory")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMoveOpen(true)}>
              <FolderInput className="h-3.5 w-3.5 mr-2" />
              {t("documents.moveTo")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportDocx}>
              <Download className="h-3.5 w-3.5 mr-2" />
              {t("documents.exportDocx")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={importDocx}>
              <Download className="h-3.5 w-3.5 mr-2 rotate-180" />
              {t("documents.importDocx")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5 mr-2" />
              {t("documents.print")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handlePrint}>
              <FileDown className="h-3.5 w-3.5 mr-2" />
              {t("documents.printPdf")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              {t("documents.trash")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 에디터 + 목차 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 에디터 영역 */}
        <div className="flex-1 overflow-y-auto">
          <div className={cn("mx-auto w-full py-12 px-8", fullWidth ? "max-w-none px-16" : "max-w-[720px]")}>
            <input
              className="w-full text-4xl font-bold bg-transparent outline-none mb-1 placeholder:text-muted-foreground/30"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { if (title.trim() !== doc.title) onUpdate({ title: title.trim() }); }}
              placeholder={t("documents.untitled")}
              readOnly={!editMode}
            />
            <div className="h-px bg-border/50 mb-8" />

            <DocumentEditor
              key={doc.id}
              content={doc.content_html}
              onChange={(html) => { contentRef.current = html; }}
              onBlur={() => {
                if (contentRef.current !== doc.content_html) onUpdate({ content_html: contentRef.current });
              }}
              placeholder={t("documents.startTyping")}
              editable={editMode}
              onFileUpload={async (file) => {
                const result = await documentsApi.attachments.upload(workspaceSlug!, spaceId!, doc.id, file);
                return { url: result.file_url || result.file, filename: result.filename };
              }}
            />

            {/* 하위 문서 */}
            <SubDocuments
              workspaceSlug={workspaceSlug!}
              spaceId={spaceId!}
              parentId={doc.id}
            />
          </div>
        </div>

        {/* 목차 패널 */}
        {tocOpen && (
          <aside className="w-56 border-l overflow-y-auto p-3 shrink-0 hidden lg:block" data-print-hide>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t("documents.toc")}
            </p>
            <TableOfContents html={contentRef.current} />
          </aside>
        )}

        {/* 버전 히스토리 패널 */}
        {historyOpen && (
          <aside className="w-64 border-l overflow-y-auto shrink-0 hidden lg:block" data-print-hide>
            <VersionHistoryPanel
              workspaceSlug={workspaceSlug!}
              spaceId={spaceId!}
              docId={doc.id}
              onRestore={(html) => {
                onUpdate({ content_html: html });
                setHistoryOpen(false);
                toast.success(t("documents.versionRestored"));
              }}
              onClose={() => setHistoryOpen(false)}
            />
          </aside>
        )}

        {commentsOpen && (
          <aside className="w-72 border-l overflow-y-auto shrink-0 hidden lg:block" data-print-hide>
            <CommentsPanel
              workspaceSlug={workspaceSlug!}
              spaceId={spaceId!}
              docId={doc.id}
              onClose={() => setCommentsOpen(false)}
            />
          </aside>
        )}
      </div>

      {/* 이동 다이얼로그 */}
      {moveOpen && (
        <MoveDocumentDialog
          workspaceSlug={workspaceSlug!}
          spaceId={spaceId!}
          docId={doc.id}
          onMoved={() => { setMoveOpen(false); onUpdate({}); }}
          onClose={() => setMoveOpen(false)}
        />
      )}
    </div>
  );
}

/* ── 목차 ── */

function TableOfContents({ html }: { html: string }) {
  const headings = useMemo(() => {
    const matches = [...html.matchAll(/<h([1-3])[^>]*>(.*?)<\/h[1-3]>/gi)];
    return matches.map((m, i) => ({
      id: i,
      level: parseInt(m[1]),
      text: m[2].replace(/<[^>]+>/g, ""), // 태그 제거
    }));
  }, [html]);

  if (headings.length === 0) {
    return <p className="text-xs text-muted-foreground/50 italic">No headings</p>;
  }

  return (
    <div className="space-y-0.5">
      {headings.map((h) => (
        <button
          key={h.id}
          className="block w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors truncate py-0.5"
          style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
          onClick={() => {
            // 해당 heading으로 스크롤
            const els = document.querySelectorAll(`.ProseMirror h${h.level}`);
            els[headings.filter((x) => x.level === h.level && x.id <= h.id).length - 1]
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        >
          {h.text}
        </button>
      ))}
    </div>
  );
}

/* ── 버전 히스토리 패널 ── */

function VersionHistoryPanel({
  workspaceSlug, spaceId, docId, onRestore, onClose,
}: {
  workspaceSlug: string;
  spaceId: string;
  docId: string;
  onRestore: (html: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ["document-versions", workspaceSlug, spaceId, docId],
    queryFn: () => documentsApi.versions.list(workspaceSlug, spaceId, docId),
  });

  const saveMutation = useMutation({
    mutationFn: () => documentsApi.versions.create(workspaceSlug, spaceId, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-versions", workspaceSlug, spaceId, docId] });
      toast.success(t("documents.versionSaved"));
    },
  });

  const fmtDate = (d: string) => {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <p className="text-xs font-semibold">{t("documents.pageHistory")}</p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-2xs"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {t("documents.saveVersion")}
          </Button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5">
            <span className="text-sm">×</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t("common.loading")}</div>
        ) : versions.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t("documents.noVersions")}</div>
        ) : (
          <div className="divide-y">
            {versions.map((v) => (
              <div key={v.id} className="px-3 py-2.5 hover:bg-accent/30 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">v{v.version_number}</span>
                  <span className="text-2xs text-muted-foreground">{fmtDate(v.created_at)}</span>
                </div>
                <p className="text-2xs text-muted-foreground truncate mt-0.5">
                  {v.created_by_detail?.display_name ?? "System"}
                </p>
                <button
                  className="text-2xs text-primary hover:underline mt-1"
                  onClick={() => onRestore(v.content_html)}
                >
                  {t("documents.restoreVersion")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 댓글 패널 ── */

function CommentsPanel({
  workspaceSlug, spaceId, docId, onClose,
}: {
  workspaceSlug: string;
  spaceId: string;
  docId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [newComment, setNewComment] = useState("");

  const { data: comments = [] } = useQuery({
    queryKey: ["doc-comments", workspaceSlug, spaceId, docId],
    queryFn: () => documentsApi.comments.list(workspaceSlug, spaceId, docId),
  });

  const createMutation = useMutation({
    mutationFn: () => documentsApi.comments.create(workspaceSlug, spaceId, docId, newComment.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc-comments", workspaceSlug, spaceId, docId] });
      setNewComment("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => documentsApi.comments.delete(workspaceSlug, spaceId, docId, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-comments", workspaceSlug, spaceId, docId] }),
  });

  const fmtDate = (d: string) => {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <p className="text-xs font-semibold">{t("documents.comments")}</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 text-sm">×</button>
      </div>
      <div className="p-3 border-b">
        <textarea
          className="w-full text-sm bg-muted/30 border rounded-lg px-3 py-2 resize-none outline-none focus:border-primary/50 min-h-[60px]"
          placeholder={t("documents.commentPlaceholder")}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && newComment.trim()) {
              e.preventDefault();
              createMutation.mutate();
            }
          }}
        />
        <Button size="sm" className="mt-2 w-full h-7 text-xs"
          disabled={!newComment.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {t("documents.postComment")}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {comments.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground text-center">{t("documents.noComments")}</p>
        ) : (
          <div className="divide-y">
            {comments.map((c) => (
              <div key={c.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{c.author_detail?.display_name ?? "—"}</span>
                  <span className="text-2xs text-muted-foreground">{fmtDate(c.created_at)}</span>
                </div>
                <p className="text-sm mt-1 whitespace-pre-wrap">{c.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 문서 이동 다이얼로그 ── */

function MoveDocumentDialog({
  workspaceSlug, spaceId, docId, onMoved, onClose,
}: {
  workspaceSlug: string; spaceId: string; docId: string;
  onMoved: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: allDocs = [] } = useQuery({
    queryKey: ["documents", workspaceSlug, spaceId, "all"],
    queryFn: () => documentsApi.list(workspaceSlug, spaceId, { all: "true" }),
  });
  const folders = allDocs.filter((d) => d.is_folder && d.id !== docId);

  const handleMove = async (parentId: string | null) => {
    await documentsApi.move(workspaceSlug, spaceId, docId, { parent: parentId });
    toast.success(t("documents.moved"));
    onMoved();
  };

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-background/60" onClick={onClose} />
      <div className="fixed z-[101] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 rounded-xl border bg-popover shadow-2xl">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-semibold">{t("documents.moveTo")}</p>
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          <button
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
            onClick={() => handleMove(null)}
          >
            <FolderInput className="h-4 w-4 text-muted-foreground" />
            {t("documents.rootFolder")}
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
              onClick={() => handleMove(f.id)}
            >
              <FolderOpen className="h-4 w-4 text-amber-500" />
              {f.title}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── 하위 문서 목록 ── */

function SubDocuments({ workspaceSlug, spaceId, parentId }: {
  workspaceSlug: string; spaceId: string; parentId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: children = [] } = useQuery({
    queryKey: ["documents", workspaceSlug, spaceId, "children", parentId],
    queryFn: () => documentsApi.list(workspaceSlug, spaceId, { parent: parentId }),
  });

  if (children.length === 0) return null;

  return (
    <div className="mt-12 pt-6 border-t border-border/50">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {t("documents.subPages")}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {children.map((child) => (
          <button
            key={child.id}
            onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}/${child.id}`)}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group"
          >
            {child.is_folder
              ? <FolderOpen className="h-5 w-5 text-amber-500 shrink-0" />
              : <FileText className="h-5 w-5 text-blue-400 shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{child.title}</p>
              <p className="text-2xs text-muted-foreground mt-0.5">
                {new Date(child.updated_at).toLocaleDateString()}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
