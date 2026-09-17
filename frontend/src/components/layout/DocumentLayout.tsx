/**
 * 문서 전용 레이아웃 — 기존 AppLayout과 독립된 별도 앱.
 * 사이드바에 문서 트리를 직접 표시 (이중 사이드바 없음).
 */

import { useState, useMemo, useEffect } from "react";
import { ResizableAside } from "@/components/ui/resizable-aside";
import { Outlet, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  FileText, FolderOpen, FilePlus, FolderPlus,
  ChevronRight, ChevronDown, Star, LayoutGrid,
  MoreHorizontal, Trash2, Pencil, Link as LinkIcon, Settings, Share2, Table2,
  Lock, Layers, User as UserIcon, Users,
} from "lucide-react";
import { documentsApi } from "@/api/documents";
import { ProjectIcon, type IconProp } from "@/components/ui/project-icon-picker";
import type { DocumentSpace } from "@/types";

/** 대상 노드와 그 위 조상 전부 — 이동 후 트리를 펼쳐 "어디로 갔는지" 보여주는 데 쓴다 */
function ancestorChain(docs: DocType[], targetId: string): Set<string> {
  const ids = new Set<string>([targetId]);
  let cur = docs.find((d) => d.id === targetId);
  let guard = 0;
  while (cur?.parent && guard < 50) {
    ids.add(cur.parent);
    cur = docs.find((d) => d.id === cur!.parent);
    guard += 1;
  }
  return ids;
}

/** 드래그 페이로드 읽기 — 탐색기·사이드바가 같은 규격(JSON 배열)을 쓴다 */
function readDocIds(dt: DataTransfer): string[] {
  try {
    return JSON.parse(dt.getData("doc-ids") || "[]");
  } catch {
    return [];
  }
}

/** 사이드바/드롭다운에서 쓰는 스페이스 아이콘. project 스페이스는 프로젝트 아이콘 동기화. */
function SpaceTypeIcon({ space, className }: { space: DocumentSpace; className?: string }) {
  const { t } = useTranslation();
  const icon = space.space_type === "project" && space.icon_prop
    ? <ProjectIcon value={space.icon_prop} size={10} className={cn("shrink-0", className)} />
    : space.space_type === "project"
      ? <Layers className={cn("h-3.5 w-3.5 text-primary shrink-0", className)} />
      : space.space_type === "personal"
        ? <UserIcon className={cn("h-3.5 w-3.5 text-amber-500 shrink-0", className)} />
        : <Users className={cn("h-3.5 w-3.5 text-blue-500 shrink-0", className)} />;
  if (!(space.space_type === "project" && space.project_network === 2)) return icon;
  /* 비공개 표시는 아이콘 모서리 배지로 — 이름 옆에 따로 두면 좁은 사이드바에서 이름이 잘린다 */
  return (
    <span className="relative inline-flex shrink-0" title={t("documents.layout.privateProject")}>
      {icon}
      <span className="absolute -bottom-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-background">
        <Lock className="h-2 w-2 text-muted-foreground" aria-label={t("workspaceSettings.projects.private")} />
      </span>
    </span>
  );
}
import { TopBar } from "./TopBar";
import { AppSwitcher } from "./AppSwitcher";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { useWorkspaceColors } from "@/hooks/useWorkspaceColors";
import { calcInsertOrder, sortExplorerItems } from "@/lib/document-tree";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useUndoStore } from "@/stores/undoStore";
import { Z_SIDEBAR_OVERLAY, Z_SIDEBAR } from "@/constants/z-index";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TemplatePickerDialog } from "@/components/documents/TemplatePickerDialog";
import { GlobalIssueDialog } from "@/components/issues/GlobalIssueDialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Document as DocType } from "@/types";

export function DocumentLayout() {
  const { t } = useTranslation();
  const { workspaceSlug, spaceId, docId } = useParams<{
    workspaceSlug: string;
    spaceId?: string;
    docId?: string;
  }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isDesktop = useIsDesktop();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = () => setSidebarOpen(false);
  const toggleSidebar = () => setSidebarOpen((v) => !v);
  useWorkspaceColors();
  useWebSocket(workspaceSlug);

  // 글로벌 Undo
  const popUndo = useUndoStore((s) => s.popAndRun);
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      e.preventDefault();
      const entry = await popUndo();
      if (entry) toast.success(t("common.undone", { label: entry.label }));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [popUndo]);

  // 스페이스 목록
  const { data: spaces = [] } = useQuery({
    queryKey: ["document-spaces", workspaceSlug],
    queryFn: () => documentsApi.spaces.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  /* 스페이스를 고르기 전에는 아무 스페이스도 활성이 아니다.
     예전엔 spaces[0] 을 자동 선택해서, 문서 홈(스페이스 목록)을 보는 중에도 사이드바만
     엉뚱한 첫 스페이스의 트리를 보여줬다 — 본문과 사이드바가 서로 다른 곳을 가리키는 상태. */
  const activeSpaceId = spaceId;

  /* 스페이스 즐겨찾기 — 목록 그룹핑과 스페이스 메뉴의 토글 양쪽에서 쓴다 */
  const { data: spaceBookmarks = [] } = useQuery({
    queryKey: ["document-space-bookmarks", workspaceSlug],
    queryFn: () => documentsApi.spaceBookmarks.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  const bookmarkedSpaceIds = useMemo(
    () => new Set(spaceBookmarks.map((s) => s.id)),
    [spaceBookmarks],
  );

  const toggleSpaceBookmark = useMutation({
    mutationFn: ({ id, currently }: { id: string; currently: boolean }) =>
      currently
        ? documentsApi.spaceBookmarks.remove(workspaceSlug!, id)
        : documentsApi.spaceBookmarks.add(workspaceSlug!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-space-bookmarks", workspaceSlug] }),
  });

  /* 사이드바 스페이스 그룹 — 빈 그룹은 아예 렌더하지 않는다.
     즐겨찾기한 스페이스는 위로 **올리고** 원래 유형 그룹에서는 뺀다 — 두 군데 같은 줄이 보이면
     즐겨찾기가 정리 도구가 아니라 소음이 된다(문서 홈과 같은 규칙). */
  const spaceGroups = useMemo(() => {
    const rest = spaces.filter((s) => !bookmarkedSpaceIds.has(s.id));
    return [
      { title: t("documents.layout.bookmarks"), items: spaces.filter((s) => bookmarkedSpaceIds.has(s.id)) },
      { title: t("documents.projectSpaces"), items: rest.filter((s) => s.space_type === "project") },
      { title: t("documents.sharedSpaces"), items: rest.filter((s) => s.space_type === "shared") },
      { title: t("documents.personalSpaces"), items: rest.filter((s) => s.space_type === "personal") },
    ].filter((g) => g.items.length > 0);
  }, [spaces, bookmarkedSpaceIds, t]);

  const { data: allDocs = [], isLoading: docsLoading } = useQuery({
    queryKey: ["documents", workspaceSlug, activeSpaceId, "all"],
    queryFn: () => documentsApi.list(workspaceSlug!, activeSpaceId!, { all: "true" }),
    enabled: !!workspaceSlug && !!activeSpaceId,
  });

  // 트리 빌드
  /* 정렬은 탐색기와 같은 규칙(폴더 먼저 → sort_order)을 쓴다. 두 화면의 순서가 다르면
     사이드바에서 옮긴 결과가 탐색기에서 엉뚱한 자리에 있는 것처럼 보인다. */
  const rootDocs = useMemo(
    () => sortExplorerItems(allDocs.filter((d) => !d.parent)),
    [allDocs],
  );
  const childrenMap = useMemo(() => {
    const map = new Map<string, DocType[]>();
    for (const d of allDocs) {
      if (d.parent) {
        if (!map.has(d.parent)) map.set(d.parent, []);
        map.get(d.parent)!.push(d);
      }
    }
    for (const [key, list] of map) map.set(key, sortExplorerItems(list));
    return map;
  }, [allDocs]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["documents", workspaceSlug, activeSpaceId] });
    qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
    /* 열려 있는 문서 상세도 함께 — 이게 빠져 있어서 폴더를 표로 바꿔도 화면은
       옛 응답(db_columns=null)을 그대로 그려 일반 문서처럼 보였다. */
    qc.invalidateQueries({ queryKey: ["document", workspaceSlug, activeSpaceId] });
  };

  /* 순환 참조 감지 — targetId가 draggedId의 자손이면 true (순환 생김) */
  const wouldCreateCycle = (draggedId: string, targetId: string): boolean => {
    if (draggedId === targetId) return true;
    const queue = [draggedId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const kids = childrenMap.get(cur) ?? [];
      for (const k of kids) {
        if (k.id === targetId) return true;
        queue.push(k.id);
      }
    }
    return false;
  };

  /* 이동 직후 펼쳐야 할 노드들 — 접힌 폴더로 옮기면 사라진 것처럼 보이는 걸 막는다 */
  const [expandIds, setExpandIds] = useState<Set<string>>(new Set());
  const pushUndo = useUndoStore((s) => s.push);

  /* root drop zone (사이드바 하단) 상태 */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [rootDropHover, setRootDropHover] = useState(false);

  /* 전역 dragend 안전망 — 어떤 경로로든 드래그가 끝나면 상태 초기화 */
  useEffect(() => {
    const onEnd = () => { setDraggingId(null); setRootDropHover(false); };
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
    };
  }, []);

  // 문서 생성
  const createMutation = useMutation({
    mutationFn: (data: Partial<DocType>) =>
      documentsApi.create(workspaceSlug!, activeSpaceId!, data),
    onSuccess: (doc) => {
      invalidate();
      /* 표는 폴더지만 열 것이 있으므로 만들자마자 연다 — 평범한 폴더는 열어도 보여줄 게 없다 */
      if (!doc.is_folder || doc.db_columns) {
        navigate(`/${workspaceSlug}/documents/space/${activeSpaceId}/${doc.id}`);
      }
    },
  });

  /* 템플릿 선택 다이얼로그 상태 — 트리 '+ 새 문서' 또는 하위 문서 생성 시 오픈 */
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [pendingParentId, setPendingParentId] = useState<string | null>(null);

  // 문서 수정
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DocType> }) =>
      documentsApi.update(workspaceSlug!, activeSpaceId!, id, data),
    onSuccess: () => invalidate(),
  });

  // 문서 삭제
  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(workspaceSlug!, activeSpaceId!, id),
    onSuccess: () => {
      invalidate();
      toast.success(t("documents.deleted"));
      if (docId) navigate(`/${workspaceSlug}/documents/space/${activeSpaceId}`);
    },
  });

  const sidebarContent = (
    <ResizableAside
      /* 이슈 사이드바(Sidebar.tsx)와 같은 키·범위 — 앱을 오갈 때 사이드바 폭이 달라지지 않게 한쪽에서
         조절한 폭을 양쪽이 같이 쓴다. 전에는 키가 따로라 한쪽만 넓힌 채로 남았다. */
      storageKey="sidebar_main_width"
      defaultWidth={256}
      minWidth={256}
      maxWidth={480}
      handleSide="right"
      className="border-r glass-sidebar flex flex-col"
    >
        <WorkspaceHeader />
        <AppSwitcher />

        {/* 스페이스 + 생성 버튼 — 스페이스를 고르기 전에는 목록 헤더만 둔다 */}
        <div className="flex items-center gap-1 px-2 pt-2 pb-1">
          {/* 스페이스 목록으로 가는 뒤로 버튼은 두지 않는다 — 바로 옆 선택기로 스페이스를 바꾸고,
              위 앱 전환기의 "문서" 가 스페이스 목록으로 간다. 같은 일을 하는 버튼이 셋이었다. */}
          {!activeSpaceId ? (
            <span className="flex-1 px-2.5 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("documents.docPicker.space")}
            </span>
          ) : (() => {
            const activeSpace = spaces.find((s) => s.id === activeSpaceId);
            if (spaces.length > 1) {
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 flex-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-accent/50 transition-colors min-w-0">
                      {activeSpace ? (
                        <SpaceTypeIcon space={activeSpace} />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate flex-1 text-left">
                        {activeSpace?.name ?? t("documents.title")}
                      </span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {spaces.map((s) => {
                      return (
                        <DropdownMenuItem
                          key={s.id}
                          className="gap-2 cursor-pointer"
                          onClick={() => navigate(`/${workspaceSlug}/documents/space/${s.id}`)}
                        >
                          <SpaceTypeIcon space={s} />
                          <span className="flex-1 truncate text-sm">{s.name}</span>
                          {s.id === activeSpaceId && (
                            <span className="text-xs text-primary">●</span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }
            return (
              <span className="flex-1 flex items-center gap-1.5 text-xs font-medium px-2.5 truncate">
                {activeSpace && <SpaceTypeIcon space={activeSpace} />}
                <span className="truncate flex-1">{activeSpace?.name ?? t("documents.title")}</span>
              </span>
            );
          })()}

          {/* 문서 생성 계열은 스페이스가 정해져야 의미가 있다 */}
          {activeSpaceId && (
            <>
              {/* 스페이스 메뉴 — 자주 쓰지 않는 것(탐색기·설정·휴지통·즐겨찾기)을 한 곳에 모은다.
                  아이콘을 하나씩 늘리면 좁은 사이드바가 금세 버튼 밭이 된다. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title={t("documents.layout.spaceMenu")}>
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => navigate(`/${workspaceSlug}/documents/space/${activeSpaceId}/explorer`)}>
                    <LayoutGrid className="h-3.5 w-3.5 mr-2" />
                    {t("documents.explorer")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate(`/${workspaceSlug}/documents/graph?space=${activeSpaceId}`)}>
                    <Share2 className="h-3.5 w-3.5 mr-2" />
                    {t("documents.graph", "관계망")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      toggleSpaceBookmark.mutate({
                        id: activeSpaceId,
                        currently: bookmarkedSpaceIds.has(activeSpaceId),
                      })
                    }
                  >
                    <Star
                      className={cn(
                        "h-3.5 w-3.5 mr-2",
                        bookmarkedSpaceIds.has(activeSpaceId) && "text-amber-500 fill-current",
                      )}
                    />
                    {bookmarkedSpaceIds.has(activeSpaceId) ? t("documents.layout.unbookmark") : t("documents.layout.bookmark")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate(`/${workspaceSlug}/documents/space/${activeSpaceId}/trash`)}>
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    {t("memberDetail.trash")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate(`/${workspaceSlug}/documents/space/${activeSpaceId}/settings`)}>
                    <Settings className="h-3.5 w-3.5 mr-2" />
                    {t("documents.layout.spaceSettings")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* + 새 문서 — 템플릿 선택 다이얼로그 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                title={t("documents.newDocument")}
                onClick={() => { setPendingParentId(null); setTemplatePickerOpen(true); }}
              >
                <FilePlus className="h-4 w-4" />
              </Button>
              {/* 새 폴더 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                title={t("documents.newFolder")}
                onClick={() => createMutation.mutate({ title: t("documents.newFolder"), is_folder: true })}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>

        {/* 스페이스 미선택 — 스페이스 목록이 곧 사이드바.
            그룹 구성은 문서 홈(DocumentsHomePage)과 같게 맞춘다. 같은 화면을 두 곳에서
            다르게 나누면 어디에 뭐가 있는지 매번 다시 찾아야 한다. */}
        {!activeSpaceId ? (
          <nav className="flex-1 overflow-y-auto p-2 space-y-3">
            {spaces.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <FileText className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">{t("documents.empty")}</p>
              </div>
            ) : (
              spaceGroups.map((group) => (
                <div key={group.title}>
                  <p className="px-2.5 pb-1 text-2xs font-semibold uppercase tracking-widest text-muted-foreground/70">
                    {group.title}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((s) => {
                      const isBookmarked = bookmarkedSpaceIds.has(s.id);
                      return (
                        <div
                          key={s.id}
                          className="group/space w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        >
                          <button
                            onClick={() => navigate(`/${workspaceSlug}/documents/space/${s.id}`)}
                            className="flex items-center gap-2 flex-1 min-w-0 text-left"
                          >
                            <SpaceTypeIcon space={s} />
                            <span className="flex-1 truncate">{s.name}</span>
                          </button>
                          {/* 문서 수는 평소에, 별은 hover 시 — 좁은 사이드바에서 둘을 같은 자리에 겹친다 */}
                          <span className="text-2xs text-muted-foreground/60 shrink-0 group-hover/space:hidden">
                            {s.document_count}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSpaceBookmark.mutate({ id: s.id, currently: isBookmarked });
                            }}
                            title={isBookmarked ? t("documents.layout.unbookmark") : t("documents.layout.bookmark")}
                            className={cn(
                              "shrink-0 hidden group-hover/space:block",
                              isBookmarked ? "text-amber-500" : "text-muted-foreground/50 hover:text-foreground",
                            )}
                          >
                            <Star className={cn("h-3.5 w-3.5", isBookmarked && "fill-current")} />
                          </button>
                          {/* 즐겨찾기 상태는 hover 없이도 보여야 어느 스페이스가 즐찾인지 알 수 있다 */}
                          {isBookmarked && (
                            <Star className="h-3.5 w-3.5 shrink-0 text-amber-500 fill-current group-hover/space:hidden" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </nav>
        ) : (
        /* 문서 트리 */
        <nav className="flex-1 overflow-y-auto p-2">
          {docsLoading ? (
            <div className="space-y-1.5 px-1">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-full rounded" />)}
            </div>
          ) : rootDocs.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">{t("documents.empty")}</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {rootDocs.map((doc) => (
                <TreeNode
                  key={doc.id}
                  doc={doc}
                  childrenMap={childrenMap}
                  depth={0}
                  activeId={docId}
                  spaceId={activeSpaceId!}
                  workspaceSlug={workspaceSlug!}
                  onDelete={(id) => {
                    if (window.confirm(t("documents.deleteConfirm"))) deleteMutation.mutate(id);
                  }}
                  onRename={(id, title) => updateMutation.mutate({ id, data: { title } })}
                  onUpdate={(id, data) => updateMutation.mutate({ id, data })}
                  onCreate={(parentId, isFolder) => {
                    if (isFolder) {
                      createMutation.mutate({
                        title: t("documents.newFolder"),
                        parent: parentId,
                        is_folder: true,
                      });
                    } else {
                      /* 하위 문서도 템플릿 선택 화면 거침 */
                      setPendingParentId(parentId);
                      setTemplatePickerOpen(true);
                    }
                  }}
                  onDragStartGlobal={(id) => setDraggingId(id)}
                  onDragEndGlobal={() => setDraggingId(null)}
                  expandIds={expandIds}
                  onMove={(docIds, targetId, position) => {
                    const target = allDocs.find((d) => d.id === targetId);
                    if (!target) return;

                    /* 되돌리기용 — 문서마다 원래 부모가 다를 수 있다 */
                    const previous = new Map<string, string | null>(
                      docIds.map((id) => [id, allDocs.find((d) => d.id === id)?.parent ?? null]),
                    );
                    const registerUndo = (count: number) => {
                      pushUndo({
                        label: t("documents.layout.movedCount", { count }),
                        undo: async () => {
                          const byParent = new Map<string | null, string[]>();
                          for (const [id, prev] of previous) {
                            byParent.set(prev, [...(byParent.get(prev) ?? []), id]);
                          }
                          for (const [parent, ids] of byParent) {
                            await documentsApi.bulkMove(workspaceSlug!, activeSpaceId!, ids, parent);
                          }
                          invalidate();
                        },
                      });
                    };

                    if (position === "inside") {
                      /* 자기 자신/자손에 넣으면 순환 발생 — 하나라도 걸리면 전부 취소 */
                      if (docIds.some((id) => wouldCreateCycle(id, targetId))) {
                        toast.error(t("documents.cyclicNestError", "자신 또는 하위 문서로는 이동할 수 없습니다"));
                        return;
                      }
                      documentsApi.bulkMove(workspaceSlug!, activeSpaceId!, docIds, targetId)
                        .then(() => {
                          invalidate();
                          /* 옮긴 폴더가 접혀 있으면 문서가 사라진 것처럼 보인다 — 조상까지 펼쳐 보여준다 */
                          setExpandIds(ancestorChain(allDocs, targetId));
                          registerUndo(docIds.length);
                          toast.success(t("documents.layout.movedTo", { count: docIds.length, title: target.title }), {
                            action: { label: t("common.undo"), onClick: () => popUndo() },
                          });
                        });
                      return;
                    }

                    /* 형제 사이 드롭도 부모가 바뀐다 — 드래그한 문서의 자식 앞/뒤에 놓으면
                       parent 가 자기 자신이 되어 사이클이 생긴다(트리 전체가 사라지는 사고의 원인). */
                    const parent = target.parent ?? null;
                    if (parent && (docIds.includes(parent) || docIds.some((id) => wouldCreateCycle(id, parent)))) {
                      toast.error(t("documents.cyclicNestError", "자신 또는 하위 문서로는 이동할 수 없습니다"));
                      return;
                    }

                    /* 여러 개를 형제 사이에 끼우면 순서가 모호하다 — 같은 부모로만 옮기고 뒤에 붙인다 */
                    if (docIds.length > 1) {
                      documentsApi.bulkMove(workspaceSlug!, activeSpaceId!, docIds, parent)
                        .then(() => {
                          invalidate();
                          if (parent) setExpandIds(ancestorChain(allDocs, parent));
                          registerUndo(docIds.length);
                        });
                      return;
                    }

                    /* 한 개면 target 의 앞/뒤 sort_order 에 정확히 끼워 넣는다 */
                    const docId = docIds[0];
                    const { sort_order } = calcInsertOrder(allDocs, docId, target, position);
                    documentsApi.move(workspaceSlug!, activeSpaceId!, docId, { parent, sort_order })
                      .then(() => {
                        invalidate();
                        if (parent) setExpandIds(ancestorChain(allDocs, parent));
                        registerUndo(1);
                      });
                  }}
                />
              ))}
            </div>
          )}
        </nav>
        )}

        {/* 최상위로 빼기 드롭 존 — 항상 DOM + pointer-events 유지(상시 drop 수용).
            시각만 드래그 중에 표시. 이미 최상위 문서 드롭은 onDrop에서 no-op.
            스페이스 목록 모드에서는 끌어 놓을 문서 자체가 없으므로 렌더하지 않는다. */}
        {activeSpaceId && (
        <div
          className={cn(
            "mx-2 mb-2 border-2 border-dashed rounded-lg py-4 text-center text-xs font-medium transition-all shrink-0",
            draggingId
              ? (rootDropHover
                  ? "border-primary bg-primary/15 text-primary opacity-100 scale-[1.02]"
                  : "border-border/60 text-muted-foreground/80 opacity-90")
              : "opacity-0",
          )}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("doc-ids")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setRootDropHover(true);
          }}
          onDragLeave={() => setRootDropHover(false)}
          onDrop={(e) => {
            e.preventDefault();
            setRootDropHover(false);
            const ids = readDocIds(e.dataTransfer);
            setDraggingId(null);
            if (ids.length === 0) return;
            const moving = ids.filter((id) => allDocs.find((d) => d.id === id)?.parent);
            if (moving.length === 0) return; /* 이미 최상위면 무시 */
            documentsApi.bulkMove(workspaceSlug!, activeSpaceId!, moving, null)
              .then(() => invalidate());
          }}
        >
          {t("documents.dropToRoot", "여기에 끌어 놓으면 최상위로")}
        </div>
        )}

      </ResizableAside>
  );

  return (
    <div className="flex h-screen overflow-hidden relative">
      {isDesktop ? (
        sidebarContent
      ) : (
        <>
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50"
              style={{ zIndex: Z_SIDEBAR_OVERLAY }}
              onClick={closeSidebar}
            />
          )}
          <div
            className={`fixed inset-y-0 left-0 transform transition-transform duration-base ease-out ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
            style={{ zIndex: Z_SIDEBAR }}
            onClick={closeSidebar}
          >
            {sidebarContent}
          </div>
        </>
      )}

      {/* 메인 영역 */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <TopBar onMenuClick={!isDesktop ? toggleSidebar : undefined} />
        <main className="flex-1 overflow-hidden bg-background">
          <Outlet context={{ activeSpaceId, invalidate }} />
        </main>
      </div>

      {/* 템플릿 선택 다이얼로그 */}
      {activeSpaceId && workspaceSlug && (
        <TemplatePickerDialog
          open={templatePickerOpen}
          onOpenChange={setTemplatePickerOpen}
          workspaceSlug={workspaceSlug}
          onPick={(tpl) => {
            createMutation.mutate({
              title: tpl ? tpl.name : t("documents.untitled"),
              parent: pendingParentId,
              content_html: tpl?.content_html ?? "",
            });
            setPendingParentId(null);
          }}
        />
      )}
      <GlobalIssueDialog />
    </div>
  );
}

/* ── 트리 노드 ── */

function TreeNode({
  doc, childrenMap, depth, activeId, spaceId, workspaceSlug,
  onDelete, onRename, onCreate, onMove, onUpdate, onIconChange: _onIconChange, expandIds,
  onDragStartGlobal, onDragEndGlobal,
}: {
  doc: DocType;
  childrenMap: Map<string, DocType[]>;
  depth: number;
  activeId?: string;
  spaceId: string;
  workspaceSlug: string;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onCreate: (parentId: string | null, isFolder: boolean) => void;
  /** 하위에 표(칸을 가진 폴더)를 바로 만든다 */
  /** 트리에서 바로 고치는 값 — 지금은 폴더의 표 칸(db_columns) 토글에 쓴다 */
  onUpdate: (id: string, data: Partial<DocType>) => void;
  onIconChange?: (id: string, icon: IconProp) => void;
  onMove: (docIds: string[], targetId: string, position: "before" | "after" | "inside") => void;
  /** 이 집합에 든 노드는 자동으로 펼친다(이동 직후 대상 경로) */
  expandIds?: Set<string>;
  onDragStartGlobal?: (id: string) => void;
  onDragEndGlobal?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(depth < 1);

  /* 이동 대상 경로에 포함되면 펼친다 — 옮긴 문서가 접힌 폴더 안에서 보이지 않는 문제 */
  useEffect(() => {
    if (expandIds?.has(doc.id)) setExpanded(true);
  }, [expandIds, doc.id]);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(doc.title);
  const [dragPos, setDragPos] = useState<"before" | "after" | "inside" | null>(null);
  const children = childrenMap.get(doc.id) ?? [];
  const hasChildren = children.length > 0 || doc.is_folder;
  const isActive = doc.id === activeId;

  return (
    <div>
      <div
        className={cn(
          "relative flex items-center gap-1 rounded-md px-1.5 py-1.5 text-sm cursor-pointer group transition-colors",
          isActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/50",
          dragPos === "inside" && "ring-2 ring-primary/60 bg-primary/5",
        )}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        draggable
        onDragStart={(e) => {
          /* 탐색기와 같은 키·형식(JSON 배열)을 쓴다 — 두 화면이 서로 드롭을 받으려면 규격이 같아야 한다 */
          e.dataTransfer.setData("doc-ids", JSON.stringify([doc.id]));
          e.dataTransfer.effectAllowed = "move";
          onDragStartGlobal?.(doc.id);
        }}
        onDragEnd={() => {
          setDragPos(null);
          onDragEndGlobal?.();
        }}
        onDragOver={(e) => {
          /* dataTransfer.getData 는 drop 에서만 읽을 수 있어, 본인 여부 판정은 drop 으로 미룬다 */
          if (!e.dataTransfer.types.includes("doc-ids")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = e.clientY - rect.top;
          const h = rect.height;
          let pos: "before" | "after" | "inside";
          if (y < h * 0.28) pos = "before";
          else if (y > h * 0.72) pos = "after";
          else pos = "inside";
          setDragPos(pos);
        }}
        onDragLeave={(e) => {
          /* 자식으로 이동한 경우는 leave로 처리하지 않음 */
          const related = e.relatedTarget as Node | null;
          if (related && (e.currentTarget as HTMLElement).contains(related)) return;
          setDragPos(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const pos = dragPos;
          setDragPos(null);
          const ids = readDocIds(e.dataTransfer);
          if (!pos || ids.length === 0 || ids.includes(doc.id)) return;
          onMove(ids, doc.id, pos);
          if (pos === "inside") setExpanded(true);
        }}
        /* 표로 만든 폴더는 "열 것"이 있으므로 누르면 표를 연다.
           평범한 폴더는 지금까지처럼 펼치기만 한다 — 열어도 보여줄 게 없다.
           어느 쪽이든 왼쪽 화살표로는 펼치고 접을 수 있다. */
        onClick={() => (doc.is_folder && !doc.db_columns)
          ? setExpanded(!expanded)
          : navigate(`/${workspaceSlug}/documents/space/${spaceId}/${doc.id}`)
        }
      >
        {/* 드롭 위치 표시 라인 — 트리 깊이에 맞춰 왼쪽 시작점이 이동하므로
             어느 부모 아래로 편입될지 시각적으로 즉시 구분됨. */}
        {dragPos === "before" && (
          <div
            className="absolute right-2 -top-[3px] h-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.6)] pointer-events-none z-20"
            style={{ left: `${depth * 14 + 6}px` }}
          >
            <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary ring-2 ring-background" />
            <span className="absolute -right-1 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary ring-2 ring-background" />
          </div>
        )}
        {dragPos === "after" && (
          <div
            className="absolute right-2 -bottom-[3px] h-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.6)] pointer-events-none z-20"
            style={{ left: `${depth * 14 + 6}px` }}
          >
            <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary ring-2 ring-background" />
            <span className="absolute -right-1 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary ring-2 ring-background" />
          </div>
        )}
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="shrink-0 p-0.5"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {doc.is_folder
          ? <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
          : <FileText className="h-4 w-4 text-blue-400 shrink-0" />
        }

        {editing ? (
          <input
            className="flex-1 text-sm bg-transparent border-b border-primary outline-none min-w-0"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => { setEditing(false); if (editTitle.trim() !== doc.title) onRename(doc.id, editTitle.trim()); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setEditTitle(doc.title); setEditing(false); } }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={cn("flex-1 truncate text-sm", doc.is_folder && "font-medium")}>{doc.title}</span>
        )}

        {/* 인라인 액션 */}
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 hover:bg-accent rounded-md"
            title={t("documents.newDocument")}
            onClick={(e) => { e.stopPropagation(); onCreate(doc.id, false); }}
          >
            <FilePlus className="h-4 w-4" />
          </button>
          <button
            className="p-1 hover:bg-accent rounded-md"
            title={t("documents.newFolder")}
            onClick={(e) => { e.stopPropagation(); onCreate(doc.id, true); }}
          >
            <FolderPlus className="h-4 w-4" />
          </button>

          {/* 점 세개 메뉴 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1 hover:bg-accent rounded-md"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => { setEditing(true); setEditTitle(doc.title); }}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> {t("documents.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const url = `${window.location.origin}/${workspaceSlug}/documents/space/${spaceId}/${doc.id}`;
                navigator.clipboard.writeText(url);
                toast.success(t("documents.linkCopied"));
              }}>
                <LinkIcon className="h-3.5 w-3.5 mr-2" /> {t("documents.copyLink", "링크 복사")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCreate(doc.id, false)}>
                <FilePlus className="h-3.5 w-3.5 mr-2" /> {t("documents.newDocument")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCreate(doc.id, true)}>
                <FolderPlus className="h-3.5 w-3.5 mr-2" /> {t("documents.newFolder")}
              </DropdownMenuItem>
              {/* 폴더를 표로 — 같은 모양의 문서를 모아 정렬·필터하고 싶을 때만 켠다.
                  켜면 그 폴더를 누를 때 표가 열린다. */}
              {doc.is_folder && (
                <DropdownMenuItem
                  onClick={() => {
                    onUpdate(doc.id, { db_columns: doc.db_columns ? null : [] });
                    if (!doc.db_columns) navigate(`/${workspaceSlug}/documents/space/${spaceId}/${doc.id}`);
                  }}
                >
                  <Table2 className="h-3.5 w-3.5 mr-2" />
                  {doc.db_columns
                    ? t("documents.backToDocument", "표 해제")
                    : t("documents.makeDatabase", "표로 만들기")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(doc.id)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> {t("documents.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {expanded && children.map((child) => (
        <TreeNode
          key={child.id}
          doc={child}
          childrenMap={childrenMap}
          depth={depth + 1}
          activeId={activeId}
          spaceId={spaceId}
          workspaceSlug={workspaceSlug}
          onDelete={onDelete}
          onRename={onRename}
          onCreate={onCreate}
          onMove={onMove}
          onUpdate={onUpdate}
          expandIds={expandIds}
          onDragStartGlobal={onDragStartGlobal}
          onDragEndGlobal={onDragEndGlobal}
        />
      ))}
    </div>
  );
}
