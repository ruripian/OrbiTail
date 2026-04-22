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
  FolderOpen, FilePlus,
} from "lucide-react";
import { documentsApi } from "@/api/documents";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelHeader } from "@/components/ui/panel-header";
import { UserLine } from "@/components/ui/user-line";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/relative-time";
import type { Document as DocType, DocumentComment } from "@/types";

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

  /* 현재 스페이스 정보 — 멘션에서 issue 검색을 프로젝트로 제한하기 위해 */
  const { data: spaces = [] } = useQuery({
    queryKey: ["document-spaces", workspaceSlug],
    queryFn: () => documentsApi.spaces.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const currentSpace = spaces.find((s) => s.id === spaceId);
  const projectId = currentSpace?.space_type === "project" ? currentSpace?.project : null;

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
      <SpaceHome
        workspaceSlug={workspaceSlug!}
        spaceId={spaceId!}
        spaceName={currentSpace?.name ?? ""}
        onInvalidate={() => ctx?.invalidate()}
      />
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
      projectId={projectId ?? undefined}
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
  doc, projectId, onUpdate, onDelete,
}: {
  doc: DocType;
  projectId?: string;
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
          <div className={cn("mx-auto w-full py-6 px-4 sm:px-6", fullWidth ? "max-w-none" : "max-w-[860px]")}>
            <div className="doc-frame rounded-2xl border bg-card shadow-sm px-6 sm:px-10 py-8">
              <input
                className="w-full text-4xl font-bold bg-transparent outline-none mb-3"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => { if (title.trim() !== doc.title) onUpdate({ title: title.trim() }); }}
                readOnly={!editMode}
              />
              <div className="h-px bg-border/40 mb-4" />

              <DocumentEditor
              key={doc.id}
              content={doc.content_html}
              onChange={(html) => { contentRef.current = html; }}
              onBlur={() => {
                if (contentRef.current !== doc.content_html) onUpdate({ content_html: contentRef.current });
              }}
              editable={editMode}
              workspaceSlug={workspaceSlug}
              spaceId={spaceId}
              docId={doc.id}
              projectId={projectId}
              onFileUpload={async (file) => {
                const result = await documentsApi.attachments.upload(workspaceSlug!, spaceId!, doc.id, file);
                return { url: result.file_url || result.file, filename: result.filename };
              }}
            />
            </div>

            {/* 하위 문서 — 프레임 바깥, 인쇄에서 제외 */}
            <div data-print-hide>
              <SubDocuments
                workspaceSlug={workspaceSlug!}
                spaceId={spaceId!}
                parentId={doc.id}
              />
            </div>
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

/* ── 스페이스 홈 (문서 미선택 상태) ── */
function SpaceHome({
  workspaceSlug, spaceId, spaceName, onInvalidate,
}: {
  workspaceSlug: string;
  spaceId: string;
  spaceName: string;
  onInvalidate: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: docs = [] } = useQuery({
    queryKey: ["documents", workspaceSlug, spaceId, "all"],
    queryFn: () => documentsApi.list(workspaceSlug, spaceId, { all: "true" }),
    enabled: !!workspaceSlug && !!spaceId,
  });

  const recent = useMemo(() =>
    [...docs].filter((d) => !d.is_folder).sort((a, b) =>
      (b.updated_at ?? "").localeCompare(a.updated_at ?? "")
    ).slice(0, 8),
  [docs]);
  const rootDocs = useMemo(() => docs.filter((d) => !d.parent), [docs]);

  const createDoc = async () => {
    const doc = await documentsApi.create(workspaceSlug, spaceId, {
      title: t("documents.untitled"),
      is_folder: false,
    });
    onInvalidate();
    navigate(`/${workspaceSlug}/documents/space/${spaceId}/${doc.id}`);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[960px] mx-auto px-8 py-10">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              {t("documents.home", "홈")}
            </p>
            <h1 className="text-3xl font-bold">{spaceName || t("documents.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("documents.docCountTotal", "문서")} · {docs.filter((d) => !d.is_folder).length}
            </p>
          </div>
          <Button onClick={createDoc} className="gap-1.5">
            <FilePlus className="h-4 w-4" />
            {t("documents.newDocument")}
          </Button>
        </div>

        {/* 최근 업데이트 */}
        {recent.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {t("documents.recentlyUpdated", "최근 업데이트")}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((d) => (
                <button key={d.id}
                  onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}/${d.id}`)}
                  className="group flex items-start gap-3 px-4 py-3 rounded-xl border bg-card hover:border-border/80 hover:shadow-sm transition-all text-left"
                >
                  <FileText className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{d.title}</p>
                    <p className="text-2xs text-muted-foreground mt-0.5">
                      {formatRelativeTime(d.updated_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 루트 문서 트리 */}
        {rootDocs.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {t("documents.rootPages", "최상위 문서")}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {rootDocs.map((d) => (
                <button key={d.id}
                  onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}/${d.id}`)}
                  className="group flex items-center gap-3 px-4 py-3 rounded-xl border bg-card hover:border-border/80 hover:shadow-sm transition-all text-left"
                >
                  {d.is_folder
                    ? <FolderOpen className="h-5 w-5 text-amber-500 shrink-0" />
                    : <FileText className="h-5 w-5 text-blue-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{d.title}</p>
                    <p className="text-2xs text-muted-foreground mt-0.5">
                      {formatRelativeTime(d.updated_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {docs.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <FileText className="h-12 w-12 opacity-20 mx-auto mb-3" />
            <p className="text-sm">{t("documents.empty")}</p>
            <Button onClick={createDoc} className="mt-4 gap-1.5">
              <FilePlus className="h-4 w-4" />
              {t("documents.newDocument")}
            </Button>
          </div>
        )}
      </div>
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
  const [previewId, setPreviewId] = useState<string | null>(null);

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

  const preview = previewId ? versions.find((v) => v.id === previewId) : null;

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={t("documents.pageHistory")}
        onClose={onClose}
        actions={
          <Button
            variant="ghost" size="sm" className="h-6 text-2xs"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {t("documents.saveVersion")}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {isLoading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t("common.loading")}</div>
        ) : versions.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t("documents.noVersions")}</div>
        ) : (
          versions.map((v) => (
            <div
              key={v.id}
              className="group rounded-xl border bg-card px-3 py-2.5 hover:border-border/80 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-1 text-2xs font-mono font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                  v{v.version_number}
                </span>
                <span className="text-2xs text-muted-foreground tabular-nums">
                  {formatRelativeTime(v.created_at)}
                </span>
              </div>
              <UserLine
                name={v.created_by_detail?.display_name ?? "System"}
                avatar={v.created_by_detail?.avatar}
                timestamp={v.created_at}
                size="xs"
              />
              <div className="flex items-center gap-1 mt-2 opacity-60 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost" size="sm" className="h-6 px-2 text-2xs flex-1"
                  onClick={() => setPreviewId(v.id)}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  {t("documents.previewVersion")}
                </Button>
                <Button
                  variant="secondary" size="sm" className="h-6 px-2 text-2xs flex-1"
                  onClick={() => onRestore(v.content_html)}
                >
                  <History className="h-3 w-3 mr-1" />
                  {t("documents.restoreVersion")}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 미리보기 모달 */}
      {preview && (
        <VersionPreviewModal
          version={preview}
          onClose={() => setPreviewId(null)}
          onRestore={() => { onRestore(preview.content_html); setPreviewId(null); }}
        />
      )}
    </div>
  );
}

/* ── 버전 미리보기 모달 ── */

function VersionPreviewModal({
  version, onClose, onRestore,
}: {
  version: { id: string; version_number: number; title: string; content_html: string; created_at: string; created_by_detail?: { display_name: string } | null };
  onClose: () => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="fixed inset-0 z-[100] bg-background/70" onClick={onClose} />
      <div className="fixed z-[101] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(720px,90vw)] max-h-[85vh] rounded-xl border bg-popover shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 h-12 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 text-2xs font-mono font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">
              v{version.version_number}
            </span>
            <p className="text-sm font-semibold truncate">{version.title}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" className="h-7 text-xs" onClick={onRestore}>
              <History className="h-3 w-3 mr-1" />
              {t("documents.restoreVersion")}
            </Button>
            <button
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Close"
            >×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="doc-editor" dangerouslySetInnerHTML={{ __html: version.content_html }} />
        </div>
      </div>
    </>
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
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [newComment, setNewComment] = useState("");

  const { data: comments = [] } = useQuery({
    queryKey: ["doc-comments", workspaceSlug, spaceId, docId],
    queryFn: () => documentsApi.comments.list(workspaceSlug, spaceId, docId),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["doc-comments", workspaceSlug, spaceId, docId] });

  const createMutation = useMutation({
    mutationFn: () => documentsApi.comments.create(workspaceSlug, spaceId, docId, newComment.trim()),
    onSuccess: () => { invalidate(); setNewComment(""); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      documentsApi.comments.update(workspaceSlug, spaceId, docId, id, content),
    onSuccess: () => { invalidate(); toast.success(t("documents.commentUpdated")); },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) =>
      documentsApi.comments.delete(workspaceSlug, spaceId, docId, commentId),
    onSuccess: () => { invalidate(); toast.success(t("documents.commentDeleted")); },
  });

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title={t("documents.comments")} onClose={onClose} />

      {/* 입력 영역 */}
      <div className="p-3 border-b">
        <textarea
          className="w-full text-sm bg-muted/30 border rounded-lg px-3 py-2 resize-none outline-none focus:border-primary/50 min-h-[60px] transition-colors"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && newComment.trim()) {
              e.preventDefault();
              createMutation.mutate();
            }
          }}
        />
        <Button
          size="sm"
          className="mt-2 w-full h-7 text-xs"
          disabled={!newComment.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {t("documents.postComment")}
        </Button>
      </div>

      {/* 카드 목록 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {comments.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground text-center">
            {t("documents.noComments")}
          </p>
        ) : (
          comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              isOwner={c.author === currentUserId}
              onSave={(content) => updateMutation.mutate({ id: c.id, content })}
              onDelete={() => deleteMutation.mutate(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ── 댓글 카드 ── */

function CommentCard({
  comment, isOwner, onSave, onDelete,
}: {
  comment: DocumentComment;
  isOwner: boolean;
  onSave: (content: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const dirty = draft.trim() !== comment.content && draft.trim().length > 0;

  return (
    <div className="group relative rounded-xl border bg-card px-3 py-2.5 hover:border-border/80 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <UserLine
          name={comment.author_detail?.display_name}
          avatar={comment.author_detail?.avatar}
          timestamp={comment.created_at}
          editedAt={comment.updated_at}
        />
        {isOwner && !editing && (
          <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="Comment actions"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuItem onClick={() => { setDraft(comment.content); setEditing(true); }}>
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  {t("documents.editComment")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  {t("documents.deleteComment")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            className="w-full mt-2 text-sm bg-muted/30 border rounded-lg px-2.5 py-2 resize-none outline-none focus:border-primary/50 min-h-[70px] transition-colors"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-1.5 mt-2">
            <Button
              variant="ghost" size="sm" className="h-7 text-xs"
              onClick={() => { setEditing(false); setDraft(comment.content); }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm" className="h-7 text-xs"
              disabled={!dirty}
              onClick={() => { onSave(draft.trim()); setEditing(false); }}
            >
              {t("documents.saveChanges")}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm mt-2 whitespace-pre-wrap leading-relaxed text-foreground/90">
          {comment.content}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("documents.deleteCommentTitle")}
        description={t("documents.deleteCommentDesc")}
        confirmLabel={t("documents.deleteComment")}
        variant="destructive"
        onConfirm={() => { setConfirmOpen(false); onDelete(); }}
      />
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
            className="group flex items-center gap-3 px-4 py-3 rounded-xl border bg-card hover:border-border/80 hover:shadow-sm transition-all text-left"
          >
            {child.is_folder
              ? <FolderOpen className="h-5 w-5 text-amber-500 shrink-0" />
              : <FileText className="h-5 w-5 text-blue-400 shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{child.title}</p>
              <p className="text-2xs text-muted-foreground mt-0.5">
                {formatRelativeTime(child.updated_at)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
