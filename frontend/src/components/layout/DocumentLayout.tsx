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
  ChevronRight, ChevronDown,
  MoreHorizontal, Trash2, Pencil, Link as LinkIcon, Settings,
  Lock, Layers, User as UserIcon, Users,
} from "lucide-react";
import { documentsApi } from "@/api/documents";
import { ProjectIcon } from "@/components/ui/project-icon-picker";
import type { DocumentSpace } from "@/types";

/** 사이드바/드롭다운에서 쓰는 스페이스 아이콘. project 스페이스는 프로젝트 아이콘 동기화. */
function SpaceTypeIcon({ space, className }: { space: DocumentSpace; className?: string }) {
  if (space.space_type === "project" && space.icon_prop) {
    return <ProjectIcon value={space.icon_prop} size={10} className={cn("shrink-0", className)} />;
  }
  if (space.space_type === "project") return <Layers className={cn("h-3.5 w-3.5 text-primary shrink-0", className)} />;
  if (space.space_type === "personal") return <UserIcon className={cn("h-3.5 w-3.5 text-amber-500 shrink-0", className)} />;
  return <Users className={cn("h-3.5 w-3.5 text-blue-500 shrink-0", className)} />;
}
import { TopBar } from "./TopBar";
import { AppSwitcher } from "./AppSwitcher";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { useWorkspaceColors } from "@/hooks/useWorkspaceColors";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useUndoStore } from "@/stores/undoStore";
import { Z_SIDEBAR_OVERLAY, Z_SIDEBAR } from "@/constants/z-index";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TemplatePickerDialog } from "@/components/documents/TemplatePickerDialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
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
      if (entry) toast.success(`되돌림: ${entry.label}`);
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

  // 현재 스페이스가 선택되면 해당 스페이스의 전체 문서 로드
  const activeSpaceId = spaceId ?? spaces[0]?.id;

  const { data: allDocs = [], isLoading: docsLoading } = useQuery({
    queryKey: ["documents", workspaceSlug, activeSpaceId, "all"],
    queryFn: () => documentsApi.list(workspaceSlug!, activeSpaceId!, { all: "true" }),
    enabled: !!workspaceSlug && !!activeSpaceId,
  });

  // 트리 빌드
  const rootDocs = useMemo(() => allDocs.filter((d) => !d.parent), [allDocs]);
  const childrenMap = useMemo(() => {
    const map = new Map<string, DocType[]>();
    for (const d of allDocs) {
      if (d.parent) {
        if (!map.has(d.parent)) map.set(d.parent, []);
        map.get(d.parent)!.push(d);
      }
    }
    return map;
  }, [allDocs]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["documents", workspaceSlug, activeSpaceId] });
    qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
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
    mutationFn: (data: { title?: string; parent?: string | null; is_folder?: boolean; content_html?: string }) =>
      documentsApi.create(workspaceSlug!, activeSpaceId!, data),
    onSuccess: (doc) => {
      invalidate();
      if (!doc.is_folder) {
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
      storageKey="sidebar_doc_width"
      defaultWidth={256}
      minWidth={256}
      maxWidth={520}
      handleSide="right"
      className="border-r glass-sidebar flex flex-col"
    >
        <WorkspaceHeader />
        <AppSwitcher />

        {/* 스페이스 + 생성 버튼 */}
        <div className="flex items-center gap-1 px-2 pt-2 pb-1">
          {(() => {
            const activeSpace = spaces.find((s) => s.id === activeSpaceId);
            const activePrivate = activeSpace?.space_type === "project" && activeSpace.project_network === 2;
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
                      {activePrivate && <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
                      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {spaces.map((s) => {
                      const isPrivate = s.space_type === "project" && s.project_network === 2;
                      return (
                        <DropdownMenuItem
                          key={s.id}
                          className="gap-2 cursor-pointer"
                          onClick={() => navigate(`/${workspaceSlug}/documents/space/${s.id}`)}
                        >
                          <SpaceTypeIcon space={s} />
                          <span className="flex-1 truncate text-sm">{s.name}</span>
                          {isPrivate && <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
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
                {activePrivate && <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
              </span>
            );
          })()}

          {/* 스페이스 설정 */}
          {activeSpaceId && (
            <Button
              variant="ghost" size="icon" className="h-7 w-7 shrink-0"
              title="스페이스 설정"
              onClick={() => navigate(`/${workspaceSlug}/documents/space/${activeSpaceId}/settings`)}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          )}
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
        </div>

        {/* 문서 트리 */}
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
                  onMove={(docId, targetId, position) => {
                    const target = allDocs.find((d) => d.id === targetId);
                    if (!target) return;
                    if (position === "inside") {
                      /* 자기 자신/자손에 넣으면 순환 발생 — 차단 */
                      if (wouldCreateCycle(docId, targetId)) {
                        toast.error(t("documents.cyclicNestError", "자신 또는 하위 문서로는 이동할 수 없습니다"));
                        return;
                      }
                      documentsApi.move(workspaceSlug!, activeSpaceId!, docId, { parent: targetId })
                        .then(() => invalidate());
                      return;
                    }
                    /* 같은 parent로 옮기되 target의 앞/뒤 sort_order에 끼워 넣음 */
                    const parent = target.parent ?? null;
                    const siblings = allDocs
                      .filter((d) => (d.parent ?? null) === parent && d.id !== docId)
                      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
                    const idx = siblings.findIndex((d) => d.id === targetId);
                    const targetOrder = target.sort_order ?? 0;
                    let newOrder: number;
                    if (position === "before") {
                      const prev = idx > 0 ? siblings[idx - 1] : null;
                      newOrder = prev ? ((prev.sort_order ?? 0) + targetOrder) / 2 : targetOrder - 1;
                    } else {
                      const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
                      newOrder = next ? ((next.sort_order ?? 0) + targetOrder) / 2 : targetOrder + 1;
                    }
                    documentsApi.move(workspaceSlug!, activeSpaceId!, docId, { parent, sort_order: newOrder })
                      .then(() => invalidate());
                  }}
                />
              ))}
            </div>
          )}
        </nav>

        {/* 최상위로 빼기 드롭 존 — 항상 DOM + pointer-events 유지(상시 drop 수용).
            시각만 드래그 중에 표시. 이미 최상위 문서 드롭은 onDrop에서 no-op. */}
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
            if (!e.dataTransfer.types.includes("doc-id")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setRootDropHover(true);
          }}
          onDragLeave={() => setRootDropHover(false)}
          onDrop={(e) => {
            e.preventDefault();
            setRootDropHover(false);
            const id = e.dataTransfer.getData("doc-id");
            setDraggingId(null);
            if (!id) return;
            const dragged = allDocs.find((d) => d.id === id);
            if (!dragged || !dragged.parent) return; /* 이미 최상위면 무시 */
            const rootSiblings = allDocs
              .filter((d) => !d.parent && d.id !== id)
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
            const last = rootSiblings[rootSiblings.length - 1];
            const newOrder = last ? (last.sort_order ?? 0) + 1 : 0;
            documentsApi.move(workspaceSlug!, activeSpaceId!, id, { parent: null, sort_order: newOrder })
              .then(() => invalidate());
          }}
        >
          {t("documents.dropToRoot", "여기에 끌어 놓으면 최상위로")}
        </div>

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
    </div>
  );
}

/* ── 트리 노드 ── */

function TreeNode({
  doc, childrenMap, depth, activeId, spaceId, workspaceSlug,
  onDelete, onRename, onCreate, onMove, onIconChange: _onIconChange,
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
  onIconChange?: (id: string, icon: any) => void;
  onMove: (docId: string, targetId: string, position: "before" | "after" | "inside") => void;
  onDragStartGlobal?: (id: string) => void;
  onDragEndGlobal?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(depth < 1);
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
          e.dataTransfer.setData("doc-id", doc.id);
          e.dataTransfer.effectAllowed = "move";
          onDragStartGlobal?.(doc.id);
        }}
        onDragEnd={() => {
          setDragPos(null);
          onDragEndGlobal?.();
        }}
        onDragOver={(e) => {
          const draggedId = e.dataTransfer.types.includes("doc-id") ? null : "";  /* dataTransfer.getData는 drop에서만. 여기선 체크 불가 → 본인 판정은 drop에서 */
          void draggedId;
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
          const draggedId = e.dataTransfer.getData("doc-id");
          if (!pos || !draggedId || draggedId === doc.id) return;
          onMove(draggedId, doc.id, pos);
          if (pos === "inside") setExpanded(true);
        }}
        onClick={() => doc.is_folder
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
          onDragStartGlobal={onDragStartGlobal}
          onDragEndGlobal={onDragEndGlobal}
        />
      ))}
    </div>
  );
}
