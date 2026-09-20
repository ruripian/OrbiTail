/**
 * 문서 스페이스 페이지 — 에디터 + 도구 모음.
 * 사이드바(트리)는 DocumentLayout에서 관리.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useOutletContext, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorStatus } from "@/lib/api-error";
import {
  FileText, Loader2, Pencil, Eye, Share2, MessageSquare, Hash, Plus, Star,
  List, MoreHorizontal, Maximize2, Minimize2, ALargeSmall,
  History, FolderInput, Download, Printer, FileDown, Trash2, LayoutGrid,
  FolderOpen, FilePlus, Image as ImageIcon, Lock, Paperclip,
  Link2, Unlink, EyeOff, Table2, Home, KanbanSquare,
} from "lucide-react";
import { documentsApi } from "@/api/documents";
import { useAuthStore } from "@/stores/authStore";
import { useIssueDialogStore } from "@/stores/issueDialogStore";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { CommentsPanel as BlockCommentsPanel, type NewThreadRequest } from "@/components/documents/CommentsPanel";
import { SaveAsTemplateDialog } from "@/components/documents/TemplatePickerDialog";
import { ShareDialog } from "@/components/documents/ShareDialog";
import { CoverEditDialog } from "@/components/documents/CoverEditDialog";
import { CoverView } from "@/components/documents/CoverView";
import { IssuePickerDialog } from "@/components/documents/IssuePickerDialog";
import { DocumentLabelPicker, LabelChip } from "@/components/documents/DocumentLabelPicker";
import { DatabaseFolderView } from "./DatabaseFolderView";
import { DbValueInput, type DbValue } from "@/components/documents/DbValueInput";
import { useDocumentWebSocket } from "@/hooks/useDocumentWebSocket";
import {
  useDocReadingPrefs, adjustFontSizes, docFontCss,
  DOC_FS_DEFAULT, DOC_FS_RANGE, DOC_FONT_LABELS,
  type DocFontSizes, type DocFontKey,
} from "@/hooks/useDocReadingPrefs";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { ResizableAside } from "@/components/ui/resizable-aside";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelHeader } from "@/components/ui/panel-header";
import { UserLine } from "@/components/ui/user-line";
import { cn } from "@/lib/utils";
import { getAccessToken } from "@/lib/token-storage";
import { formatRelativeTime } from "@/lib/relative-time";
import type { Document as DocType, DbColumn } from "@/types";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { useDialogs } from "@/lib/dialogs";

interface LayoutContext {
  /** 스페이스를 고르기 전에는 비어 있다 */
  activeSpaceId?: string;
  invalidate: () => void;
}

export default function DocumentSpacePage() {
  const { t } = useTranslation();
  const { confirmDelete } = useDialogs();
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

  /* 스페이스에 들어오면 항상 홈을 보여 준다. 전에는 홈 문서가 지정돼 있으면 곧장 그 문서로 넘어가서
     "스페이스를 눌렀는데 대뜸 문서가 뜬다"는 느낌이 들었다. 홈 문서는 홈 맨 위에 고정해 보여 준다. */
  if (!docId) {
    return (
      <SpaceHome
        workspaceSlug={workspaceSlug!}
        spaceId={spaceId!}
        spaceName={currentSpace?.name ?? ""}
        isPrivateProject={
          currentSpace?.space_type === "project" && currentSpace?.project_network === 2
        }
        homeDocumentId={currentSpace?.home_document ?? null}
        projectId={projectId ?? null}
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

  /* 칸이 정의된 폴더는 문서가 아니라 표다 — 에디터 대신 표를 연다.
     칸이 없는 평범한 폴더는 지금까지처럼 문서로 연다(설명글을 쓰는 데 쓰인다). */
  if (currentDoc.is_folder && currentDoc.db_columns) {
    return (
      <DatabaseFolderView
        folder={currentDoc}
        workspaceSlug={workspaceSlug!}
        spaceId={spaceId!}
        /* 편집 가능 여부는 서버가 판정한다 — 문서 화면이 editMode 를 기본 true 로 두는 것과 같은 방침.
           권한이 없으면 저장에서 403 이 돌아오고 그때 알린다. */
        editable
        projectId={projectId}
        onUpdateFolder={(data) => updateMutation.mutate(data)}
        onInvalidate={() => ctx?.invalidate()}
      />
    );
  }

  return (
    <DocumentEditorView
      /* 문서가 바뀌면 화면 상태(제목 입력 등)를 통째로 새로 시작한다.
         key 가 없으면 제목 input 이 이전 문서 값을 그대로 들고 있다. */
      key={currentDoc.id}
      doc={currentDoc}
      projectId={projectId ?? undefined}
      onUpdate={(data) => updateMutation.mutate(data)}
      onDelete={async () => {
        if (await confirmDelete(t("documents.deleteConfirm"))) {
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
  /* fullWidth 초기값 = 작성자가 권장한 preferred_width. 사용자가 그 자리에서 토글하면 본인 세션만 변경. */
  const [fullWidth, setFullWidth] = useState((doc.preferred_width ?? "narrow") === "wide");
  /* 다른 문서로 이동 시 그 문서의 추천값으로 재초기화 */
  useEffect(() => { setFullWidth((doc.preferred_width ?? "narrow") === "wide"); }, [doc.id, doc.preferred_width]);
  /* 작성자만 추천 너비 변경 가능 — 다른 사용자는 본인 세션 토글만 */
  const currentUser = useAuthStore((s) => s.user);
  const isAuthor = !!currentUser && doc.created_by === currentUser.id;

  /* 즐겨찾기 — 사용자별 toggle. 버튼은 상단 도구 모음. */
  const { data: bookmarks = [] } = useQuery({
    queryKey: ["doc-bookmarks", workspaceSlug],
    queryFn: () => documentsApi.bookmarks.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const isBookmarked = bookmarks.some((b) => b.id === doc.id);
  const bookmarkMut = useMutation({
    mutationFn: () => isBookmarked
      ? documentsApi.bookmarks.remove(workspaceSlug!, doc.id)
      : documentsApi.bookmarks.add(workspaceSlug!, doc.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-bookmarks", workspaceSlug] }),
  });

  /* 작성자가 본인 화면 너비를 바꾸면 그 값이 자동으로 '추천 너비'로 저장됨 (디바운스).
     작성자가 의도적으로 토글할 필요 없이 본인이 보는 모드 그대로 추천. */
  const widthSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isAuthor) return;
    const desired: "narrow" | "wide" = fullWidth ? "wide" : "narrow";
    if (desired === (doc.preferred_width ?? "narrow")) return;
    if (widthSaveTimer.current) clearTimeout(widthSaveTimer.current);
    widthSaveTimer.current = setTimeout(() => {
      onUpdate({ preferred_width: desired });
    }, 600);
    return () => { if (widthSaveTimer.current) clearTimeout(widthSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthor, fullWidth, doc.preferred_width]);
  const [tocOpen, setTocOpen] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  /* 표 칸 패널 — 이슈가 메타 필드를 오른쪽 사이드바에 두는 것과 같은 자리.
     본문 위에 두면 글을 쓰기 전에 폼부터 보이고 세로 공간을 먹는다. */
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const dbColumns = doc.parent_db_columns ?? null;
  const hasFields = (dbColumns?.length ?? 0) > 0 || Object.keys(doc.properties ?? {}).length > 0;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  /* 글자 크기·서체는 보는 사람 본인 화면에만 적용(localStorage).
     문서의 font_size_* 서버 필드는 개인 설정이 없을 때의 문서 기본값으로만 읽는다 —
     읽는 사람이 자기 눈에 맞게 키웠다고 다른 협업자 화면까지 바뀌면 안 되기 때문. */
  const docPrefs = useDocReadingPrefs();
  const docFs: DocFontSizes = docPrefs.fontSize ?? {
    body: doc.font_size_body ?? DOC_FS_DEFAULT.body,
    h3:   doc.font_size_h3   ?? DOC_FS_DEFAULT.h3,
    h2:   doc.font_size_h2   ?? DOC_FS_DEFAULT.h2,
    h1:   doc.font_size_h1   ?? DOC_FS_DEFAULT.h1,
  };
  const setDocFsKey = (key: keyof DocFontSizes, val: number) => {
    docPrefs.setFontSize(adjustFontSizes(docFs, key, val));
  };
  const contentRef = useRef(doc.content_html);
  /* doc.id 바뀌면 초기화 */
  useEffect(() => { contentRef.current = doc.content_html; }, [doc.id, doc.content_html]);

  /* 실시간 협업 — Y.Doc + provider + Awareness. editMode일 때만 연결.
     본문 저장(yjs_state + content_html)은 이제 협업 서버가 함께 한다. */
  const collab = useDocumentWebSocket(editMode ? doc.id : undefined);

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

  /* content_html 안전망 저장.
     평소에는 **협업 서버가 저장한다** — 같은 순간의 Y.Doc 에서 yjs_state 와 content_html 을
     함께 만들어 내보내므로, 둘이 어긋날 수 없다. 여기서 또 쓰면 같은 값을 두 번 쓰는 셈이고
     서버가 쓴 것을 브라우저가 덮는 순서 문제도 생긴다.
     그래서 **협업 연결이 서지 않았을 때만** 쓴다 — 협업 서버가 죽어 있어도 타이핑이 날아가지 않게. */
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collabConnectedRef = useRef(false);
  collabConnectedRef.current = collab.connected;
  const queueAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      if (collabConnectedRef.current) return;
      const html = contentRef.current;
      if (html && html !== doc.content_html) {
        documentsApi.update(workspaceSlug!, spaceId!, doc.id, { content_html: html }).catch(() => {});
      }
    }, 2000);
  }, [workspaceSlug, spaceId, doc.id, doc.content_html]);

  useEffect(() => {
    const handler = () => {
      /* 협업 서버가 붙어 있으면 그쪽이 disconnect 시점에 저장한다 */
      if (collabConnectedRef.current) return;
      const html = contentRef.current;
      if (!html || html === doc.content_html) return;
      try {
        const token = getAccessToken();
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

  /* 커버 편집 다이얼로그 — 신규 업로드/이미지 변경/위치 재조정 모두 동일 다이얼로그 */
  const [coverDialogOpen, setCoverDialogOpen] = useState(false);
  const handleCoverSave = async (v: { file?: File; offsetX: number; offsetY: number; zoom: number; height: number }) => {
    if (v.file) {
      const fd = new FormData();
      fd.append("cover_image", v.file);
      fd.append("cover_offset_x", String(v.offsetX));
      fd.append("cover_offset_y", String(v.offsetY));
      fd.append("cover_zoom", String(v.zoom));
      fd.append("cover_height", String(v.height));
      await documentsApi.uploadCoverWithMeta(workspaceSlug!, spaceId!, doc.id, fd);
    } else {
      await documentsApi.update(workspaceSlug!, spaceId!, doc.id, {
        cover_offset_x: v.offsetX,
        cover_offset_y: v.offsetY,
        cover_zoom: v.zoom,
        cover_height: v.height,
      });
    }
    qc.invalidateQueries({ queryKey: ["document", workspaceSlug, spaceId, doc.id] });
  };
  const handleCoverRemove = async () => {
    const fd = new FormData();
    fd.append("cover_image", "");
    await documentsApi.uploadCoverWithMeta(workspaceSlug!, spaceId!, doc.id, fd);
    qc.invalidateQueries({ queryKey: ["document", workspaceSlug, spaceId, doc.id] });
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

  /* 마크다운 내보내기 — 변환은 서버가 한다. 콜아웃·멘션을 되돌릴 수 있는 형태로 내보내려면
     본문 HTML 전체를 봐야 하고, 그 규칙은 반입 쪽과 같은 자리에 있어야 어긋나지 않는다. */
  const exportMarkdown = useCallback(async () => {
    try {
      const blob = await documentsApi.exportMarkdown(workspaceSlug!, spaceId!, doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "document"}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("documents.exported"));
    } catch {
      toast.error(t("documents.exportFailed", "내보내기 실패"));
    }
  }, [workspaceSlug, spaceId, doc.id, title, t]);

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

        {/* 접속자 아바타 — 아바타 외곽에 직접 2px 컬러 테두리만.
            래퍼는 flex 여야 한다. 블록으로 두면 inline-flex 인 아바타 아래에 baseline 여백이 붙어
            래퍼만 세로로 길어지고, rounded-full 이 타원으로 그려진다. */}
        {editMode && (
          <div className="flex items-center gap-1 mr-2">
            <div
              className="relative flex shrink-0 rounded-full overflow-hidden"
              title={`${collab.me.name} ${t("team.you")}`}
              style={{ boxShadow: `inset 0 0 0 2px ${collab.me.color}` }}
            >
              <AvatarInitials name={collab.me.name} avatar={collab.me.avatar} size="sm" />
            </div>
            {collab.peers.slice(0, 4).map((p) => (
              <div
                key={p.userId || p.clientID}
                className="relative flex shrink-0 rounded-full overflow-hidden"
                title={p.name}
                style={{ boxShadow: `inset 0 0 0 2px ${p.color}` }}
              >
                <AvatarInitials name={p.name} avatar={p.avatar} size="sm" />
              </div>
            ))}
            {collab.peers.length > 4 && (
              <div className="w-6 h-6 shrink-0 rounded-full bg-muted text-muted-foreground text-2xs flex items-center justify-center font-medium">
                +{collab.peers.length - 4}
              </div>
            )}
          </div>
        )}

        {/* 우측 도구 */}
        {/* 즐겨찾기 — 사용자별 토글. 도구 모음에서 즉시 보이도록 노출. */}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 text-xs gap-1.5 px-2.5",
            isBookmarked && "text-amber-500 hover:text-amber-500",
          )}
          onClick={() => bookmarkMut.mutate()}
          title={isBookmarked ? t("documents.layout.unbookmark") : t("documents.layout.bookmark")}
        >
          <Star className={cn("h-3.5 w-3.5", isBookmarked && "fill-current")} />
          {isBookmarked ? t("documents.space.bookmarked") : t("documents.layout.bookmarks")}
        </Button>

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

        {/* 칸 — 표에 속한 문서일 때만. 채워진 개수를 같이 보여 안 채운 칸이 있는지 알게 한다. */}
        {hasFields && (
          <Button
            variant={fieldsOpen ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1.5 px-2.5"
            onClick={() => setFieldsOpen(!fieldsOpen)}
          >
            <Table2 className="h-3.5 w-3.5" />
            {t("documents.fields", "칸")}
            {dbColumns && (
              <span className="text-muted-foreground">
                {dbColumns.filter((c) => {
                  const v = (doc.properties ?? {})[c.name];
                  return c.type === "created" || c.type === "updated" || (v !== undefined && v !== null && v !== "");
                }).length}/{dbColumns.length}
              </span>
            )}
          </Button>
        )}

        {/* 백링크 — 이 문서를 가리키는 문서들 */}
        <Button
          variant={backlinksOpen ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs gap-1.5 px-2.5"
          onClick={() => setBacklinksOpen(!backlinksOpen)}
        >
          <Link2 className="h-3.5 w-3.5" />
          {t("documents.backlinks", "백링크")}
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 너비 토글 — 본인 세션만 영향. 단 작성자가 토글하면 그 값이 문서의 추천 너비로 자동 저장된다. */}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFullWidth(!fullWidth)}
          title={fullWidth ? t("documents.space.narrow") : t("documents.space.wide")}>
          {fullWidth ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>

        {/* 설정 드롭다운 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}/explorer`)}>
              <LayoutGrid className="h-3.5 w-3.5 mr-2" />
              {t("documents.explorer")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* 보기 설정 — 내 화면에만 적용. 서브메뉴라 슬라이더를 만져도 상위 메뉴가 닫히지 않는다. */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ALargeSmall className="h-3.5 w-3.5 mr-2" />
                {t("documents.space.textAndFont")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64 p-2">
                <div className="px-1 py-1 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-2xs font-semibold text-foreground">{t("documents.space.onlyMyScreen")}</span>
                    <button
                      onClick={docPrefs.reset}
                      disabled={!docPrefs.isCustom}
                      className="text-3xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
                    >
                      {t("workspaceSettings.general.useDefault")}
                    </button>
                  </div>

                  <div>
                    <span className="text-3xs text-muted-foreground">{t("documents.space.font")}</span>
                    <select
                      value={docPrefs.font}
                      onChange={(e) => docPrefs.setFont(e.target.value as DocFontKey)}
                      className="mt-0.5 w-full h-7 rounded-md border bg-background px-1.5 text-2xs"
                    >
                      {DOC_FONT_LABELS.map((f) => (
                        <option key={f.value} value={f.value}>{t(f.labelKey)}</option>
                      ))}
                    </select>
                  </div>

                  {(["body", "h3", "h2", "h1"] as const).map((k) => {
                    const labels = { body: t("documents.space.body"), h3: t("documents.space.h3"), h2: t("documents.space.h2"), h1: t("documents.space.h1") } as const;
                    const [lo, hi] = DOC_FS_RANGE[k];
                    return (
                      <div key={k}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-3xs text-muted-foreground">{labels[k]}</span>
                          <span className="text-3xs tabular-nums text-muted-foreground">{docFs[k]}px</span>
                        </div>
                        <input
                          type="range"
                          min={lo}
                          max={hi}
                          step={1}
                          value={docFs[k]}
                          onChange={(e) => setDocFsKey(k, Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                      </div>
                    );
                  })}
                </div>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            {/* 폴더를 표로 — 같은 모양의 문서를 모아 정렬·필터하고 싶을 때만 켠다.
                대부분의 폴더는 표가 아니므로 기본은 꺼짐이고, 켜면 이 폴더는 표로 열린다. */}
            {doc.is_folder && (
              <DropdownMenuItem onClick={() => onUpdate({ db_columns: [] })}>
                <Table2 className="h-3.5 w-3.5 mr-2" />
                {t("documents.makeDatabase", "표로 만들기")}
              </DropdownMenuItem>
            )}
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
            <DropdownMenuItem onClick={exportMarkdown}>
              <Download className="h-3.5 w-3.5 mr-2" />
              {t("documents.exportMarkdown", "마크다운(.md)으로 내보내기")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={importDocx}>
              <Download className="h-3.5 w-3.5 mr-2 rotate-180" />
              {t("documents.importDocx")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSaveTemplateOpen(true)}>
              <FileText className="h-3.5 w-3.5 mr-2" />
              {t("documents.templates.saveAs")}
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
          {/* --doc-fs-* 를 컨테이너에 선언한다 — 자식 doc-frame 이 상속받고,
              폭 토큰(--w-doc)도 본문 글자 크기를 참조해 같이 넓어진다 */}
          <div
            /* min-h-full + flex — 내용이 적어도 카드가 화면 아래까지 내려오게 한다.
               카드에만 높이를 주면 아래의 "연결된 이슈"·"하위 문서"가 화면 밖으로 밀리므로,
               그 둘은 제 높이를 갖고 남는 공간을 카드가 가져가게 둔다. */
            className={cn("doc-page-fill mx-auto w-full py-6 px-4 sm:px-6 min-h-full flex flex-col",
              fullWidth ? "max-w-none" : "doc-width")}
            style={{
              ["--doc-fs-body" as string]: `${docFs.body}px`,
              ["--doc-fs-h3" as string]:   `${docFs.h3}px`,
              ["--doc-fs-h2" as string]:   `${docFs.h2}px`,
              ["--doc-fs-h1" as string]:   `${docFs.h1}px`,
              ["--doc-font" as string]:    docFontCss(docPrefs.font),
            }}
          >
            <div
              className="doc-frame rounded-2xl border bg-card shadow-sm overflow-hidden flex-1 flex flex-col"
              data-print-width={fullWidth ? "wide" : "narrow"}
            >
              {/* 커버 이미지 배너 — CoverView 공용 렌더러 (다이얼로그 미리보기와 동일 공식) */}
              {doc.cover_image_url && (
                <CoverView
                  url={doc.cover_image_url}
                  offsetX={doc.cover_offset_x ?? 50}
                  offsetY={doc.cover_offset_y ?? 50}
                  zoom={doc.cover_zoom ?? 1}
                  height={doc.cover_height ?? 208}
                  className="group"
                >
                  {editMode && (
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" data-print-hide>
                      <button
                        onClick={() => setCoverDialogOpen(true)}
                        className="h-7 px-2 rounded-md bg-background/80 backdrop-blur text-xs font-medium hover:bg-background transition-colors"
                      >
                        {t("documents.space.editCover")}
                      </button>
                    </div>
                  )}
                </CoverView>
              )}

              <div className="px-6 sm:px-10 py-8 flex-1 flex flex-col">
              {/* 커버 없는 상태의 편집 모드: 커버 추가 유도 */}
              {!doc.cover_image_url && editMode && (
                <button
                  onClick={() => setCoverDialogOpen(true)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors"
                  data-print-hide
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  {t("documents.space.addCover")}
                </button>
              )}

              <input
                className="doc-title w-full font-bold bg-transparent outline-none mb-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => { if (title.trim() !== doc.title) onUpdate({ title: title.trim() }); }}
                readOnly={!editMode}
              />
              {/* 작성자 + 작성일 — 제목 바로 아래 메타 정보 */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                {doc.created_by_detail && (
                  <>
                    <AvatarInitials
                      name={doc.created_by_detail.display_name || doc.created_by_detail.email || "?"}
                      avatar={doc.created_by_detail.avatar}
                      size="xs"
                    />
                    <span>{doc.created_by_detail.display_name || doc.created_by_detail.email}</span>
                  </>
                )}
                {doc.created_at && (
                  <>
                    <span className="text-muted-foreground/50">·</span>
                    <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                  </>
                )}
              </div>

              {/* 라벨 — 편집 권한자만 붙이고 뗄 수 있다. 읽기 모드에서는 칩만 보인다. */}
              {(editMode || (doc.labels_detail?.length ?? 0) > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 mb-3" data-print-hide>
                  {doc.labels_detail?.map((label) => (
                    <LabelChip
                      key={label.id}
                      label={label}
                      onRemove={
                        editMode
                          ? () => onUpdate({ labels: (doc.labels ?? []).filter((id) => id !== label.id) })
                          : undefined
                      }
                    />
                  ))}
                  {editMode && (
                    <DocumentLabelPicker
                      workspaceSlug={workspaceSlug!}
                      value={doc.labels ?? []}
                      onChange={(ids) => onUpdate({ labels: ids })}
                    />
                  )}
                </div>
              )}
              {/* 프로퍼티 — `.md` 로 내보낼 때 YAML 머리말이 되는 자리 */}
              <div className="h-px bg-border/40 mb-4" />

              {editMode && !collab.provider ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
              <DocumentEditor
              key={doc.id + (editMode ? ":edit" : ":read")}
              content={doc.content_html}
              onAttachLabel={(labelId) => {
                const current = doc.labels ?? [];
                if (!current.includes(labelId)) onUpdate({ labels: [...current, labelId] });
              }}
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
              onStartComment={editMode ? handleStartComment : undefined}
              onCommentMarkClick={(id) => { setActiveThreadId(id); setCommentsOpen(true); }}
              onCommentMarksRemoved={editMode ? handleCommentMarksRemoved : undefined}
              resolvedThreadIds={resolvedThreadIds}
              onFileUpload={async (file) => {
                const maxMb = Number(import.meta.env.VITE_MAX_UPLOAD_SIZE_MB) || 10;
                if (file.size > maxMb * 1024 * 1024) {
                  toast.error(t("documents.space.tooLarge", { max: maxMb }));
                  throw new Error("file too large");
                }
                try {
                  const result = await documentsApi.attachments.upload(workspaceSlug!, spaceId!, doc.id, file);
                  return { url: result.file_url || result.file, filename: result.filename };
                } catch (e) {
                  const status = apiErrorStatus(e);
                  if (status === 413) {
                    toast.error(t("documents.space.tooLarge", { max: maxMb }));
                  } else {
                    toast.error(t("documents.space.uploadFailed"));
                  }
                  throw e;
                }
              }}
            />
            )}
              </div>
            </div>

            {/* 연결된 이슈 — 프레임 바깥. 사용자가 추가/제거. 인쇄 제외.
                projectId: project 스페이스면 그 프로젝트로만 제한, 아니면 null(워크스페이스 전체). */}
            <div data-print-hide>
              <LinkedIssuesSection
                workspaceSlug={workspaceSlug!}
                spaceId={spaceId!}
                docId={doc.id}
                editable={editMode}
                projectId={projectId ?? null}
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
          <ResizableAside
            storageKey="doc_toc_width"
            defaultWidth={224}
            minWidth={224}
            maxWidth={520}
            handleSide="left"
            className="border-l overflow-y-auto p-3 hidden lg:block"
            ariaLabel={t("documents.toc")}
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t("documents.toc")}
            </p>
            <TableOfContents html={contentRef.current} />
          </ResizableAside>
        )}

        {/* 칸 패널 */}
        {fieldsOpen && (
          <ResizableAside
            storageKey="doc_fields_width"
            defaultWidth={264}
            minWidth={224}
            maxWidth={480}
            handleSide="left"
            className="border-l overflow-y-auto p-3 hidden lg:block"
            ariaLabel={t("documents.fields", "칸")}
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t("documents.fields", "칸")}
            </p>
            <DocumentFields
              columns={dbColumns}
              properties={doc.properties ?? {}}
              doc={doc}
              editable={editMode}
              onChange={(next) => onUpdate({ properties: next })}
            />
          </ResizableAside>
        )}

        {/* 백링크 패널 */}
        {backlinksOpen && (
          <ResizableAside
            storageKey="doc_backlinks_width"
            defaultWidth={248}
            minWidth={224}
            maxWidth={520}
            handleSide="left"
            className="border-l overflow-y-auto p-3 hidden lg:block"
            ariaLabel={t("documents.backlinks", "백링크")}
          >
            <BacklinksPanel
              workspaceSlug={workspaceSlug!}
              spaceId={spaceId!}
              docId={doc.id}
            />
          </ResizableAside>
        )}

        {/* 버전 히스토리 패널 */}
        {historyOpen && (
          <ResizableAside
            storageKey="doc_history_width"
            defaultWidth={256}
            minWidth={256}
            maxWidth={560}
            handleSide="left"
            className="border-l overflow-y-auto hidden lg:block"
          >
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
          </ResizableAside>
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
        spaceId={spaceId}
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

      {/* 커버 편집 다이얼로그 — 신규/변경/위치+확대 모두 처리 */}
      <CoverEditDialog
        open={coverDialogOpen}
        onOpenChange={setCoverDialogOpen}
        currentUrl={doc.cover_image_url}
        initialOffsetX={doc.cover_offset_x ?? 50}
        initialOffsetY={doc.cover_offset_y ?? 50}
        initialZoom={doc.cover_zoom ?? 1}
        initialHeight={doc.cover_height ?? 208}
        onSave={handleCoverSave}
        onRemove={doc.cover_image_url ? handleCoverRemove : undefined}
      />
    </div>
  );
}

/* ── 스페이스 홈 (문서 미선택 상태) ── */
function SpaceHome({
  workspaceSlug, spaceId, spaceName, isPrivateProject, homeDocumentId, projectId, onInvalidate,
}: {
  workspaceSlug: string;
  spaceId: string;
  spaceName: string;
  isPrivateProject?: boolean;
  /** 설정 › 일반 에서 고른 홈 문서 — 홈 맨 위에 고정 */
  homeDocumentId: string | null;
  /** 프로젝트 스페이스면 그 프로젝트 — 이슈로 가는 바로가기 */
  projectId: string | null;
  onInvalidate: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: docs = [] } = useQuery({
    queryKey: ["documents", workspaceSlug, spaceId, "all"],
    queryFn: () => documentsApi.list(workspaceSlug, spaceId, { all: "true" }),
    enabled: !!workspaceSlug && !!spaceId,
  });

  /* 즐겨찾기 목록 — 워크스페이스 단위. 카드별 별 토글 노출. */
  const { data: bookmarks = [] } = useQuery({
    queryKey: ["doc-bookmarks", workspaceSlug],
    queryFn: () => documentsApi.bookmarks.list(workspaceSlug),
    enabled: !!workspaceSlug,
  });
  const bookmarkedSet = useMemo(() => new Set(bookmarks.map((b) => b.id)), [bookmarks]);
  const toggleBookmark = useMutation({
    mutationFn: ({ id, currently }: { id: string; currently: boolean }) =>
      currently
        ? documentsApi.bookmarks.remove(workspaceSlug, id)
        : documentsApi.bookmarks.add(workspaceSlug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-bookmarks", workspaceSlug] }),
  });

  const recent = useMemo(() =>
    [...docs].filter((d) => !d.is_folder).sort((a, b) =>
      (b.updated_at ?? "").localeCompare(a.updated_at ?? "")
    ).slice(0, 8),
  [docs]);
  const rootDocs = useMemo(() => docs.filter((d) => !d.parent), [docs]);
  const homeDoc = homeDocumentId ? docs.find((d) => d.id === homeDocumentId) : undefined;

  const createDoc = async () => {
    const doc = await documentsApi.create(workspaceSlug, spaceId, {
      title: t("documents.untitled"),
      is_folder: false,
    });
    onInvalidate();
    navigate(`/${workspaceSlug}/documents/space/${spaceId}/${doc.id}`);
  };

  /* 별 버튼 — 카드 우상단에 호버 시(또는 즐겨찾기 시 항상) 노출.
     카드 클릭과 충돌하지 않게 stopPropagation. */
  const BookmarkStar = ({ docId }: { docId: string }) => {
    const isOn = bookmarkedSet.has(docId);
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleBookmark.mutate({ id: docId, currently: isOn });
        }}
        title={isOn ? t("documents.layout.unbookmark") : t("documents.layout.bookmark")}
        className={cn(
          "shrink-0 h-7 w-7 rounded-md flex items-center justify-center transition-all",
          isOn
            ? "text-amber-500 hover:bg-amber-500/10"
            : "text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground",
        )}
      >
        <Star className={cn("h-4 w-4", isOn && "fill-current")} />
      </button>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-regular mx-auto px-8 py-10">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              {t("documents.home", "홈")}
            </p>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              {spaceName || t("documents.title")}
              {isPrivateProject && (
                <Lock className="h-5 w-5 text-muted-foreground/60" aria-label={t("documents.layout.privateProject")} />
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("documents.docCountTotal", "문서")} · {docs.filter((d) => !d.is_folder).length}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 프로젝트 스페이스 — 문서와 이슈를 오가는 일이 잦다 */}
            {projectId && (
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => navigate(`/${workspaceSlug}/projects/${projectId}/issues`)}
              >
                <KanbanSquare className="h-4 w-4" />
                {t("documents.projectIssues", "프로젝트 이슈")}
              </Button>
            )}
            {/* 탐색기 — 폴더·문서를 끌어서 정리하는 화면. 스페이스 홈에서 바로 갈 수 있어야 한다. */}
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}/explorer`)}
            >
              <LayoutGrid className="h-4 w-4" />
              {t("documents.explorer")}
            </Button>
            <Button onClick={createDoc} className="gap-1.5">
              <FilePlus className="h-4 w-4" />
              {t("documents.newDocument")}
            </Button>
          </div>
        </div>

        {/* 홈 문서 — 스페이스의 개요. 들어오자마자 여는 대신 여기 고정해 둔다 */}
        {homeDoc && (
          <section className="mb-10">
            <div
              onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}/${homeDoc.id}`)}
              className="group flex items-center gap-4 rounded-xl border bg-card px-5 py-4 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Home className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("documents.homeDocument", "홈 문서")}
                </p>
                <p className="text-base font-semibold truncate group-hover:text-primary transition-colors">{homeDoc.title}</p>
                <p className="text-2xs text-muted-foreground mt-0.5">{formatRelativeTime(homeDoc.updated_at)}</p>
              </div>
            </div>
          </section>
        )}

        {/* 최근 업데이트 */}
        {recent.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {t("documents.recentlyUpdated", "최근 업데이트")}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((d) => (
                <div key={d.id}
                  onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}/${d.id}`)}
                  className="group flex items-start gap-3 px-4 py-3 rounded-xl border bg-card hover:border-border/80 hover:shadow-sm transition-all text-left cursor-pointer"
                >
                  <FileText className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{d.title}</p>
                    <p className="text-2xs text-muted-foreground mt-0.5">
                      {formatRelativeTime(d.updated_at)}
                    </p>
                  </div>
                  <BookmarkStar docId={d.id} />
                </div>
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
                <div key={d.id}
                  onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}/${d.id}`)}
                  className="group flex items-center gap-3 px-4 py-3 rounded-xl border bg-card hover:border-border/80 hover:shadow-sm transition-all text-left cursor-pointer"
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
                  {!d.is_folder && <BookmarkStar docId={d.id} />}
                </div>
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

/* ── 프로퍼티 ── */

/**
 * 문서의 칸 값 — 제목 아래 줄.
 *
 * 두 가지 경우를 한 컴포넌트가 맡는다.
 *   1) 속한 폴더가 표다 → 그 칸을 순서대로, 종류에 맞는 위젯으로 (빈 칸도 보인다 — 안 채우고 넘어가기 어렵게)
 *   2) 그냥 문서다 → properties 에 값이 있으면 읽기 전용으로만 (주로 `.md` 로 들어온 머리말)
 */
function DocumentFields({ columns, properties, doc, editable, onChange }: {
  columns: DbColumn[] | null;
  properties: Record<string, DbValue>;
  doc: DocType;
  editable: boolean;
  onChange: (next: Record<string, DbValue>) => void;
}) {
  if (columns && columns.length > 0) {
    return (
      <div className="space-y-2.5" data-print-hide>
        {columns.map((col) => {
          const derived = col.type === "created" || col.type === "updated";
          const value = derived
            ? ((col.type === "created" ? doc.created_at : doc.updated_at) ?? null)
            : (properties[col.name] ?? null);
          return (
            <div key={col.name} className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">
                {col.name}
              </p>
              <DbValueInput
                key={`${col.name}:${JSON.stringify(value ?? null)}`}
                column={col}
                value={value as DbValue}
                editable={editable && !derived}
                onChange={(v) => onChange({ ...properties, [col.name]: v })}
              />
            </div>
          );
        })}
      </div>
    );
  }

  /* 표가 아닌 문서 — 값이 있을 때만, 읽기 전용 */
  const entries = Object.entries(properties);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2" data-print-hide>
      {entries.map(([key, v]) => (
        <div key={key} className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-0.5">{key}</p>
          <p className="text-xs truncate">
            {Array.isArray(v) ? v.join(", ")
              : v && typeof v === "object" ? (v as { label?: string }).label ?? ""
              : v === null || v === undefined ? "" : String(v)}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ── 백링크 ── */

function BacklinksPanel({ workspaceSlug, spaceId, docId }: { workspaceSlug: string; spaceId: string; docId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["doc-backlinks", workspaceSlug, spaceId, docId],
    queryFn: () => documentsApi.backlinks(workspaceSlug, spaceId, docId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  const incoming = data?.incoming ?? [];
  const broken = data?.broken ?? [];
  const hidden = data?.incoming_hidden ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t("documents.backlinks", "백링크")}
          {incoming.length > 0 && <span className="ml-1 font-normal">{incoming.length}</span>}
        </p>
        {incoming.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            {t("documents.backlinksEmpty", "이 문서를 가리키는 문서가 없습니다")}
          </p>
        ) : (
          <div className="space-y-0.5">
            {incoming.map((it) => (
              <button
                key={it.id}
                className="flex items-center gap-1.5 w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors py-1 rounded hover:bg-accent/50 px-1"
                onClick={() => navigate(`/${workspaceSlug}/documents/space/${it.space}/${it.id}`)}
              >
                <FileText className="h-3 w-3 shrink-0 text-blue-400" />
                <span className="truncate flex-1">{it.title}</span>
                {/* 다른 스페이스에서 온 링크면 어디서 왔는지 밝힌다 */}
                {it.space !== spaceId && (
                  <span className="text-2xs text-muted-foreground shrink-0">{it.space_name}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {/* 가린 건수를 조용히 넘기지 않는다 — 목록이 전부가 아니라는 사실을 알린다 */}
        {hidden > 0 && (
          <p className="flex items-center gap-1 text-2xs text-muted-foreground mt-1.5">
            <EyeOff className="h-3 w-3 shrink-0" />
            {t("documents.backlinksHidden", { n: hidden })}
          </p>
        )}
      </div>

      {/* 이 문서 주변만 그린 관계망 — Obsidian 의 로컬 그래프 자리 */}
      <button
        className="flex items-center gap-1.5 w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-1 rounded hover:bg-accent/50"
        onClick={() => navigate(`/${workspaceSlug}/documents/graph?doc=${docId}&depth=2`)}
      >
        <Share2 className="h-3 w-3 shrink-0" />
        {t("documents.graphOpenLocal", "관계망에서 보기")}
      </button>

      {broken.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("documents.brokenLinks", "깨진 링크")} <span className="font-normal">{broken.length}</span>
          </p>
          <div className="space-y-0.5">
            {broken.map((it) => (
              <div key={it.id} className="flex items-center gap-1.5 text-xs text-muted-foreground/70 py-1 px-1">
                <Unlink className="h-3 w-3 shrink-0 text-amber-500" />
                <span className="truncate line-through">{it.title}</span>
              </div>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground mt-1.5">
            {t("documents.brokenLinksHint", "휴지통에 있는 문서를 가리킵니다. 복원하면 다시 이어집니다.")}
          </p>
        </div>
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
          <div className="doc-editor" dangerouslySetInnerHTML={{ __html: sanitizeHtml(version.content_html) }} />
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

/* ── 연결된 이슈 섹션 — 문서 ↔ 이슈 양방향 링크 표시 + 추가/제거 ── */

function LinkedIssuesSection({ workspaceSlug, spaceId, docId, editable, projectId }: {
  workspaceSlug: string; spaceId: string; docId: string; editable: boolean;
  /** 문서가 project 스페이스에 속하면 해당 프로젝트 id. personal/shared 면 null. */
  projectId: string | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: links = [] } = useQuery({
    queryKey: ["doc-issue-links", spaceId, docId],
    queryFn: () => documentsApi.issues.list(workspaceSlug, spaceId, docId),
    enabled: !!docId,
  });

  const linkMut = useMutation({
    mutationFn: (issueId: string) => documentsApi.issues.link(workspaceSlug, spaceId, docId, issueId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-issue-links", spaceId, docId] }),
  });
  const unlinkMut = useMutation({
    mutationFn: (issueId: string) => documentsApi.issues.unlink(workspaceSlug, spaceId, docId, issueId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-issue-links", spaceId, docId] }),
  });

  /* 표시할 게 없고 편집 권한도 없으면 섹션 자체를 숨김 */
  if (!editable && links.length === 0) return null;

  return (
    <div className="mt-6 px-4 sm:px-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("documents.space.linkedIssues")} {links.length > 0 && <span className="ml-1 text-muted-foreground/60">({links.length})</span>}
        </h3>
        {editable && (
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1 text-2xs text-primary hover:underline"
          >
            <Plus className="h-3 w-3" />
            {t("documents.space.linkIssue")}
          </button>
        )}
      </div>
      {links.length === 0 ? (
        <p className="text-2xs text-muted-foreground/60">{t("documents.space.noLinkedIssues")}</p>
      ) : (
        /* 카드형 read-only 미러 — 이슈 식별자/제목 + 댓글수/첨부수/최근 댓글 시각.
           클릭 시 전역 이슈 다이얼로그(useIssueDialogStore.openIssue) 로 위임. */
        <ul className="space-y-2">
          {links.map((link) => {
            const commentCount = link.issue_comment_count ?? 0;
            const attachmentCount = link.issue_attachment_count ?? 0;
            const lastCommentAt = link.issue_last_comment_at;
            return (
              <li key={link.id} className="group relative rounded-md border border-border bg-card hover:bg-accent/30 hover:border-primary/30 transition-colors">
                <button
                  onClick={() => link.project_id && useIssueDialogStore.getState().openIssue(workspaceSlug, link.project_id, link.issue)}
                  className="w-full text-left px-3 py-2.5"
                  title={link.issue_title}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-mono text-2xs text-muted-foreground shrink-0">
                      {link.project_identifier}-{link.issue_sequence_id}
                    </span>
                    <span className="truncate text-sm">{link.issue_title}</span>
                  </div>
                  {(commentCount > 0 || attachmentCount > 0) && (
                    <div className="flex items-center gap-3 text-2xs text-muted-foreground mt-1 pl-6">
                      {commentCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="h-2.5 w-2.5" />
                          {commentCount}
                          {lastCommentAt && (
                            <span className="text-muted-foreground/60">· {formatRelativeTime(lastCommentAt)}</span>
                          )}
                        </span>
                      )}
                      {attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="h-2.5 w-2.5" />
                          {attachmentCount}
                        </span>
                      )}
                    </div>
                  )}
                </button>
                {editable && (
                  <button
                    onClick={() => unlinkMut.mutate(link.issue)}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive text-2xs transition-opacity px-1"
                    title={t("issues.detail.nodes.remove")}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <IssuePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        excludeIds={links.map((l) => l.issue)}
        onSelect={async (issue) => { await linkMut.mutateAsync(issue.id); }}
      />
    </div>
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
