/**
 * 문서 스페이스 페이지 — 에디터 + 도구 모음.
 * 사이드바(트리)는 DocumentLayout에서 관리.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useOutletContext, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  FileText, Loader2, Pencil, Eye, Share2, MessageSquare,
  List, MoreHorizontal, Copy, Maximize2, Minimize2,
  History, FolderInput, Download, Printer, FileDown, Trash2, LayoutGrid,
  FolderOpen, FilePlus, Image as ImageIcon, X,
} from "lucide-react";
import { documentsApi } from "@/api/documents";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { CommentsPanel as BlockCommentsPanel, type NewThreadRequest } from "@/components/documents/CommentsPanel";
import { SaveAsTemplateDialog } from "@/components/documents/TemplatePickerDialog";
import { ShareDialog } from "@/components/documents/ShareDialog";
import { useDocumentWebSocket } from "@/hooks/useDocumentWebSocket";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelHeader } from "@/components/ui/panel-header";
import { UserLine } from "@/components/ui/user-line";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/relative-time";
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
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const contentRef = useRef(doc.content_html);
  /* doc.id 바뀌면 초기화 */
  useEffect(() => { contentRef.current = doc.content_html; }, [doc.id, doc.content_html]);

  /* 실시간 협업 — Y.Doc + WebSocket provider + Awareness. editMode일 때만 연결. */
  const collab = useDocumentWebSocket(editMode ? doc.id : undefined);
  const shouldSeed = !doc.has_yjs_state;

  /* 블록 댓글 상태 */
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [newThread, setNewThread] = useState<NewThreadRequest | null>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);

  /* 현재 문서의 전체 스레드 — 해결됨 판정 + 자동 삭제 시 캐시 무효화 */
  const allThreadsQ = useQuery({
    queryKey: ["doc-threads-all", doc.id],
    queryFn: () => documentsApi.threads.list(workspaceSlug!, spaceId!, doc.id),
    enabled: editMode,
  });
  const resolvedThreadIds = useMemo(
    () => new Set((allThreadsQ.data ?? []).filter((t) => t.resolved).map((t) => t.id)),
    [allThreadsQ.data],
  );

  const handleStartComment = (selectedText: string): Promise<string | null> => {
    setCommentsOpen(true);
    return new Promise<string | null>((resolve) => {
      setNewThread({ selectedText, resolve });
    });
  };

  /* 마크 제거 탐지 시 API 호출 — 이미 삭제된 스레드는 404로 조용히 무시됨 */
  const qc = useQueryClient();
  const handleCommentMarksRemoved = useCallback((threadIds: string[]) => {
    threadIds.forEach(async (id) => {
      try {
        await documentsApi.threads.delete(workspaceSlug!, spaceId!, doc.id, id);
      } catch { /* 404 무시 (이미 다른 피어가 지움) */ }
    });
    qc.invalidateQueries({ queryKey: ["doc-threads", doc.id] });
    qc.invalidateQueries({ queryKey: ["doc-threads-all", doc.id] });
  }, [workspaceSlug, spaceId, doc.id, qc]);

  /* content_html 안전망 저장 — Yjs WS가 refresh 직전 마지막 업데이트를 flush 못
     해도, content_html이 REST로 저장되어 있으면 다음 로드에서 seed로 복원된다.
     1) 편집 중 debounce 2초 뒤 저장
     2) 페이지 언로드 시 keepalive fetch로 즉시 저장 (sendBeacon은 인증 헤더 불가) */
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      const html = contentRef.current;
      if (html && html !== doc.content_html) {
        documentsApi.update(workspaceSlug!, spaceId!, doc.id, { content_html: html }).catch(() => {});
      }
    }, 2000);
  }, [workspaceSlug, spaceId, doc.id, doc.content_html]);

  useEffect(() => {
    const handler = () => {
      const html = contentRef.current;
      if (!html || html === doc.content_html) return;
      try {
        const token = localStorage.getItem("access_token");
        fetch(
          `/api/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${doc.id}/`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ content_html: html }),
            keepalive: true,
          },
        ).catch(() => {});
      } catch { /* 언로드 경로에서 예외는 무시 */ }
    };
    window.addEventListener("beforeunload", handler);
    /* pagehide — 모바일 safari 등 beforeunload 안 쏘는 환경 대비 */
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
    };
  }, [workspaceSlug, spaceId, doc.id, doc.content_html]);

  /* 커버 이미지 업로드/제거 */
  const coverMutation = useMutation({
    mutationFn: (file: File | null) =>
      documentsApi.uploadCover(workspaceSlug!, spaceId!, doc.id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document", workspaceSlug, spaceId, doc.id] });
    },
    onError: () => toast.error("커버 이미지 처리 실패"),
  });
  const pickCover = () => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) coverMutation.mutate(file);
    };
    input.click();
  };

  /* 활성 스레드 바뀌면 에디터에서 해당 마크로 스크롤 + data-active 하이라이트 */
  useEffect(() => {
    const root = editorWrapperRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-comment-thread][data-active]").forEach((el) => {
      el.removeAttribute("data-active");
    });
    if (!activeThreadId) return;
    const el = root.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(activeThreadId)}"]`);
    if (el) {
      el.setAttribute("data-active", "true");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeThreadId]);

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

        {/* 접속자 아바타 — editMode에서만 표시. 자기 자신(첫 번째) + 다른 유저들 */}
        {editMode && (
          <div className="flex items-center -space-x-1.5 mr-2">
            <div
              className="relative rounded-full"
              title={`${collab.me.name} (나)`}
              style={{ boxShadow: `0 0 0 2px ${collab.me.color}, 0 0 0 4px hsl(var(--background))` }}
            >
              <AvatarInitials name={collab.me.name} avatar={collab.me.avatar} size="xs" />
            </div>
            {collab.peers.slice(0, 4).map((p) => (
              <div
                key={p.userId || p.clientID}
                className="relative rounded-full"
                title={p.name}
                style={{ boxShadow: `0 0 0 2px ${p.color}, 0 0 0 4px hsl(var(--background))` }}
              >
                <AvatarInitials name={p.name} avatar={p.avatar} size="xs" />
              </div>
            ))}
            {collab.peers.length > 4 && (
              <div
                className="w-5 h-5 rounded-full bg-muted text-muted-foreground text-2xs flex items-center justify-center font-medium"
                style={{ boxShadow: `0 0 0 2px hsl(var(--background))` }}
              >
                +{collab.peers.length - 4}
              </div>
            )}
          </div>
        )}

        {/* 우측 도구 */}
        {/* 공유 — 공개 링크 다이얼로그 */}
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 px-2.5"
          onClick={() => setShareOpen(true)}
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
            <DropdownMenuItem onClick={pickCover}>
              <ImageIcon className="h-3.5 w-3.5 mr-2" />
              {doc.cover_image_url ? "커버 이미지 변경" : "커버 이미지 추가"}
            </DropdownMenuItem>
            {doc.cover_image_url && (
              <DropdownMenuItem onClick={() => coverMutation.mutate(null)}>
                <X className="h-3.5 w-3.5 mr-2" />
                커버 이미지 제거
              </DropdownMenuItem>
            )}
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
            <DropdownMenuItem onClick={() => setSaveTemplateOpen(true)}>
              <FileText className="h-3.5 w-3.5 mr-2" />
              템플릿으로 저장
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
        <div className="flex-1 overflow-y-auto" ref={editorWrapperRef}>
          <div className={cn("mx-auto w-full py-6 px-4 sm:px-6", fullWidth ? "max-w-none" : "max-w-[860px]")}>
            <div className="doc-frame rounded-2xl border bg-card shadow-sm overflow-hidden">
              {/* 커버 이미지 배너 — Notion 스타일, 프레임 상단 전체 너비 */}
              {doc.cover_image_url && (
                <div
                  className="group relative h-40 sm:h-52 bg-muted"
                  style={{
                    backgroundImage: `url(${doc.cover_image_url})`,
                    backgroundSize: "cover",
                    backgroundPosition: `center ${doc.cover_offset_y ?? 50}%`,
                  }}
                >
                  {editMode && (
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" data-print-hide>
                      <button
                        onClick={pickCover}
                        className="h-7 px-2 rounded-md bg-background/80 backdrop-blur text-xs font-medium hover:bg-background transition-colors"
                      >
                        변경
                      </button>
                      <button
                        onClick={() => coverMutation.mutate(null)}
                        className="h-7 px-2 rounded-md bg-background/80 backdrop-blur text-xs font-medium hover:bg-background hover:text-destructive transition-colors"
                      >
                        제거
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="px-6 sm:px-10 py-8">
              {/* 커버 없는 상태의 편집 모드: 커버 추가 유도 */}
              {!doc.cover_image_url && editMode && (
                <button
                  onClick={pickCover}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors"
                  data-print-hide
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  커버 추가
                </button>
              )}

              <input
                className="w-full text-4xl font-bold bg-transparent outline-none mb-3"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => { if (title.trim() !== doc.title) onUpdate({ title: title.trim() }); }}
                readOnly={!editMode}
              />
              <div className="h-px bg-border/40 mb-4" />

              {editMode && !collab.provider ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
              <DocumentEditor
              key={doc.id + (editMode ? ":edit" : ":read")}
              content={doc.content_html}
              onChange={(html) => { contentRef.current = html; queueAutoSave(); }}
              onBlur={() => {
                if (contentRef.current !== doc.content_html) onUpdate({ content_html: contentRef.current });
              }}
              editable={editMode}
              workspaceSlug={workspaceSlug}
              spaceId={spaceId}
              docId={doc.id}
              projectId={projectId}
              collab={editMode ? collab : undefined}
              shouldSeed={editMode && shouldSeed}
              onStartComment={editMode ? handleStartComment : undefined}
              onCommentMarkClick={(id) => { setActiveThreadId(id); setCommentsOpen(true); }}
              onCommentMarksRemoved={editMode ? handleCommentMarksRemoved : undefined}
              resolvedThreadIds={resolvedThreadIds}
              onFileUpload={async (file) => {
                const result = await documentsApi.attachments.upload(workspaceSlug!, spaceId!, doc.id, file);
                return { url: result.file_url || result.file, filename: result.filename };
              }}
            />
            )}
              </div>
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
          <BlockCommentsPanel
            workspaceSlug={workspaceSlug!}
            spaceId={spaceId!}
            docId={doc.id}
            activeThreadId={activeThreadId}
            onActiveThreadChange={setActiveThreadId}
            newThread={newThread}
            onNewThreadHandled={() => setNewThread(null)}
          />
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

      {/* 템플릿으로 저장 다이얼로그 */}
      <SaveAsTemplateDialog
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        workspaceSlug={workspaceSlug!}
        contentHtml={contentRef.current}
        defaultName={doc.title}
      />

      {/* 공개 공유 링크 다이얼로그 */}
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        workspaceSlug={workspaceSlug!}
        spaceId={spaceId!}
        docId={doc.id}
      />
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
