/**
 * 문서 전용 레이아웃 — 기존 AppLayout과 독립된 별도 앱.
 * 사이드바에 문서 트리를 직접 표시 (이중 사이드바 없음).
 */

import { useState, useMemo, useEffect } from "react";
import { Outlet, useParams, useNavigate, Link, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  FileText, FolderOpen, FilePlus, FolderPlus, Plus,
  Layers, ChevronRight, ChevronDown,
  MoreHorizontal, Trash2, Pencil,
} from "lucide-react";
import { documentsApi } from "@/api/documents";
import { TopBar } from "./TopBar";
import { AppSwitcher } from "./AppSwitcher";
import { useAuthStore } from "@/stores/authStore";
import { useWorkspaceColors } from "@/hooks/useWorkspaceColors";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useUndoStore } from "@/stores/undoStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Document as DocType, DocumentSpace } from "@/types";

export function DocumentLayout() {
  const { t } = useTranslation();
  const { workspaceSlug, spaceId, docId } = useParams<{
    workspaceSlug: string;
    spaceId?: string;
    docId?: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
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

  // 문서 생성
  const createMutation = useMutation({
    mutationFn: (data: { title?: string; parent?: string | null; is_folder?: boolean }) =>
      documentsApi.create(workspaceSlug!, activeSpaceId!, data),
    onSuccess: (doc) => {
      invalidate();
      if (!doc.is_folder) {
        navigate(`/${workspaceSlug}/documents/space/${activeSpaceId}/${doc.id}`);
      }
    },
  });

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

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 문서 사이드바 — 단일 사이드바에 모든 것 통합 */}
      <aside className="w-64 border-r glass-sidebar flex flex-col shrink-0">
        {/* 워크스페이스 헤더 */}
        <div className="flex h-11 items-center gap-3 border-b px-4">
          <Link
            to={`/${workspaceSlug}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-black text-primary-foreground shadow-md ring-2 ring-primary/30 hover:brightness-110 transition-all"
          >
            ∞
          </Link>
          <div className="flex flex-col min-w-0">
            <span className="truncate text-sm font-semibold leading-tight">{workspaceSlug}</span>
            <span className="text-xs text-muted-foreground">{t("sidebar.workspace")}</span>
          </div>
        </div>

        <AppSwitcher />

        {/* 스페이스 + 생성 버튼 */}
        <div className="flex items-center gap-1 px-2 pt-2 pb-1">
          {spaces.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 flex-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-accent/50 transition-colors min-w-0">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1 text-left">
                    {spaces.find((s) => s.id === activeSpaceId)?.name ?? t("documents.title")}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {spaces.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    className="gap-2 cursor-pointer"
                    onClick={() => navigate(`/${workspaceSlug}/documents/space/${s.id}`)}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 truncate text-sm">{s.name}</span>
                    {s.id === activeSpaceId && (
                      <span className="text-xs text-primary">●</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="flex-1 text-xs font-medium px-2.5 truncate">
              {spaces.find((s) => s.id === activeSpaceId)?.name ?? t("documents.title")}
            </span>
          )}

          {/* + 새 문서 */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            title={t("documents.newDocument")}
            onClick={() => createMutation.mutate({ title: t("documents.untitled") })}
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
                  onCreate={(parentId, isFolder) =>
                    createMutation.mutate({
                      title: isFolder ? t("documents.newFolder") : t("documents.untitled"),
                      parent: parentId,
                      is_folder: isFolder,
                    })
                  }
                  onMove={(docId, newParent) => {
                    documentsApi.move(workspaceSlug!, activeSpaceId!, docId, { parent: newParent }).then(() => invalidate());
                  }}
                />
              ))}
            </div>
          )}
        </nav>

      </aside>

      {/* 메인 영역 */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-hidden bg-background">
          <Outlet context={{ activeSpaceId, invalidate }} />
        </main>
      </div>
    </div>
  );
}

/* ── 트리 노드 ── */

function TreeNode({
  doc, childrenMap, depth, activeId, spaceId, workspaceSlug,
  onDelete, onRename, onCreate, onMove, onIconChange,
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
  onMove: (docId: string, newParent: string | null) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(depth < 1);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(doc.title);
  const [dragOver, setDragOver] = useState(false);
  const children = childrenMap.get(doc.id) ?? [];
  const hasChildren = children.length > 0 || doc.is_folder;
  const isActive = doc.id === activeId;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md px-1.5 py-1.5 text-sm cursor-pointer group transition-colors",
          isActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/50",
          dragOver && doc.is_folder && "ring-2 ring-primary/50 bg-primary/5",
        )}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("doc-id", doc.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!doc.is_folder) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const draggedId = e.dataTransfer.getData("doc-id");
          if (draggedId && draggedId !== doc.id && doc.is_folder) {
            onMove(draggedId, doc.id);
            setExpanded(true);
          }
        }}
        onClick={() => doc.is_folder
          ? setExpanded(!expanded)
          : navigate(`/${workspaceSlug}/documents/space/${spaceId}/${doc.id}`)
        }
      >
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
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => { setEditing(true); setEditTitle(doc.title); }}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> {t("documents.rename")}
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
        />
      ))}
    </div>
  );
}
