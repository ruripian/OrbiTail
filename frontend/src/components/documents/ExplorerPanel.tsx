/**
 * 탐색기 패널 — 한 폴더의 내용을 보여주고 조작하는 단위.
 *
 * 화면 분할에서 두 번 인스턴스화되므로, 경로·선택·미리보기 같은 "보는 위치"에 딸린 상태는
 * 전부 이 안에 둔다. 잘라내기 클립보드만 패널 밖(페이지)에 있어야 패널 사이로 붙여넣을 수 있다.
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  FileText, FolderOpen, LayoutGrid, List,
  MoreHorizontal, Pencil, Trash2, FolderInput, FilePlus, FolderPlus,
  ChevronRight, Scissors, ClipboardPaste,
} from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sortExplorerItems, wouldCreateCycle } from "@/lib/document-tree";
import { useUndoStore } from "@/stores/undoStore";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import type { Document as DocType } from "@/types";

type ViewMode = "grid" | "list";

interface ContextMenuState {
  x: number;
  y: number;
  doc: DocType | null;
}

interface Props {
  workspaceSlug: string;
  spaceId: string;
  allDocs: DocType[];
  childrenMap: Map<string | null, DocType[]>;
  /** 라벨 필터는 두 패널이 공유한다 — "회의록만 보기"를 패널마다 따로 걸 이유가 없다 */
  labelFilter: string[];
  clipboard: string[];
  setClipboard: (ids: string[]) => void;
  onInvalidate: () => void;
  /** 분할 모드에서 키보드 단축키는 활성 패널에만 적용된다 */
  isActive: boolean;
  onActivate: () => void;
  /** 분할 여부 — 좁아진 패널에서는 그리드 열 수를 줄인다 */
  split?: boolean;
  /** 단일 패널일 때 페이지가 URL(?folder=)로 위치를 관리한다. 주면 controlled, 없으면 자체 state. */
  folderId?: string | null;
  onFolderChange?: (id: string | null) => void;
}

export function ExplorerPanel({
  workspaceSlug, spaceId, allDocs, childrenMap, labelFilter,
  clipboard, setClipboard, onInvalidate, isActive, onActivate, split,
  folderId, onFolderChange,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pushUndo = useUndoStore((s) => s.push);
  const popUndo = useUndoStore((s) => s.popAndRun);

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  /* 위치는 URL(controlled) 또는 자체 state(분할 시) 중 하나가 들고 있다 */
  const [localFolder, setLocalFolder] = useState<string | null>(null);
  const controlled = onFolderChange !== undefined;
  const currentFolder = controlled ? folderId ?? null : localFolder;
  const setCurrentFolder = (id: string | null) => {
    if (controlled) onFolderChange!(id);
    else setLocalFolder(id);
  };

  /* 브레드크럼은 상태로 들고 있지 않고 현재 폴더에서 계산한다 —
     그래야 링크로 바로 들어오거나 새로고침해도 경로가 정확하다. */
  const breadcrumb = useMemo(() => {
    const chain: { id: string | null; title: string }[] = [];
    let cur = currentFolder ? allDocs.find((d) => d.id === currentFolder) : undefined;
    let guard = 0;
    while (cur && guard < 50) {
      chain.unshift({ id: cur.id, title: cur.title });
      cur = cur.parent ? allDocs.find((d) => d.id === cur!.parent) : undefined;
      guard += 1;
    }
    return [{ id: null, title: t("documents.title") }, ...chain];
  }, [currentFolder, allDocs, t]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const marqueeBaseRef = useRef<Set<string>>(new Set());
  const marqueeMovedRef = useRef(false);

  const currentItems = useMemo(() => {
    const items = labelFilter.length > 0
      ? allDocs.filter((d) => !d.is_folder && d.labels?.some((id) => labelFilter.includes(id)))
      : allDocs.filter((d) => (d.parent ?? null) === currentFolder);
    return sortExplorerItems(items);
  }, [allDocs, currentFolder, labelFilter]);

  /* 다른 곳(사이드바·반대 패널)에서 폴더가 지워지면 현재 경로가 허공을 가리킨다 → 루트로 되돌린다 */
  useEffect(() => {
    if (currentFolder && allDocs.length > 0 && !allDocs.some((d) => d.id === currentFolder)) {
      setCurrentFolder(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDocs, currentFolder]);

  const createMutation = useMutation({
    /* parent 를 명시하지 않으면 현재 폴더에 만든다. 특정 문서의 하위로 만들 때는 직접 넘긴다. */
    mutationFn: ({ parent, ...data }: Partial<DocType> & { parent?: string | null }) =>
      documentsApi.create(workspaceSlug, spaceId, {
        ...data,
        parent: parent !== undefined ? parent : currentFolder,
      }),
    onSuccess: () => onInvalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => documentsApi.delete(workspaceSlug, spaceId, id))),
    onSuccess: (_, ids) => { onInvalidate(); setSelected(new Set()); toast.success(`${ids.length}개 삭제됨`); },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      documentsApi.update(workspaceSlug, spaceId, id, { title }),
    onSuccess: () => { onInvalidate(); setRenamingId(null); },
    onError: (e) => toast.error(apiErrorMessage(e, "이름 변경 실패")),
  });

  const moveMutation = useMutation({
    mutationFn: ({ ids, parent }: { ids: string[]; parent: string | null; previous: Map<string, string | null> }) =>
      documentsApi.bulkMove(workspaceSlug, spaceId, ids, parent),
    onSuccess: (r, vars) => {
      onInvalidate();
      /* 옮긴 곳이 접힌 폴더면 눈앞에서 사라진 것처럼 보인다 — 어디로 갔는지 이름을 말해주고
         되돌릴 수단을 함께 준다. 되돌리기는 옮기기 전 부모를 그대로 복원한다. */
      const targetName = vars.parent
        ? allDocs.find((d) => d.id === vars.parent)?.title ?? "폴더"
        : "최상위";
      pushUndo({
        label: `${r.moved}개 이동`,
        undo: async () => {
          const byParent = new Map<string | null, string[]>();
          for (const [id, prev] of vars.previous) {
            byParent.set(prev, [...(byParent.get(prev) ?? []), id]);
          }
          for (const [parent, ids] of byParent) {
            await documentsApi.bulkMove(workspaceSlug, spaceId, ids, parent);
          }
          onInvalidate();
        },
      });
      toast.success(`${r.moved}개를 "${targetName}"(으)로 이동`, {
        action: { label: "실행 취소", onClick: () => popUndo() },
      });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "이동 실패")),
  });

  const moveInto = (ids: string[], targetId: string | null) => {
    if (ids.length === 0) return;
    for (const id of ids) {
      if (targetId && wouldCreateCycle(id, targetId, childrenMap)) {
        toast.error(t("documents.cyclicNestError", "자신 또는 하위 문서로는 이동할 수 없습니다"));
        return;
      }
    }
    const moving = ids.filter((id) => {
      const doc = allDocs.find((d) => d.id === id);
      return doc && (doc.parent ?? null) !== targetId;
    });
    if (moving.length === 0) return;
    // 되돌리기용으로 옮기기 전 위치를 기억해 둔다(문서마다 부모가 다를 수 있다)
    const previous = new Map<string, string | null>(
      moving.map((id) => [id, allDocs.find((d) => d.id === id)?.parent ?? null]),
    );
    moveMutation.mutate({ ids: moving, parent: targetId, previous });
  };

  /* ── 선택 ── */

  const clickItem = (doc: DocType, e: React.MouseEvent) => {
    onActivate();
    if (e.shiftKey && lastClickedId) {
      const ids = currentItems.map((d) => d.id);
      const from = ids.indexOf(lastClickedId);
      const to = ids.indexOf(doc.id);
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        setSelected(new Set(ids.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(doc.id)) next.delete(doc.id); else next.add(doc.id);
        return next;
      });
      setLastClickedId(doc.id);
      return;
    }
    setSelected(new Set([doc.id]));
    setLastClickedId(doc.id);
  };

  /** 하위로 진입 — 폴더뿐 아니라 자식을 가진 문서도 들어갈 수 있어야 한다.
      OrbiTail 트리는 문서 아래에도 문서가 붙으므로, 폴더만 진입 가능하면 그 자식들은
      탐색기에서 영영 볼 수 없다. */
  const openFolder = (doc: DocType) => {
    setCurrentFolder(doc.id);
    setSelected(new Set());
  };

  /** 이 항목이 품고 있는 자식 수 — 진입 가능 여부 판단과 배지에 함께 쓴다 */
  const childCount = (doc: DocType) => childrenMap.get(doc.id)?.length ?? 0;

  const navigateBreadcrumb = (index: number) => {
    setCurrentFolder(breadcrumb[index].id);
    setSelected(new Set());
  };

  const openDoc = (doc: DocType) => {
    if (doc.is_folder) openFolder(doc);
    else navigate(`/${workspaceSlug}/documents/space/${spaceId}/${doc.id}`);
  };

  /* ── 러버밴드 선택 ── */

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left + el.scrollLeft, y: e.clientY - rect.top + el.scrollTop };
  };

  const startMarquee = (e: React.MouseEvent) => {
    if (e.button !== 0 || !scrollRef.current) return;
    if ((e.target as HTMLElement).closest("[data-doc-id]")) return;
    onActivate();

    const start = toLocal(e);
    marqueeBaseRef.current = e.ctrlKey || e.metaKey || e.shiftKey ? new Set(selected) : new Set();
    marqueeMovedRef.current = false;
    setMarquee({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });

    const onMove = (ev: MouseEvent) => {
      const cur = toLocal(ev);
      marqueeMovedRef.current = true;
      setMarquee((m) => (m ? { ...m, x2: cur.x, y2: cur.y } : m));

      const box = {
        left: Math.min(start.x, cur.x), right: Math.max(start.x, cur.x),
        top: Math.min(start.y, cur.y), bottom: Math.max(start.y, cur.y),
      };
      const el = scrollRef.current!;
      const base = el.getBoundingClientRect();
      const hit = new Set(marqueeBaseRef.current);
      el.querySelectorAll<HTMLElement>("[data-doc-id]").forEach((node) => {
        const r = node.getBoundingClientRect();
        const nodeBox = {
          left: r.left - base.left + el.scrollLeft,
          right: r.right - base.left + el.scrollLeft,
          top: r.top - base.top + el.scrollTop,
          bottom: r.bottom - base.top + el.scrollTop,
        };
        if (
          nodeBox.left < box.right && nodeBox.right > box.left &&
          nodeBox.top < box.bottom && nodeBox.bottom > box.top
        ) hit.add(node.dataset.docId!);
      });
      setSelected(hit);
    };

    const onUp = () => {
      setMarquee(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /* ── 키보드 — 활성 패널에서만 ── */
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || renamingId) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSelected(new Set(currentItems.map((d) => d.id)));
      } else if ((e.ctrlKey || e.metaKey) && e.key === "x") {
        if (selected.size > 0) { setClipboard(Array.from(selected)); toast.success(`${selected.size}개 잘라내기`); }
      } else if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        if (clipboard.length > 0) { moveInto(clipboard, currentFolder); setClipboard([]); }
      } else if (e.key === "Delete" && selected.size > 0) {
        if (window.confirm(`${selected.size}개 항목을 삭제할까요?`)) deleteMutation.mutate(Array.from(selected));
      } else if (e.key === "F2" && selected.size === 1) {
        setRenamingId(Array.from(selected)[0]);
      } else if (e.key === "Enter" && selected.size === 1) {
        const doc = currentItems.find((d) => d.id === Array.from(selected)[0]);
        if (doc) openDoc(doc);
      } else if (e.key === "Escape") {
        setSelected(new Set());
        setContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  /* ── 드래그앤드롭 ── */

  const readDraggedIds = (e: React.DragEvent): string[] => {
    try {
      return JSON.parse(e.dataTransfer.getData("doc-ids") || "[]");
    } catch {
      return [];
    }
  };

  const dragProps = (doc: DocType) => ({
    draggable: !renamingId,
    onDragStart: (e: React.DragEvent) => {
      const ids = selected.has(doc.id) ? Array.from(selected) : [doc.id];
      if (!selected.has(doc.id)) setSelected(new Set([doc.id]));
      e.dataTransfer.setData("doc-ids", JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => setDropTargetId(null),
  });

  /* 드롭 대상은 폴더로 한정하지 않는다 — 이 트리는 문서 아래에도 문서가 붙으므로
     문서 위에 놓는 것도 "그 문서의 하위로 넣기"로 유효하다. */
  const itemDropProps = (folder: DocType) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("doc-ids")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTargetId(folder.id);
    },
    onDragLeave: () => setDropTargetId((cur) => (cur === folder.id ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetId(null);
      const ids = readDraggedIds(e);
      if (ids.length) moveInto(ids, folder.id);
    },
  });

  const fmtDate = (d: string) => new Date(d).toLocaleDateString();

  const RenameInput = ({ doc }: { doc: DocType }) => (
    <input
      autoFocus
      defaultValue={doc.title}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const title = e.target.value.trim();
        if (title && title !== doc.title) renameMutation.mutate({ id: doc.id, title });
        else setRenamingId(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setRenamingId(null);
      }}
      className="w-full text-xs bg-background border rounded px-1 py-0.5 outline-none focus:border-primary"
    />
  );

  const itemActions = (doc: DocType | null) => (
    <>
      {doc && (
        <>
          <button className="ctx-item" onClick={() => openDoc(doc)}>
            <FolderOpen className="h-3.5 w-3.5" /> 열기
          </button>
          {/* 문서 아래에도 문서가 붙는 구조라, 자식이 있으면 문서도 하위로 들어갈 수 있어야 한다 */}
          {!doc.is_folder && childCount(doc) > 0 && (
            <button className="ctx-item" onClick={() => openFolder(doc)}>
              <ChevronRight className="h-3.5 w-3.5" /> 하위 문서 보기 ({childCount(doc)})
            </button>
          )}
          <button
            className="ctx-item"
            onClick={() => createMutation.mutate({ title: t("documents.untitled"), parent: doc.id })}
          >
            <FilePlus className="h-3.5 w-3.5" /> 이 안에 문서 만들기
          </button>
          <button className="ctx-item" onClick={() => setRenamingId(doc.id)}>
            <Pencil className="h-3.5 w-3.5" /> {t("documents.rename")}
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              const ids = selected.has(doc.id) ? Array.from(selected) : [doc.id];
              setClipboard(ids);
              toast.success(`${ids.length}개 잘라내기`);
            }}
          >
            <Scissors className="h-3.5 w-3.5" /> 잘라내기
          </button>
        </>
      )}
      <button
        className="ctx-item disabled:opacity-40"
        disabled={clipboard.length === 0}
        onClick={() => { moveInto(clipboard, doc?.is_folder ? doc.id : currentFolder); setClipboard([]); }}
      >
        <ClipboardPaste className="h-3.5 w-3.5" /> 붙여넣기{clipboard.length > 0 && ` (${clipboard.length})`}
      </button>
      <button className="ctx-item" onClick={() => createMutation.mutate({ title: t("documents.newFolder"), is_folder: true })}>
        <FolderPlus className="h-3.5 w-3.5" /> {t("documents.newFolder")}
      </button>
      {doc && (
        <button
          className="ctx-item text-destructive"
          onClick={() => {
            const ids = selected.has(doc.id) ? Array.from(selected) : [doc.id];
            if (window.confirm(`${ids.length}개 항목을 삭제할까요?`)) deleteMutation.mutate(ids);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> {t("documents.delete")}
        </button>
      )}
    </>
  );

  const itemProps = (doc: DocType) => ({
    "data-doc-id": doc.id,
    ...dragProps(doc),
    ...itemDropProps(doc),
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); clickItem(doc, e); },
    onDoubleClick: () => openDoc(doc),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onActivate();
      if (!selected.has(doc.id)) setSelected(new Set([doc.id]));
      setContextMenu({ x: e.clientX, y: e.clientY, doc });
    },
  });

  return (
    <div
      className={cn(
        "flex flex-col min-w-0 flex-1 h-full",
        /* 분할 상태에서 어느 쪽이 키보드를 받는지 보이게 한다 */
        split && (isActive ? "ring-1 ring-inset ring-primary/40" : "opacity-90"),
      )}
      onMouseDown={onActivate}
    >
      {/* 패널 툴바 — 경로와 생성 버튼은 패널마다 따로다 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-1 text-sm flex-1 min-w-0 overflow-hidden">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <button
                onClick={() => navigateBreadcrumb(i)}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("doc-ids")) return;
                  e.preventDefault();
                  setDropTargetId(`crumb:${i}`);
                }}
                onDragLeave={() => setDropTargetId((cur) => (cur === `crumb:${i}` ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTargetId(null);
                  const ids = readDraggedIds(e);
                  if (ids.length) moveInto(ids, b.id);
                }}
                className={cn(
                  "text-xs truncate max-w-[120px] rounded px-1 py-0.5",
                  dropTargetId === `crumb:${i}` && "bg-primary/15 ring-1 ring-primary",
                  i === breadcrumb.length - 1 ? "font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {b.title}
              </button>
            </span>
          ))}
        </div>

        {selected.size > 0 && (
          <span className="text-2xs text-muted-foreground shrink-0">{selected.size}</span>
        )}

        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
          title={t("documents.newDocument")}
          onClick={() => createMutation.mutate({ title: t("documents.untitled") })}
        >
          <FilePlus className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
          title={t("documents.newFolder")}
          onClick={() => createMutation.mutate({ title: t("documents.newFolder"), is_folder: true })}
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={viewMode === "grid" ? "secondary" : "ghost"}
          size="icon" className="h-7 w-7 shrink-0"
          onClick={() => setViewMode("grid")}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={viewMode === "list" ? "secondary" : "ghost"}
          size="icon" className="h-7 w-7 shrink-0"
          onClick={() => setViewMode("list")}
        >
          <List className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 콘텐츠 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 relative"
        onMouseDown={startMarquee}
        onClick={() => {
          if (marqueeMovedRef.current) { marqueeMovedRef.current = false; return; }
          setSelected(new Set());
        }}
        onContextMenu={(e) => { e.preventDefault(); onActivate(); setContextMenu({ x: e.clientX, y: e.clientY, doc: null }); }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("doc-ids")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const ids = readDraggedIds(e);
          if (ids.length) moveInto(ids, currentFolder);
        }}
      >
        {currentItems.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-10 w-10" />}
            title={t("empty.documents.title")}
            description={t("empty.documents.description")}
            cta={
              <Button size="sm" onClick={() => createMutation.mutate({ title: t("documents.untitled") })} className="gap-1.5">
                <FilePlus className="h-3.5 w-3.5" />
                {t("empty.documents.cta")}
              </Button>
            }
          />
        ) : viewMode === "grid" ? (
          <div className={cn(
            "grid gap-3",
            split
              ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
              : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
          )}>
            {currentItems.map((doc) => (
              <div
                key={doc.id}
                {...itemProps(doc)}
                className={cn(
                  "flex flex-col items-center p-4 rounded-xl border bg-card cursor-pointer transition-all group relative",
                  selected.has(doc.id) ? "border-primary bg-primary/5" : "hover:bg-accent/50",
                  dropTargetId === doc.id && "ring-2 ring-primary bg-primary/10",
                  clipboard.includes(doc.id) && "opacity-50",
                )}
              >
                {doc.is_folder
                  ? <FolderOpen className="h-10 w-10 text-amber-500 mb-2" />
                  : <FileText className="h-10 w-10 text-muted-foreground mb-2" />
                }
                {renamingId === doc.id ? (
                  <RenameInput doc={doc} />
                ) : (
                  <span className="text-xs font-medium text-center truncate w-full">{doc.title}</span>
                )}
                <span className="text-2xs text-muted-foreground mt-0.5">{fmtDate(doc.updated_at)}</span>

                {/* 자식이 있는 문서 — 배지를 눌러 하위로 들어간다(폴더는 더블클릭이면 충분) */}
                {!doc.is_folder && childCount(doc) > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); openFolder(doc); }}
                    title={`하위 문서 ${childCount(doc)}개 보기`}
                    className="absolute bottom-1 left-1 inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground hover:bg-primary/15 hover:text-primary transition-colors"
                  >
                    <ChevronRight className="h-2.5 w-2.5" />
                    {childCount(doc)}
                  </button>
                )}

                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ItemMenu
                    onOpen={() => openDoc(doc)}
                    onRename={() => setRenamingId(doc.id)}
                    onCut={() => { setClipboard([doc.id]); toast.success("잘라내기"); }}
                    onDelete={() => {
                      if (window.confirm(t("documents.deleteConfirm"))) deleteMutation.mutate([doc.id]);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <div className="flex items-center gap-4 px-4 py-2 border-b bg-muted/20 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <span className="flex-1">{t("documents.name")}</span>
              <span className="w-28 text-center">{t("documents.modified")}</span>
              <span className="w-20" />
            </div>
            {currentItems.map((doc) => (
              <div
                key={doc.id}
                {...itemProps(doc)}
                className={cn(
                  "flex items-center gap-4 px-4 py-2.5 border-b last:border-0 cursor-pointer transition-colors",
                  selected.has(doc.id) ? "bg-primary/10" : "hover:bg-accent/30",
                  dropTargetId === doc.id && "ring-2 ring-inset ring-primary bg-primary/10",
                  clipboard.includes(doc.id) && "opacity-50",
                )}
              >
                {doc.is_folder
                  ? <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                  : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                {renamingId === doc.id ? (
                  <div className="flex-1"><RenameInput doc={doc} /></div>
                ) : (
                  <span className="flex-1 text-sm truncate">{doc.title}</span>
                )}
                {!doc.is_folder && childCount(doc) > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); openFolder(doc); }}
                    title={`하위 문서 ${childCount(doc)}개 보기`}
                    className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground hover:bg-primary/15 hover:text-primary transition-colors"
                  >
                    <ChevronRight className="h-3 w-3" />
                    {childCount(doc)}
                  </button>
                )}
                <span className="w-28 text-center text-xs text-muted-foreground">{fmtDate(doc.updated_at)}</span>
                <div className="w-20 flex justify-end">
                  <ItemMenu
                    onOpen={() => openDoc(doc)}
                    onRename={() => setRenamingId(doc.id)}
                    onCut={() => { setClipboard([doc.id]); toast.success("잘라내기"); }}
                    onDelete={() => {
                      if (window.confirm(t("documents.deleteConfirm"))) deleteMutation.mutate([doc.id]);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {marquee && (
          <div
            className="absolute border border-primary bg-primary/10 pointer-events-none rounded-sm"
            style={{
              left: Math.min(marquee.x1, marquee.x2),
              top: Math.min(marquee.y1, marquee.y2),
              width: Math.abs(marquee.x2 - marquee.x1),
              height: Math.abs(marquee.y2 - marquee.y1),
            }}
          />
        )}
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[168px] rounded-lg border bg-popover p-1 shadow-lg [&_.ctx-item]:flex [&_.ctx-item]:w-full [&_.ctx-item]:items-center [&_.ctx-item]:gap-2 [&_.ctx-item]:rounded [&_.ctx-item]:px-2 [&_.ctx-item]:py-1.5 [&_.ctx-item]:text-xs [&_.ctx-item]:hover:bg-accent"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {itemActions(contextMenu.doc)}
        </div>
      )}
    </div>
  );
}

function ItemMenu({
  onOpen, onRename, onCut, onDelete,
}: { onOpen: () => void; onRename: () => void; onCut: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="p-1 rounded-md hover:bg-accent" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={onOpen}>
          <FolderOpen className="h-3.5 w-3.5 mr-2" /> 열기
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="h-3.5 w-3.5 mr-2" /> {t("documents.rename")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCut}>
          <FolderInput className="h-3.5 w-3.5 mr-2" /> {t("documents.moveTo")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5 mr-2" /> {t("documents.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
