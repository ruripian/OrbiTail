/**
 * Table 뷰 — Jira 스타일 카드형 플랫 테이블
 *
 * 기능:
 *  - 상단 필터 바: 상태/우선순위/담당자/라벨
 *  - 컬럼 드래그앤드롭 순서 변경 (HTML5 native DnD)
 *  - 컬럼 순서 + 가시성 localStorage 저장 (개인별 유지)
 *  - 셀 인라인 편집: 상태/우선순위/담당자/날짜 클릭 즉시 수정
 *  - 카드형 행: rounded + shadow + 행 간 공간감
 *  - 헤더 sticky: 세로 스크롤해도 컬럼 헤더 상단 고정
 *  - 헤더/행 동일 스크롤 컨테이너: 가로 스크롤 시 함께 이동 (Excel 방식)
 *  - 하위 이슈 트리: 클릭으로 펼치기/접기, 인라인 직접 생성 (Enter)
 */

import { useState, useMemo, useRef, Fragment, useEffect, createContext, useContext } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useRecentChangesStore } from "@/stores/recentChangesStore";
import {
  Plus, SlidersHorizontal, Check, X, Inbox,
  GitBranch, Link2, LayoutGrid, ChevronDown, ChevronRight,
  GripVertical, MoreHorizontal, Trash2, CheckCircle2, Copy, Archive, Share2, Layers, Circle,
  ArrowUp, ArrowDown, ArrowUpDown, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { issuesApi } from "@/api/issues";
import { formatDate } from "@/utils/date-format";
import { Tooltip } from "@/components/ui/tooltip";
import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { StatePicker } from "@/components/issues/state-picker";
import { PriorityPicker } from "@/components/issues/priority-picker";
import { AssigneePicker } from "@/components/issues/assignee-picker";
import { CategoryPicker } from "@/components/issues/category-picker";
import { SprintPicker } from "@/components/issues/sprint-picker";
import { LabelPicker } from "@/components/issues/label-picker";
import { useSavedFilters } from "@/hooks/useSavedFilters";
import { useIssueRefresh } from "@/hooks/useIssueMutations";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { useUndoStore } from "@/stores/undoStore";
import { projectsApi } from "@/api/projects";
import { cn } from "@/lib/utils";
import { Z_MODAL } from "@/constants/z-index";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { DatePicker } from "@/components/ui/date-picker";
import type { Issue, State, WorkspaceMember, Label, Category, Sprint } from "@/types";

/* 우선순위 상수 — 필터 표시용 (Picker는 자체 상수 사용) */
import { PRIORITY_COLOR, PRIORITY_LIST } from "@/constants/priority";
import { EmptyState } from "@/components/ui/empty-state";

type ColId =
  | "state" | "priority" | "assignee"
  | "startDate" | "dueDate" | "label"
  | "subIssues" | "links" | "category" | "sprint" | "id"
  | "createdAt" | "updatedAt";

interface ColDef {
  id: ColId;
  tKey: string;
  /** 헤더/행 간 정렬 일치를 위해 고정 px 너비 사용 */
  width: number;
  defaultVisible: boolean;
}

const COL_DEFS: ColDef[] = [
  { id: "state",     tKey: "issues.table.cols.state",     width: 170, defaultVisible: true },
  { id: "priority",  tKey: "issues.table.cols.priority",  width: 145, defaultVisible: true },
  { id: "assignee",  tKey: "issues.table.cols.assignee",  width: 155, defaultVisible: true },
  { id: "startDate", tKey: "issues.table.cols.startDate", width: 148, defaultVisible: true },
  { id: "dueDate",   tKey: "issues.table.cols.dueDate",   width: 148, defaultVisible: true },
  { id: "label",     tKey: "issues.table.cols.label",     width: 170, defaultVisible: true },
  { id: "subIssues", tKey: "issues.table.cols.subIssues", width: 96,  defaultVisible: true },
  { id: "links",     tKey: "issues.table.cols.links",     width: 84,  defaultVisible: true },
  { id: "category",  tKey: "issues.table.cols.module",    width: 145, defaultVisible: false },
  { id: "sprint",    tKey: "issues.table.cols.cycle",     width: 145, defaultVisible: false },
  { id: "createdAt", tKey: "issues.table.cols.createdAt", width: 130, defaultVisible: false },
  { id: "updatedAt", tKey: "issues.table.cols.updatedAt", width: 130, defaultVisible: false },
];

const COL_STORAGE_KEY = "orbitail_table_v2";

type SortDir = "asc" | "desc";
type SortKey = ColId | "_id" | "_title";
interface SortBy { colId: SortKey; dir: SortDir }

interface ColPrefs {
  order:   ColId[];
  visible: ColId[];
  /** 컬럼별 커스텀 너비 (px). 없으면 COL_DEFS 기본값 사용 */
  widths:  Partial<Record<ColId, number>>;
  /** ID 컬럼 표시 여부 (헤더/행 모두) */
  showId:  boolean;
  /** 컬럼별 정렬 — null 이면 사용자 수동 정렬(sort_order) 따름 */
  sortBy:  SortBy | null;
}

function loadPrefs(): ColPrefs {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ColPrefs>;
      const defaultOrder = COL_DEFS.map((c) => c.id);
      
      let order: ColId[] = (parsed.order ?? defaultOrder) as ColId[];
      if (!Array.isArray(order)) {
        order = defaultOrder;
      } else {
        // 제거된 컬럼이 localStorage에 남아있을 경우를 대비해 필터링
        order = order.filter((id) => defaultOrder.includes(id as ColId));
        // 새로 추가된 컬럼이 있으면 뒤에 보충
        const missing = defaultOrder.filter((id) => !order.includes(id));
        order = [...order, ...missing];
      }
      
      let visible = parsed.visible;
      if (!visible || !Array.isArray(visible)) {
        visible = COL_DEFS.filter((c) => c.defaultVisible).map((c) => c.id);
      } else {
        visible = visible.filter(id => defaultOrder.includes(id as ColId));
      }

      return {
        order:   order,
        visible: visible,
        widths:  parsed.widths  ?? {},
        showId:  parsed.showId !== undefined ? !!parsed.showId : true,
        sortBy:  parsed.sortBy ?? null,
      };
    }
  } catch {}
  return {
    order:   COL_DEFS.map((c) => c.id),
    visible: COL_DEFS.filter((c) => c.defaultVisible).map((c) => c.id),
    widths:  {},
    showId:  true,
    sortBy:  null,
  };
}

function savePrefs(prefs: ColPrefs) {
  localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(prefs));
}

/** 정렬용 키 추출 — 컬럼별로 비교 가능한 string/number 반환 */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
function getSortValue(issue: Issue, key: SortKey): string | number {
  switch (key) {
    case "_id":
    case "id":         return issue.sequence_id;
    case "_title":     return (issue.title ?? "").toLowerCase();
    case "state":      return issue.state_detail?.name ?? "";
    case "priority":   return PRIORITY_RANK[issue.priority] ?? 99;
    case "assignee":   return (issue.assignee_details?.[0]?.display_name ?? "").toLowerCase();
    case "startDate":  return issue.start_date ?? "";
    case "dueDate":    return issue.due_date ?? "";
    case "label":      return issue.label_details?.[0]?.name ?? "";
    case "subIssues":  return issue.sub_issues_count ?? 0;
    case "links":      return issue.link_count ?? 0;
    case "category":   return issue.category ?? "";
    case "sprint":     return issue.sprint ?? "";
    case "createdAt":  return issue.created_at ?? "";
    case "updatedAt":  return issue.updated_at ?? "";
    default: return "";
  }
}

interface Filters {
  states:     Set<string>;
  priorities: Set<string>;
  assignees:  Set<string>;
  labels:     Set<string>;
}
const EMPTY_FILTERS: Filters = {
  states: new Set(), priorities: new Set(), assignees: new Set(), labels: new Set(),
};

interface RowDragCtx {
  dragId:      string | null;
  nestTargetId: string | null;
  dropTarget:  string | null;
  dropZone:    "before" | "after" | "nest" | null;
  onDragStart: (issue: Issue) => void;
  onDragOver:  (e: React.DragEvent, issue: Issue, zone: "before" | "after" | "nest") => void;
  onDragEnd:   () => void;
  onDrop:      (issue: Issue) => void;
}

const RowDragContext = createContext<RowDragCtx>({
  dragId: null, nestTargetId: null, dropTarget: null, dropZone: null,
  onDragStart: () => {}, onDragOver: () => {}, onDragEnd: () => {}, onDrop: () => {},
});

/* 관계 강조 컨텍스트 — connectedSet 이 있으면 이 set 에 없는 이슈는 dim 처리.
   depthMap 으로 직접(1) / 간접(2) 구분, focusIssueId 는 현재 포커스 이슈. */
interface RelCtx {
  connectedSet: Set<string> | null;
  depthMap: Map<string, number> | null;
  focusIssueId: string | null;
}
const RelHighlightContext = createContext<RelCtx>({ connectedSet: null, depthMap: null, focusIssueId: null });

/** 순환 참조 검증 — dragId를 targetId의 하위로 넣으면 순환이 생기는지 확인.
 *  - dragId === targetId: 자기 자신을 자기 자신에 넣는 경우 → 즉시 차단
 *  - 그 외: targetId가 dragId의 자손이면 순환 */
function wouldCreateCycle(issues: Issue[], dragId: string, targetId: string): boolean {
  if (dragId === targetId) return true; // self-nest 직접 차단
  /* targetId가 dragId의 자손인지 확인 — dragId 기준 하위 트리 탐색 */
  const childrenMap = new Map<string | null, Issue[]>();
  for (const iss of issues) {
    const pid = iss.parent ?? null;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid)!.push(iss);
  }
  /* BFS로 dragId의 모든 자손을 탐색 */
  const queue = [dragId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const children = childrenMap.get(current) ?? [];
    for (const child of children) {
      if (child.id === targetId) return true; // 순환 발견
      queue.push(child.id);
    }
  }
  return false;
}

interface Props {
  workspaceSlug: string;
  projectId:     string;
  onIssueClick:  (issueId: string) => void;
  issueFilter?: Record<string, string>;
  readOnly?:    boolean;
}

/* 관계 강조 모드 — localStorage 영속 */
const REL_MODE_KEY = "orbitail_table_rel_highlight";

export function TableView({ workspaceSlug, projectId, onIssueClick, issueFilter, readOnly }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { refresh } = useIssueRefresh(workspaceSlug, projectId);
  const [searchParams] = useSearchParams();
  const focusIssueId = searchParams.get("issue");

  /* ── 관계 강조 모드 ── */
  const [relHighlight, setRelHighlight] = useState<boolean>(() => {
    try { return localStorage.getItem(REL_MODE_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(REL_MODE_KEY, relHighlight ? "1" : "0"); } catch { /* ignore */ }
  }, [relHighlight]);

  /* 프로젝트 범위의 수동 node link 만 가져와 adjacency 구성.
     관계 강조 모드가 ON 이고 focus 가 있을 때만 실제로 활용 — 다른 시점엔 조용히 캐시 */
  const { data: nodeGraphData } = useQuery({
    queryKey: ["node-graph", workspaceSlug, projectId, "manual"],
    queryFn: () => issuesApi.nodeGraph(workspaceSlug, projectId, { manualOnly: true, includeLabelEdges: false }),
    enabled: !!workspaceSlug && !!projectId && relHighlight,
    staleTime: 30_000,
  });

  /* adjacency: issue_id -> 연결된 issue_id Set. 수동 node-link + 부모-자식 양쪽 모두 포함.
     2-hop 까지 BFS, depthMap 으로 직접/간접 구분 */
  const { connectedSet, connectedDepthMap } = useMemo<{ connectedSet: Set<string> | null; connectedDepthMap: Map<string, number> | null }>(() => {
    if (!relHighlight || !focusIssueId || !nodeGraphData) return { connectedSet: null, connectedDepthMap: null };
    const adj = new Map<string, Set<string>>();
    for (const e of nodeGraphData.edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    const dmap = new Map<string, number>([[focusIssueId, 0]]);
    const queue: Array<[string, number]> = [[focusIssueId, 0]];
    while (queue.length > 0) {
      const [id, depth] = queue.shift()!;
      if (depth >= 2) continue;
      const neighbors = adj.get(id);
      if (!neighbors) continue;
      for (const n of neighbors) {
        if (!dmap.has(n)) {
          dmap.set(n, depth + 1);
          queue.push([n, depth + 1]);
        }
      }
    }
    return { connectedSet: new Set(dmap.keys()), connectedDepthMap: dmap };
  }, [relHighlight, focusIssueId, nodeGraphData]);

  const { data: project } = useQuery({
    queryKey: ["project", workspaceSlug, projectId],
    queryFn:  () => projectsApi.get(workspaceSlug, projectId),
  });
  const { data: issues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, issueFilter],
    queryFn:  () => issuesApi.list(workspaceSlug, projectId, issueFilter),
  });
  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn:  () => projectsApi.states.list(workspaceSlug, projectId),
  });
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn:  () => projectsApi.members.list(workspaceSlug, projectId),
  });
  const { data: projectCategories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, projectId],
    queryFn:  () => projectsApi.categories.list(workspaceSlug, projectId),
  });
  const { data: projectSprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn:  () => projectsApi.sprints.list(workspaceSlug, projectId),
  });
  const { data: labels = [] } = useQuery({
    queryKey: ["labels", projectId],
    queryFn:  () => issuesApi.labels.list(workspaceSlug, projectId),
  });

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [inlineAdding, setInlineAdding] = useState(false);
  const [inlineTitle, setInlineTitle]   = useState("");

  const inlineCreateMutation = useMutation({
    mutationFn: (title: string) => {
      const defaultState = states.find((s) => s.group === "unstarted")?.id ?? states.find((s) => s.default)?.id ?? states[0]?.id;
      return issuesApi.create(workspaceSlug, projectId, {
        title,
        state: defaultState,
        priority: "medium",
        project: projectId,
        ...(issueFilter?.category ? { category: issueFilter.category } : {}),
        ...(issueFilter?.sprint  ? { sprint:  issueFilter.sprint }  : {}),
      } as Partial<Issue>);
    },
    onSuccess: () => {
      // 스크롤 위치 보존
      const scrollEl = scrollRef.current;
      const savedTop = scrollEl?.scrollTop ?? 0;

      refresh();
      setInlineTitle("");
      // 인라인 입력 유지 — 연속 생성 가능하도록 닫지 않음
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = savedTop;
      });
    },
  });

  const [prefs, setPrefs] = useState<ColPrefs>(loadPrefs);

  const updatePrefs = (next: ColPrefs) => { setPrefs(next); savePrefs(next); };

  const toggleVisible = (id: ColId) => {
    const visible = prefs.visible.includes(id)
      ? prefs.visible.filter((v) => v !== id)
      : [...prefs.visible, id];
    updatePrefs({ ...prefs, visible });
  };

  /* 컬럼 헤더 클릭 시 정렬 사이클: none → asc → desc → none */
  const cycleSort = (colId: SortKey) => {
    const cur = prefs.sortBy;
    let next: SortBy | null;
    if (!cur || cur.colId !== colId) next = { colId, dir: "asc" };
    else if (cur.dir === "asc")      next = { colId, dir: "desc" };
    else                             next = null;
    updatePrefs({ ...prefs, sortBy: next });
  };

  /* 정렬 + 수동 순서 둘 다 초기화 — 사용자가 저장해둔 sort_order 로 복귀 */
  const resetSort = () => {
    setLocalOrder(null);
    updatePrefs({ ...prefs, sortBy: null });
  };

  /* prefs.order 순서대로 정렬된, visible 필터링된 컬럼.
     widths 에 저장된 값이 있으면 COL_DEFS 기본값을 덮어씀 */
  const activeCols: ColDef[] = prefs.order
    .filter((id) => prefs.visible.includes(id))
    .map((id) => {
      const def = COL_DEFS.find((c) => c.id === id);
      if (!def) return null;
      return { ...def, width: prefs.widths[id] ?? def.width };
    })
    .filter((col): col is ColDef => col !== null);

  const dragColRef = useRef<ColId | null>(null);
  /* 시각 피드백용 state (ref는 리렌더를 유발하지 않으므로 별도 관리) */
  const [dragColId, setDragColId] = useState<ColId | null>(null);
  const [dropColId, setDropColId] = useState<ColId | null>(null);

  const onColDragStart = (id: ColId) => { dragColRef.current = id; setDragColId(id); };
  const onColDragOver  = (e: React.DragEvent, id: ColId) => { e.preventDefault(); setDropColId(id); };
  const onColDragEnd   = () => { dragColRef.current = null; setDragColId(null); setDropColId(null); };
  const onColDrop = (targetId: ColId) => {
    const src = dragColRef.current;
    if (!src || src === targetId) { onColDragEnd(); return; }
    const order = [...prefs.order];
    const from  = order.indexOf(src);
    const to    = order.indexOf(targetId);
    order.splice(from, 1);
    order.splice(to, 0, src);
    updatePrefs({ ...prefs, order });
    onColDragEnd();
  };

  const [resizingCol, setResizingCol] = useState<ColId | "_title" | "_id" | null>(null);
  const resizingColRef = useRef<ColId | "_title" | "_id" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* 리사이즈 중 전역 커서를 col-resize로 고정, 텍스트 선택 방지 */
  useEffect(() => {
    if (!resizingCol) return;
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
    };
  }, [resizingCol]);

  const startResize = (e: React.MouseEvent, colId: ColId | "_title" | "_id") => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colId === "_title" ? (prefs.widths["_title" as ColId] ?? 320) 
                 : colId === "_id"    ? (prefs.widths["id" as ColId] ?? 80)
                 : (prefs.widths[colId as ColId] ?? COL_DEFS.find((c) => c.id === colId)!.width);
    resizingColRef.current = colId;
    setResizingCol(colId);

    let finalW = startW;

    const onMove = (ev: MouseEvent) => {
      finalW = Math.max(60, startW + ev.clientX - startX);
      if (containerRef.current) {
        containerRef.current.style.setProperty(`--col-w-${colId}`, `${finalW}px`);
      }
    };

    const onUp = () => {
      setResizingCol(null);
      resizingColRef.current = null;
      /* 최종 widths 를 localStorage 에 저장 (리렌더링은 마우스업 시점에만 발생) */
      const storeKey = colId === "_id" ? "id" : colId;
      setPrefs((prev) => { 
        const next = { ...prev, widths: { ...prev.widths, [storeKey]: finalW } };
        savePrefs(next); 
        return next; 
      });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  };

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  /** 메인 이슈 리스트 캐시에서 특정 이슈의 sub_issues_count 를 즉시 증감.
   *  드래그-네스트 후 부모 행의 확장 화살표가 서버 refetch 전에 표시되도록 하기 위한 낙관적 업데이트. */
  const bumpSubIssuesCount = (issueId: string, delta: number) => {
    const patch = (iss: Issue): Issue =>
      iss.id === issueId
        ? { ...iss, sub_issues_count: Math.max(0, (iss.sub_issues_count ?? 0) + delta) }
        : iss;
    // 최상위 리스트 캐시
    qc.setQueryData<Issue[]>(
      ["issues", workspaceSlug, projectId, issueFilter],
      (old) => (old ? old.map(patch) : old),
    );
    // 해당 이슈가 다른 부모의 하위로 존재하는 경우 — 모든 sub-issues 캐시 탐색
    qc.getQueriesData<Issue[]>({ queryKey: ["sub-issues"] }).forEach(([key, data]) => {
      if (!data) return;
      if (data.some((iss) => iss.id === issueId)) {
        qc.setQueryData<Issue[]>(key, (old) => (old ? old.map(patch) : old));
      }
    });
  };

  /** 이슈 id의 모든 하위 이슈 id를 재귀 수집 (React Query 캐시에서 읽기) */
  const collectDescendants = (parentId: string): string[] => {
    const cached = qc.getQueryData<Issue[]>(["sub-issues", parentId]) ?? [];
    const result: string[] = [];
    for (const child of cached) {
      result.push(child.id);
      result.push(...collectDescendants(child.id));
    }
    return result;
  };

  const toggleSelect = (id: string, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedId && topLevelFiltered.length > 0) {
        // Shift+클릭: 범위 선택
        const ids = topLevelFiltered.map((i) => i.id);
        const from = ids.indexOf(lastClickedId);
        const to = ids.indexOf(id);
        if (from !== -1 && to !== -1) {
          const [start, end] = from < to ? [from, to] : [to, from];
          for (let i = start; i <= end; i++) next.add(ids[i]);
          return next;
        }
      }
      const descendants = collectDescendants(id);
      if (next.has(id)) {
        next.delete(id);
        for (const cid of descendants) next.delete(cid);
      } else {
        next.add(id);
        for (const cid of descendants) next.add(cid);
      }
      return next;
    });
    setLastClickedId(id);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === allSelectableIds.size && [...allSelectableIds].every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allSelectableIds));
    }
  };

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const savedFilters = useSavedFilters(projectId);

  /* 완료된 이슈 숨김 토글 — 프로젝트별 localStorage 저장 */
  const hideCompletedKey = `table:hideCompleted:${projectId}`;
  const [hideCompleted, setHideCompleted] = useState<boolean>(() => {
    try { return localStorage.getItem(hideCompletedKey) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(hideCompletedKey, hideCompleted ? "1" : "0"); } catch { /* ignore */ }
  }, [hideCompleted, hideCompletedKey]);

  const hasFilter =
    filters.states.size > 0 || filters.priorities.size > 0 ||
    filters.assignees.size > 0 || filters.labels.size > 0;

  const toggleFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => {
      const next = new Set(prev[key]);
      next.has(value) ? next.delete(value) : next.add(value);
      return { ...prev, [key]: next };
    });
  };
  const clearFilter = (key: keyof Filters) => {
    setFilters((prev) => ({ ...prev, [key]: new Set<string>() }));
  };

  /* ── 행 DnD 상태 (전체 트리 통합 — 최상위 ↔ 하위 이슈 간 자유 이동) ──
     state: 리렌더 유발(시각 피드백) / ref: 이벤트 핸들러에서 stale closure 없이 즉시 읽기 */
  const [dragId,       setDragId]       = useState<string | null>(null);
  const [nestTargetId, setNestTargetId] = useState<string | null>(null);
  const [dropTarget,   setDropTarget]   = useState<string | null>(null);
  const [dropZone,     setDropZone]     = useState<"before" | "after" | "nest" | null>(null);

  const dragIdRef     = useRef<string | null>(null);    // 드래그 중인 이슈 id
  const dragParentRef = useRef<string | null>(null);    // 드래그 중인 이슈의 현재 parent
  const nestTargetRef = useRef<string | null>(null);
  const dropZoneRef   = useRef<"before" | "after" | "nest">("after");
  const dropTargetRef = useRef<Issue | null>(null);     // drop 시점의 target Issue 전체

  const clearDrag = () => {
    dragIdRef.current     = null;
    dragParentRef.current = null;
    nestTargetRef.current = null;
    /* dropTargetRef/dropZoneRef도 함께 리셋 — 안 그러면 이전 드래그의 타겟이
       다음 드래그로 새서 ghost-card 폴백이 잘못된 effectiveTarget을 반환할 수 있음 */
    dropTargetRef.current = null;
    dropZoneRef.current   = "after";
    setDragId(null);
    setNestTargetId(null);
    setDropTarget(null);
    setDropZone(null);
  };

  const handleDragStart = (issue: Issue) => {
    dragIdRef.current     = issue.id;
    dragParentRef.current = issue.parent ?? null;
    /* 새 드래그 시작 시 stale 참조 제거 — clearDrag와 동일한 이유 */
    dropTargetRef.current = null;
    dropZoneRef.current   = "after";
    setDragId(issue.id);
  };

  const handleDragOver = (e: React.DragEvent, issue: Issue, zone: "before" | "after" | "nest") => {
    e.preventDefault();
    // 자기 자신 위에 드래그 중이면 인디케이터 표시 안 함 (깜빡임 방지)
    if (issue.id === dragIdRef.current) return;
    dropZoneRef.current   = zone;
    dropTargetRef.current = issue;
    setDropTarget(issue.id);
    setDropZone(zone);
    if (zone === "nest") {
      nestTargetRef.current = issue.id;
      setNestTargetId(issue.id);
    } else {
      nestTargetRef.current = null;
      setNestTargetId(null);
    }
  };

  /* localOrder: 드래그 후 서버 응답 전까지 시각적 순서를 독립 관리
     서버 캐시 race-condition에 완전히 무관하게 즉시 반영 */
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);

  /* 최상위 이슈만 (parent === null) + 필터 적용 */
  const topLevelFiltered = useMemo(() => {
    const base = issues
      .filter((issue) => issue.parent === null)
      .filter((issue) => {
        if (filters.states.size     > 0 && !filters.states.has(issue.state))                        return false;
        if (filters.priorities.size > 0 && !filters.priorities.has(issue.priority))                  return false;
        if (filters.assignees.size  > 0 && !issue.assignees.some((a) => filters.assignees.has(a)))  return false;
        if (filters.labels.size     > 0 && !issue.label.some((l) => filters.labels.has(l)))         return false;
        /* 완료된 이슈 숨김 — state_detail.group 기준
           단, 하위 이슈 중 미완료 항목이 있으면 숨기지 않음 */
        if (hideCompleted) {
          const g = issue.state_detail?.group;
          if (g === "completed" || g === "cancelled") {
            const hasActiveChild = issue.sub_issues_count > 0 && issues.some(
              (child) => child.parent === issue.id &&
                child.state_detail?.group !== "completed" &&
                child.state_detail?.group !== "cancelled"
            );
            if (!hasActiveChild) return false;
          }
        }
        return true;
      })
      .sort((a, b) => a.sort_order - b.sort_order || a.sequence_id - b.sequence_id);
    // 컬럼 정렬이 설정되어 있으면 sort_order/localOrder 보다 우선 적용
    if (prefs.sortBy) {
      const { colId, dir } = prefs.sortBy;
      const sign = dir === "asc" ? 1 : -1;
      return [...base].sort((a, b) => {
        const va = getSortValue(a, colId);
        const vb = getSortValue(b, colId);
        if (va === vb) return a.sequence_id - b.sequence_id;
        if (va === "" || va === null || va === undefined) return 1;  // 빈 값은 항상 뒤로
        if (vb === "" || vb === null || vb === undefined) return -1;
        return va < vb ? -1 * sign : 1 * sign;
      });
    }
    // localOrder가 설정된 동안: 순서만 override, 이슈 데이터는 서버 데이터 그대로 사용
    if (localOrder) {
      const idxMap = new Map(localOrder.map((id, i) => [id, i]));
      return [...base].sort((a, b) => (idxMap.get(a.id) ?? 9999) - (idxMap.get(b.id) ?? 9999));
    }
    return base;
  }, [issues, filters, localOrder, hideCompleted, prefs.sortBy]);

  /* 전체 선택 대상 — 최상위 + 캐시에 로드된 하위 이슈 ID */
  const allSelectableIds = useMemo(() => {
    const ids = new Set<string>();
    const addChildren = (parentId: string) => {
      const cached = qc.getQueryData<Issue[]>(["sub-issues", parentId]) ?? [];
      for (const child of cached) {
        if (!ids.has(child.id)) {
          ids.add(child.id);
          addChildren(child.id);
        }
      }
    };
    for (const issue of topLevelFiltered) {
      ids.add(issue.id);
      addChildren(issue.id);
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topLevelFiltered, issues]);

  /* 드래그 중 실시간 미리보기: 드래그 중인 카드를 hover 위치로 이동해 보여줌
     — 최상위 이슈 간 같은 레벨 이동에만 적용 (하위이슈는 IssueCard 내 liveSubOrder 처리) */
  const liveDisplayOrder = useMemo(() => {
    if (!dragId || !dropTarget || !dropZone || dropZone === "nest") return topLevelFiltered;
    const fromIdx = topLevelFiltered.findIndex((i) => i.id === dragId);
    const toIdx   = topLevelFiltered.findIndex((i) => i.id === dropTarget);
    // 한쪽이라도 최상위 목록에 없으면 (ex. 하위이슈 → 최상위 크로스 드래그) 원래 목록 유지
    if (fromIdx === -1 || toIdx === -1) return topLevelFiltered;
    let insertIdx = dropZone === "before" ? toIdx : toIdx + 1;
    const newArr  = [...topLevelFiltered];
    const [moved] = newArr.splice(fromIdx, 1);
    if (fromIdx < insertIdx) insertIdx--;
    newArr.splice(insertIdx, 0, moved);
    return newArr;
  }, [dragId, dropTarget, dropZone, topLevelFiltered]);

  const handleDrop = (target: Issue) => {
    // ref에서 직접 읽어 stale closure 완전 방지
    const id          = dragIdRef.current;
    const oldParentId = dragParentRef.current;
    const zone        = dropZoneRef.current;

    // live preview에서 ghost 카드(자기 자신) 위에 drop한 경우:
    // → 마지막으로 hover했던 실제 타겟(dropTargetRef)으로 대체
    const effectiveTarget = (id && target.id === id && dropTargetRef.current)
      ? dropTargetRef.current
      : target;

    clearDrag();
    if (!id || !effectiveTarget || effectiveTarget.id === id) return;

    // ── A: 네스트 (카드 중간 구역 → 하위 편입) ──
    if (zone === "nest") {
      /* 순환 참조 방지 — 자신의 하위 트리에 타겟이 있으면 차단 */
      if (wouldCreateCycle(issues, id, effectiveTarget.id)) {
        toast.error(t("issues.table.cyclicNestError"));
        return;
      }
      // 낙관적: 새 부모의 sub_issues_count 즉시 +1 → 확장 화살표 즉시 표시
      bumpSubIssuesCount(effectiveTarget.id, +1);
      if (oldParentId) bumpSubIssuesCount(oldParentId, -1);
      issuesApi.update(workspaceSlug, projectId, id, { parent: effectiveTarget.id }).then(() => {
        qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId, issueFilter] });
        qc.invalidateQueries({ queryKey: ["sub-issues", effectiveTarget.id] });
        if (oldParentId) qc.invalidateQueries({ queryKey: ["sub-issues", oldParentId] });
        qc.invalidateQueries({ queryKey: ["my-issues", workspaceSlug] });
      });
      return;
    }

    const newParentId = effectiveTarget.parent ?? null;

    // ── B: 같은 레벨 재정렬 ──
    if (oldParentId === newParentId) {
      const arr = newParentId === null
        ? topLevelFiltered
        : [...(qc.getQueryData<Issue[]>(["sub-issues", newParentId]) ?? [])]
            .sort((a, b) => a.sort_order - b.sort_order || a.sequence_id - b.sequence_id);
      const fromIdx = arr.findIndex((i) => i.id === id);
      const toIdx   = arr.findIndex((i) => i.id === effectiveTarget.id);
      if (fromIdx === -1 || toIdx === -1) return;
      let insertIdx = zone === "before" ? toIdx : toIdx + 1;
      const newArr  = [...arr];
      const [moved] = newArr.splice(fromIdx, 1);
      if (fromIdx < insertIdx) insertIdx--;
      newArr.splice(insertIdx, 0, moved);

      if (newParentId === null) {
        // 최상위: localOrder로 즉시 시각 반영 (서버 캐시 경쟁 조건 없음)
        setLocalOrder(newArr.map((iss) => iss.id));
        Promise.all(newArr.map((iss, i) =>
          issuesApi.update(workspaceSlug, projectId, iss.id, { sort_order: (i + 1) * 10000 })
        )).then(() =>
          // refetchQueries 완료 후 localOrder 해제 — stale 데이터 flash 방지
          qc.refetchQueries({ queryKey: ["issues", workspaceSlug, projectId, issueFilter] })
        ).then(() => setLocalOrder(null));
      } else {
        // 하위 이슈: setQueryData로 즉시 반영
        const cacheKey = ["sub-issues", newParentId];
        const sortOrderMap = new Map(newArr.map((iss, i) => [iss.id, (i + 1) * 10000]));
        qc.setQueryData<Issue[]>(cacheKey, (old = []) =>
          old.map((iss) => {
            const o = sortOrderMap.get(iss.id);
            return o !== undefined ? { ...iss, sort_order: o } : iss;
          })
        );
        Promise.all(newArr.map((iss, i) =>
          issuesApi.update(workspaceSlug, projectId, iss.id, { sort_order: (i + 1) * 10000 })
        )).then(() => qc.invalidateQueries({ queryKey: cacheKey }));
      }
      return;
    }

    // ── C: 레벨 간 이동 (parent 변경 + 위치 지정) ──
    // 하위→최상위 빼기: newParentId === null이면 parent를 null로 설정
    const newSortOrder = zone === "before"
      ? Math.max(1, effectiveTarget.sort_order - 5000)
      : effectiveTarget.sort_order + 5000;
    // 낙관적 카운트 업데이트 (부모 변경) → 확장 화살표 즉시 반영
    if (newParentId) bumpSubIssuesCount(newParentId, +1);
    if (oldParentId) bumpSubIssuesCount(oldParentId, -1);
    issuesApi.update(workspaceSlug, projectId, id, {
      parent:     newParentId,
      sort_order: newSortOrder,
    }).then(() => {
      qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId, issueFilter] });
      if (newParentId)  qc.invalidateQueries({ queryKey: ["sub-issues", newParentId] });
      if (oldParentId)  qc.invalidateQueries({ queryKey: ["sub-issues", oldParentId] });
      qc.invalidateQueries({ queryKey: ["my-issues", workspaceSlug] });
    });
  };

  /* CSS Variable 기반 부드러운 리사이즈를 위한 컨테이너 스타일
       CSS 변수는 React.CSSProperties에 직접 키 매핑이 없어 Record 캐스팅으로 우회 */
  const colStyles = useMemo(() => {
    const s: Record<string, string> = {};
    activeCols.forEach((col) => {
      s[`--col-w-${col.id}`] = `${col.width}px`;
    });
    s["--col-w-_title"] = `${prefs.widths["_title" as ColId] ?? 320}px`;
    s["--col-w-_id"]    = `${prefs.widths["id" as ColId] ?? 80}px`;
    return s as React.CSSProperties;
  }, [activeCols, prefs.widths]);

  const dragCtx: RowDragCtx = {
    dragId, nestTargetId, dropTarget, dropZone,
    onDragStart: handleDragStart,
    onDragOver:  handleDragOver,
    onDragEnd:   clearDrag,
    onDrop:      handleDrop,
  };

  return (
    <RowDragContext.Provider value={dragCtx}>
    <RelHighlightContext.Provider value={{ connectedSet, depthMap: connectedDepthMap, focusIssueId }}>
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden" style={colStyles}>

      <div className="flex items-center gap-2 px-3 sm:px-5 py-2 sm:py-3 border-b border-border shrink-0 flex-wrap">
        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

        <FilterDropdown
          variant="grid"
          label={t("issues.filter.state")}
          emptyLabel={t("issues.filter.empty")}
          items={states.map((s) => ({ id: s.id, label: s.name, color: s.color }))}
          selected={filters.states}
          onToggle={(id) => toggleFilter("states", id)}
          onClear={() => clearFilter("states")}
        />
        <FilterDropdown
          variant="grid"
          label={t("issues.filter.priority")}
          emptyLabel={t("issues.filter.empty")}
          items={PRIORITY_LIST.map((k) => ({
            id: k, label: t(`issues.priority.${k}`), color: PRIORITY_COLOR[k],
          }))}
          selected={filters.priorities}
          onToggle={(id) => toggleFilter("priorities", id)}
          onClear={() => clearFilter("priorities")}
        />
        <FilterDropdown
          variant="checkbox"
          label={t("issues.filter.assignee")}
          emptyLabel={t("issues.filter.empty")}
          items={members.map((m) => ({ id: m.member.id, label: m.member.display_name }))}
          selected={filters.assignees}
          onToggle={(id) => toggleFilter("assignees", id)}
          onClear={() => clearFilter("assignees")}
        />
        <FilterDropdown
          variant="grid"
          label={t("issues.filter.label")}
          emptyLabel={t("issues.filter.empty")}
          items={labels.map((l) => ({ id: l.id, label: l.name, color: l.color }))}
          selected={filters.labels}
          onToggle={(id) => toggleFilter("labels", id)}
          onClear={() => clearFilter("labels")}
        />

        <button
          type="button"
          onClick={() => setHideCompleted((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 border transition-all duration-fast",
            hideCompleted
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}
          title={hideCompleted ? t("issues.filter.showCompleted") : t("issues.filter.hideCompleted")}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {hideCompleted ? t("issues.filter.hideCompleted") : t("issues.filter.showCompleted")}
        </button>

        {/* 관계 강조 토글 — 선택된 이슈의 노드 링크만 하이라이트, 나머지 dim */}
        <button
          type="button"
          onClick={() => setRelHighlight((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 border transition-all duration-fast",
            relHighlight
              ? "bg-amber-400/15 border-amber-400/40 text-amber-600 dark:text-amber-400"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}
          title={relHighlight
            ? "관계 강조 끄기"
            : "관계 강조 — 이슈 선택 시 연결된 이슈만 하이라이트, 나머지는 반투명 처리"
          }
        >
          <Share2 className="h-3.5 w-3.5" />
          {relHighlight
            ? (connectedDepthMap && focusIssueId
                ? `관계 강조 · 직접 ${Array.from(connectedDepthMap.values()).filter((d) => d === 1).length} · 간접 ${Array.from(connectedDepthMap.values()).filter((d) => d === 2).length}`
                : "관계 강조 켜짐 (이슈 선택 필요)")
            : "관계 강조"}
        </button>

        {hasFilter && (
          <>
            <button
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="text-xs text-muted-foreground hover:text-foreground px-1"
            >
              {t("issues.table.resetFilters")}
            </button>
            <button
              onClick={() => {
                const name = window.prompt(t("issues.filter.savePrompt"));
                if (name?.trim()) savedFilters.saveFilter(name.trim(), filters);
              }}
              className="text-xs text-primary hover:underline px-1"
            >
              {t("issues.filter.save")}
            </button>
          </>
        )}

        {savedFilters.presets.length > 0 && (
          <div className="flex items-center gap-1">
            {savedFilters.presets.map((preset) => (
              <div key={preset.id} className="flex items-center gap-0.5">
                <button
                  onClick={() => setFilters(savedFilters.toFilters(preset))}
                  className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-md hover:bg-primary/20 transition-colors"
                >
                  {preset.name}
                </button>
                <button
                  onClick={() => savedFilters.deleteFilter(preset.id)}
                  className="text-xs text-muted-foreground hover:text-destructive px-0.5"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 rounded-lg">
              <LayoutGrid className="h-3.5 w-3.5" />
              {t("issues.table.columns")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 rounded-xl p-2">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 px-1.5 pb-1.5">
              {t("issues.table.columns")}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {/* ID 컬럼 토글 — 별도 처리 (COL_DEFS 외부) */}
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); updatePrefs({ ...prefs, showId: !prefs.showId }); }}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md border transition-all",
                  prefs.showId
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "text-muted-foreground border-border hover:bg-muted/40 hover:text-foreground"
                )}
              >
                {prefs.showId && <Check className="h-3 w-3 shrink-0" />}
                <span className="truncate">{t("issues.table.cols.id")}</span>
              </button>
              {prefs.order.map((id) => {
                const col = COL_DEFS.find((c) => c.id === id);
                if (!col) return null;
                const active = prefs.visible.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={(e) => { e.preventDefault(); toggleVisible(id); }}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md border transition-all",
                      active
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "text-muted-foreground border-border hover:bg-muted/40 hover:text-foreground"
                    )}
                  >
                    {active && <Check className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{t(col.tKey)}</span>
                  </button>
                );
              })}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {(prefs.sortBy || localOrder) && (
          <button
            onClick={resetSort}
            className="h-8 inline-flex items-center gap-1.5 text-xs px-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title={t("issues.table.resetSortHint", "수동 순서로 복귀")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("issues.table.resetSort", "정렬 초기화")}
          </button>
        )}

        {!readOnly && (
          <Button
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
            className="h-8 text-xs gap-1.5 rounded-lg"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("views.addIssue")}
          </Button>
        )}
      </div>

      <IssueCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        states={states}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        defaultCategoryId={issueFilter?.category}
        defaultSprintId={issueFilter?.sprint}
      />

      <div ref={scrollRef} data-scroll-container className="flex-1 overflow-auto">
        {/* min-w-max: 내용이 컨테이너보다 넓어질 때 가로 스크롤 허용 */}
        <div className="min-w-max px-5">

          {/* 컬럼 헤더 — sticky top: 세로 스크롤 시 상단 고정 */}
          <div className="sticky top-0 z-10 bg-background">
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border min-w-max">
              <Checkbox
                checked={selectedIds.size > 0 && selectedIds.size === allSelectableIds.size}
                indeterminate={selectedIds.size > 0 && selectedIds.size < allSelectableIds.size}
                onChange={() => toggleSelectAll()}
              />

              {prefs.showId && (
                <>
                  <button
                    type="button"
                    onClick={() => cycleSort("_id")}
                    className="flex items-center gap-1 text-xs font-semibold text-muted-foreground/70 hover:text-foreground uppercase tracking-wide select-none shrink-0 overflow-hidden text-ellipsis"
                    style={{ width: "var(--col-w-_id)", minWidth: "var(--col-w-_id)" }}
                  >
                    <span>{t("issues.table.cols.id")}</span>
                    <SortIndicator active={prefs.sortBy?.colId === "_id"} dir={prefs.sortBy?.dir} />
                  </button>

                  <ColDropIndicator
                    active={false}
                    onResizeStart={(e) => startResize(e, "_id")}
                    isResizing={resizingCol === "_id"}
                  />
                </>
              )}

              <div
                className="flex items-center gap-2 shrink-0 overflow-hidden"
                style={{ width: "var(--col-w-_title)", minWidth: "var(--col-w-_title)" }}
              >
                <div className="w-5 shrink-0" />
                <button
                  type="button"
                  onClick={() => cycleSort("_title")}
                  className="flex items-center gap-1 text-xs font-semibold text-muted-foreground/70 hover:text-foreground uppercase tracking-wide select-none overflow-hidden text-ellipsis"
                >
                  <span>{t("issues.table.cols.title")}</span>
                  <SortIndicator active={prefs.sortBy?.colId === "_title"} dir={prefs.sortBy?.dir} />
                </button>
              </div>
              
              {activeCols.map((col, i) => {
                const isDraggingThis = dragColId === col.id;
                const showIndicator  = dropColId === col.id && dragColId !== null && !isDraggingThis;
                const prevColId      = i > 0 ? activeCols[i - 1].id : "_title";
                return (
                  <Fragment key={col.id}>
                    <ColDropIndicator
                      active={showIndicator}
                      onResizeStart={!dragColId ? (e) => startResize(e, prevColId) : undefined}
                      isResizing={resizingCol === prevColId}
                    />
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", `col-${col.id}`);
                        e.dataTransfer.effectAllowed = "move";
                        onColDragStart(col.id);
                      }}
                      onDragOver={(e) => onColDragOver(e, col.id)}
                      onDragEnd={onColDragEnd}
                      onDrop={() => onColDrop(col.id)}
                      style={{ width: `var(--col-w-${col.id})`, minWidth: `var(--col-w-${col.id})` }}
                      className={cn(
                        "flex items-center gap-1 text-xs font-semibold uppercase tracking-wide cursor-grab active:cursor-grabbing select-none group shrink-0 overflow-hidden transition-all duration-fast",
                        isDraggingThis
                          ? "opacity-20 scale-[0.95] text-muted-foreground/40"
                          : showIndicator
                            ? "text-primary/80"
                            : "text-muted-foreground/70",
                      )}
                    >
                      <GripVertical className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity shrink-0" />
                      <span
                        onClick={(e) => { e.stopPropagation(); cycleSort(col.id); }}
                        className="whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer hover:text-foreground inline-flex items-center gap-1"
                      >
                        {t(col.tKey)}
                        <SortIndicator active={prefs.sortBy?.colId === col.id} dir={prefs.sortBy?.dir} />
                      </span>
                    </div>
                  </Fragment>
                );
              })}
              {/* 마지막 컬럼 뒤 리사이즈 핸들 — 마지막 컬럼도 늘릴 수 있도록 */}
              {activeCols.length > 0 && (
                <ColDropIndicator
                  active={false}
                  onResizeStart={!dragColId ? (e) => startResize(e, activeCols[activeCols.length - 1].id) : undefined}
                  isResizing={resizingCol === activeCols[activeCols.length - 1].id}
                />
              )}
            </div>
          </div>

          {topLevelFiltered.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-10 w-10" />}
              title={t(hasFilter ? "empty.table.titleFiltered" : "empty.table.title")}
              description={t(hasFilter ? "empty.table.descriptionFiltered" : "empty.table.description")}
              cta={!hasFilter && !readOnly ? (
                <Button size="sm" onClick={() => setInlineAdding(true)}>
                  {t("empty.table.cta")}
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="py-3">
              {/* liveDisplayOrder: 드래그 중 카드가 목적지로 실시간 이동해 미리보기 제공 */}
              {liveDisplayOrder.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  activeCols={activeCols}
                  states={states}
                  members={members}
                  labels={labels}
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  projectIdentifier={project?.identifier}
                  depth={0}
                  onIssueClick={onIssueClick}
                  categories={projectCategories}
                  sprints={projectSprints}
                  hideCompleted={hideCompleted}
                  selected={selectedIds.has(issue.id)}
                  onToggleSelect={toggleSelect}
                  selectedIds={selectedIds}
                  showId={prefs.showId}
                />
              ))}

              {/* 인라인 이슈 추가 — 리스트 최하단 */}
              {readOnly ? null : inlineAdding ? (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 mb-1.5">
                  <div className="w-5 shrink-0" />
                  <input
                    ref={(el) => { if (el) el.focus({ preventScroll: true }); }}
                    type="text"
                    value={inlineTitle}
                    onChange={(e) => setInlineTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && inlineTitle.trim()) {
                        e.preventDefault();
                        inlineCreateMutation.mutate(inlineTitle.trim());
                      }
                      if (e.key === "Escape") {
                        setInlineAdding(false);
                        setInlineTitle("");
                      }
                    }}
                    onBlur={() => {
                      if (inlineTitle.trim()) {
                        inlineCreateMutation.mutate(inlineTitle.trim());
                      } else {
                        setInlineAdding(false);
                        setInlineTitle("");
                      }
                    }}
                    placeholder={t("issues.table.quickAddPlaceholder")}
                    autoComplete="off"
                    className="flex-1 min-w-0 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground/50"
                  />
                  <span className="text-xs text-muted-foreground/60 shrink-0">
                    {t("issues.table.pressEnterToAdd")}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setInlineAdding(true);
                    /* 이중 RAF: 첫 번째는 state 적용, 두 번째는 inline add 가 실제로 그려진 뒤
                       scrollHeight 가 갱신된 시점에 스크롤. 단발 RAF 만 쓰면 옛 height 로 스크롤되어
                       새 입력창이 화면 밖으로 빠짐. */
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                    }));
                  }}
                  className="w-full flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-xs font-medium text-muted-foreground/50 hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all duration-fast mb-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("views.addIssue")}
                </button>
              )}

              {/* 하단 드롭 영역 — 하위 이슈를 여기로 드래그하면 최상위로 승격 */}
              {dragId && (
                <div
                  className={cn(
                    "flex items-center justify-center rounded-xl border-2 border-dashed py-4 mt-2 transition-colors",
                    dropTarget === "__root__"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground/40"
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropTarget("__root__");
                    setDropZone("after");
                  }}
                  onDragLeave={() => {
                    if (dropTarget === "__root__") {
                      setDropTarget(null);
                      setDropZone(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = dragIdRef.current;
                    const oldParentId = dragParentRef.current;
                    clearDrag();
                    if (!id || !oldParentId) return; // 이미 최상위면 무시
                    issuesApi.update(workspaceSlug, projectId, id, { parent: null }).then(() => {
                      qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId, issueFilter] });
                      qc.invalidateQueries({ queryKey: ["sub-issues", oldParentId] });
                      qc.invalidateQueries({ queryKey: ["my-issues", workspaceSlug] });
                    });
                  }}
                >
                  <span className="text-xs font-medium">{t("issues.table.dropToRoot")}</span>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
    {selectedIds.size > 0 && (
      <BulkToolbar
        selectedCount={selectedIds.size}
        states={states}
        members={members}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        selectedIds={Array.from(selectedIds)}
        allIssues={issues}
        onDone={() => setSelectedIds(new Set())}
      />
    )}
    </RelHighlightContext.Provider>
    </RowDragContext.Provider>
  );
}

function BulkToolbar({
  selectedCount, states, members, workspaceSlug, projectId, selectedIds, onDone, allIssues,
}: {
  selectedCount: number;
  states: State[];
  members: WorkspaceMember[];
  workspaceSlug: string;
  projectId: string;
  selectedIds: string[];
  onDone: () => void;
  allIssues: Issue[];
}) {
  const { t } = useTranslation();
  const { perms } = useProjectPerms();
  const qc = useQueryClient();
  const pushUndo = useUndoStore((s) => s.push);

  const bulkUpdateMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) => {
      /* undo용으로 변경 직전 값을 캡처 — 키별로 각 이슈의 이전 값을 저장 */
      const previousByIssue: Record<string, Record<string, unknown>> = {};
      for (const id of selectedIds) {
        const issue = allIssues.find((i) => i.id === id);
        if (!issue) continue;
        const prev: Record<string, unknown> = {};
        for (const key of Object.keys(updates)) {
          prev[key] = (issue as unknown as Record<string, unknown>)[key];
        }
        previousByIssue[id] = prev;
      }
      return issuesApi.bulkUpdate(workspaceSlug, projectId, selectedIds, updates).then(() => previousByIssue);
    },
    onSuccess: async (previousByIssue) => {
      // 선택된 이슈의 sub-issues 캐시도 함께 무효화 (담당자/상태 등 부모 변경 시 트리에서도 반영)
      selectedIds.forEach((id) => qc.invalidateQueries({ queryKey: ["sub-issues", id] }));
      // 화면이 보고 있는 active 쿼리를 강제 refetch 후 await — 셀렉션 해제 전 데이터 갱신 보장
      await Promise.all([
        qc.refetchQueries({ queryKey: ["issues", workspaceSlug, projectId], type: "active" }),
        qc.refetchQueries({ queryKey: ["my-issues", workspaceSlug], type: "active" }),
      ]);
      /* undo: 각 이슈에 대해 이전 값으로 복구하는 PATCH 호출 */
      pushUndo({
        label: t("issues.bulk.updated", { count: selectedCount }),
        undo: async () => {
          await Promise.all(
            Object.entries(previousByIssue).map(([id, prev]) =>
              issuesApi.update(workspaceSlug, projectId, id, prev as Partial<Issue>)
            )
          );
          await qc.refetchQueries({ queryKey: ["issues", workspaceSlug, projectId], type: "active" });
        },
      });
      toast.success(t("issues.bulk.updated", { count: selectedCount }));
      onDone();
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => {
      const idsCopy = [...selectedIds];
      return issuesApi.bulkDelete(workspaceSlug, projectId, selectedIds).then(() => idsCopy);
    },
    onSuccess: async (deletedIds) => {
      selectedIds.forEach((id) => qc.invalidateQueries({ queryKey: ["sub-issues", id] }));
      await Promise.all([
        qc.refetchQueries({ queryKey: ["issues", workspaceSlug, projectId], type: "active" }),
        qc.refetchQueries({ queryKey: ["my-issues", workspaceSlug], type: "active" }),
      ]);
      /* undo: 삭제된 각 이슈를 restore */
      pushUndo({
        label: t("issues.bulk.deleted", { count: selectedCount }),
        undo: async () => {
          await Promise.all(deletedIds.map((id) => issuesApi.restore(workspaceSlug, projectId, id)));
          await qc.refetchQueries({ queryKey: ["issues", workspaceSlug, projectId], type: "active" });
        },
      });
      toast.success(t("issues.bulk.deleted", { count: selectedCount }));
      onDone();
    },
  });

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-2xl border border-border glass px-5 py-3 shadow-2xl" style={{ zIndex: Z_MODAL }}>
      <span className="text-sm font-semibold text-primary">
        {t("issues.bulk.selected", { count: selectedCount })}
      </span>

      <div className="h-5 w-px bg-border" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs gap-1.5">
            {t("issues.bulk.changeState")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {states.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onClick={() => bulkUpdateMutation.mutate({ state: s.id })}
              className="text-xs gap-2"
            >
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              {s.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs gap-1.5">
            {t("issues.bulk.changePriority")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {(["urgent", "high", "medium", "low", "none"] as const).map((p) => (
            <DropdownMenuItem
              key={p}
              onClick={() => bulkUpdateMutation.mutate({ priority: p })}
              className="text-xs"
            >
              {t(`issues.priority.${p}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs gap-1.5">
            {t("issues.bulk.changeAssignee")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {members.map((m) => (
            <DropdownMenuItem
              key={m.member.id}
              onClick={() => bulkUpdateMutation.mutate({ assignees: [m.member.id] })}
              className="text-xs gap-2"
            >
              <AvatarInitials name={m.member.display_name} avatar={m.member.avatar} size="xs" />
              {m.member.display_name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {perms.can_delete && (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-destructive hover:text-destructive"
          onClick={() => {
            if (window.confirm(t("issues.bulk.deleteConfirm", { count: selectedCount }))) {
              bulkDeleteMutation.mutate();
            }
          }}
        >
          {t("issues.bulk.delete")}
        </Button>
      )}

      <div className="h-5 w-px bg-border" />

      <Button variant="ghost" size="sm" className="text-xs" onClick={onDone}>
        {t("issues.bulk.deselect")}
      </Button>
    </div>
  );
}

interface IssueCardProps {
  issue:              Issue;
  activeCols:         ColDef[];
  states:             State[];
  members:            WorkspaceMember[];
  labels:             Label[];
  workspaceSlug:      string;
  projectId:          string;
  projectIdentifier?: string;
  depth:              number;
  onIssueClick:       (id: string) => void;
  /* 인라인 picker용 전체 목록 */
  categories:         Category[];
  sprints:            Sprint[];
  /* 완료된 하위 이슈 숨김 (상위 필터바 토글과 연동, 하위 이슈도 독립적으로 필터링) */
  hideCompleted:      boolean;
  /* 벌크 선택 */
  selected?:          boolean;
  onToggleSelect?:    (id: string, shiftKey: boolean) => void;
  selectedIds?:       Set<string>;
  showId?:            boolean;
}

function IssueCard({
  issue, activeCols, states, members, labels,
  workspaceSlug, projectId, projectIdentifier, depth, onIssueClick,
  categories, sprints, hideCompleted, selected, onToggleSelect, selectedIds,
  showId = true,
}: IssueCardProps) {
  const { t } = useTranslation();
  const { perms } = useProjectPerms();
  const { refresh, refreshWithArchive, refreshIssue } = useIssueRefresh(workspaceSlug, projectId);

  /* ── 컨텍스트에서 DnD 상태·핸들러 수신 ── */
  const { dragId, nestTargetId, dropTarget, dropZone, onDragStart, onDragOver, onDragEnd, onDrop } =
    useContext(RowDragContext);
  const isDragging   = dragId      === issue.id;
  const isNestTarget = nestTargetId === issue.id;

  /* ── 관계 강조 모드: 포커스 이슈와 연결되지 않은 이슈는 dim, 연결된 이슈는 ring ── */
  const { connectedSet, depthMap, focusIssueId } = useContext(RelHighlightContext);
  const isRelHighlightActive = connectedSet != null;
  const isDimmed = isRelHighlightActive && !connectedSet!.has(issue.id);
  const isFocused = isRelHighlightActive && focusIssueId === issue.id;
  const connectedDepth = depthMap?.get(issue.id);
  const isDirectConnected = isRelHighlightActive && !isFocused && connectedDepth === 1;
  const isIndirectConnected = isRelHighlightActive && !isFocused && connectedDepth === 2;

  /* ── 확장/접기 ── */
  const [expanded,      setExpanded]      = useState(false);
  const [addingChild,   setAddingChild]   = useState(false);
  const [childTitle,    setChildTitle]    = useState("");
  const [subDialogOpen, setSubDialogOpen] = useState(false);

  const hasChildren = issue.sub_issues_count > 0;

  /* ── 하위 이슈 fetch (expanded 또는 addingChild 시) ── */
  const { data: rawSubIssues = [] } = useQuery({
    queryKey: ["sub-issues", issue.id],
    queryFn:  () => issuesApi.subIssues.list(workspaceSlug, projectId, issue.id),
    enabled:  expanded,
  });
  
  const subIssues = useMemo(() => {
    const sorted = [...rawSubIssues].sort((a, b) => a.sort_order - b.sort_order || a.sequence_id - b.sequence_id);
    /* 완료 항목 숨김 — 상위 이슈와 독립적으로 하위 이슈 단위로 필터링 */
    if (!hideCompleted) return sorted;
    return sorted.filter((s) => {
      const g = s.state_detail?.group;
      return g !== "completed" && g !== "cancelled";
    });
  }, [rawSubIssues, hideCompleted]);

  /* 하위 이슈 레벨 live 미리보기 */
  const liveSubOrder = useMemo(() => {
    if (!dragId || !dropTarget || !dropZone || dropZone === "nest") return subIssues;
    const fromIdx = subIssues.findIndex((i) => i.id === dragId);
    const toIdx   = subIssues.findIndex((i) => i.id === dropTarget);
    if (fromIdx === -1 || toIdx === -1) return subIssues;
    let insertIdx = dropZone === "before" ? toIdx : toIdx + 1;
    const newArr  = [...subIssues];
    const [moved] = newArr.splice(fromIdx, 1);
    if (fromIdx < insertIdx) insertIdx--;
    newArr.splice(insertIdx, 0, moved);
    return newArr;
  }, [dragId, dropTarget, dropZone, subIssues]);

  /* ── 인라인 하위 이슈 생성 ── */
  const createSubMutation = useMutation({
    mutationFn: (title: string) =>
      issuesApi.subIssues.create(workspaceSlug, projectId, issue.id, {
        title, state: issue.state, priority: "medium",
        ...(issue.category ? { category: issue.category } : {}),
        ...(issue.sprint  ? { sprint:  issue.sprint }  : {}),
      }),
    onSuccess: () => {
      // 스크롤 위치 보존 — 리패치 후에도 현재 보고 있는 곳 유지
      const scrollEl = document.querySelector("[data-scroll-container]");
      const savedTop = scrollEl?.scrollTop ?? 0;

      refresh(issue.id);

      // 입력 즉시 닫기 — 하나 생성하면 완료
      setChildTitle("");
      setAddingChild(false);

      // 다음 프레임에 스크롤 복원
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = savedTop;
      });
    },
  });

  /* ── 자기 자신 인라인 업데이트 — undo 스택에 자동 등록 ── */
  const pushUndo = useUndoStore((s) => s.push);
  const updateMutation = useMutation({
    mutationFn: (data: Partial<Issue>) =>
      issuesApi.update(workspaceSlug, projectId, issue.id, data),
    onMutate: (data) => {
      /* 변경 직전 값을 캡처해서 undo 콜백에 사용 */
      const previous: Partial<Issue> = {};
      for (const key of Object.keys(data) as (keyof Issue)[]) {
        (previous as Record<string, unknown>)[key] = (issue as unknown as Record<string, unknown>)[key];
      }
      return { previous };
    },
    onSuccess: (_d, _v, ctx) => {
      refreshIssue(issue.id);
      refresh(issue.parent);
      /* undo 스택 등록 — 이전 값으로 되돌리는 PATCH 호출 */
      if (ctx?.previous) {
        const previous = ctx.previous;
        pushUndo({
          label: `${issue.title}`,
          undo: async () => {
            await issuesApi.update(workspaceSlug, projectId, issue.id, previous);
            refreshIssue(issue.id);
            refresh(issue.parent);
          },
        });
      }
    },
  });

  /* ── 이슈 복사 (딥카피 — 하위 이슈 포함) ── */
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    issuesApi.duplicate(workspaceSlug, projectId, issue.id).then(() => {
      refresh(issue.parent);
      toast.success(t("issues.table.copied"));
    });
  };

  /* ── 이슈 보관 ── */
  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    issuesApi.archive(workspaceSlug, projectId, issue.id).then(() => {
      refreshWithArchive(issue.parent);
      toast.success(t("issues.table.archived"));
    });
  };

  /* ── 이슈 삭제 (소프트 삭제 + 되돌리기 토스트) ── */
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log("[DELETE] triggered for:", issue.id, issue.title);

    issuesApi.delete(workspaceSlug, projectId, issue.id)
      .then(() => {
        console.log("[DELETE] success, invalidating...");
        refresh(issue.parent);
      })
      .then(() => console.log("[DELETE] invalidation done"))
      .catch((err) => console.error("[DELETE] error:", err));

    // 되돌리기 토스트 (8초 유지)
    toast(t("issues.table.deleted"), {
      duration: 8000,
      description: issue.sub_issues_count > 0
        ? t("issues.table.deletedWithChildren", { count: issue.sub_issues_count })
        : undefined,
      action: {
        label: t("issues.table.undo"),
        onClick: () => {
          issuesApi.restore(workspaceSlug, projectId, issue.id).then(() => {
            refresh(issue.parent);
          });
        },
      },
    });
  };

  const indent = depth * 28;

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const cellContent = (col: ColDef): React.ReactNode => {
    switch (col.id) {

      case "state":
        // 필드(Field) — 상태 없음. 그래프 뷰와 동일한 라벤더(violet) 칩으로 표시.
        if (issue.is_field) {
          return (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-300">
              <Layers className="h-3 w-3" />
              {t("issues.table.fieldLabel", "필드")}
            </span>
          );
        }
        return (
          <StatePicker
            states={states}
            currentStateId={issue.state}
            currentState={issue.state_detail}
            onChange={(id) => updateMutation.mutate({ state: id })}
          />
        );

      case "priority":
        return (
          <PriorityPicker
            currentPriority={issue.priority}
            onChange={(p) => updateMutation.mutate({ priority: p })}
          />
        );

      case "assignee":
        return (
          <AssigneePicker
            members={members}
            currentIds={issue.assignees}
            currentDetails={issue.assignee_details}
            onChange={(ids) => updateMutation.mutate({ assignees: ids })}
          />
        );

      case "startDate":
        return (
          <DatePicker
            value={issue.start_date}
            onChange={(v) => updateMutation.mutate({ start_date: v })}
            placeholder={t("views.timeline.startDate")}
            hintDate={issue.due_date}
            hintMode="after"
          />
        );

      case "dueDate": {
        const stateGroup = issue.state_detail?.group;
        const isActiveState = stateGroup === "started" || stateGroup === "unstarted";
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const due   = issue.due_date ? new Date(issue.due_date) : null;
        if (due) due.setHours(0, 0, 0, 0);
        const diff  = due ? Math.ceil((due.getTime() - today.getTime()) / 86_400_000) : null;
        const overdueClass = (!isActiveState || diff === null) ? "" : diff < 0 ? "text-red-500" : diff <= 3 ? "text-orange-400" : "text-muted-foreground";
        return (
          <DatePicker
            value={issue.due_date}
            onChange={(v) => updateMutation.mutate({ due_date: v })}
            placeholder={t("views.timeline.dueDate")}
            overdueClass={overdueClass}
            hintDate={issue.start_date}
            hintMode="before"
          />
        );
      }

      case "label":
        return (
          <LabelPicker
            labels={labels}
            currentIds={issue.label}
            currentDetails={issue.label_details}
            onChange={(ids) => updateMutation.mutate({ label: ids })}
          />
        );

      case "subIssues":
        return hasChildren ? (
          <button
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg hover:bg-muted/40 transition-colors w-full text-foreground"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          >
            <GitBranch className="h-3 w-3" />{issue.sub_issues_count}
          </button>
        ) : (
          <span className="text-muted-foreground/30 text-xs px-2">—</span>
        );

      case "links":
        return (
          <div className={cn("flex items-center gap-1.5 px-2 text-xs", (issue.link_count ?? 0) > 0 ? "text-foreground" : "text-muted-foreground/30")}>
            {(issue.link_count ?? 0) > 0 && <Link2 className="h-3 w-3" />}
            {(issue.link_count ?? 0) > 0 ? issue.link_count : "—"}
          </div>
        );

      case "category":
        return (
          <CategoryPicker
            categories={categories}
            currentId={issue.category}
            onChange={(id) => updateMutation.mutate({ category: id })}
          />
        );

      case "sprint":
        return (
          <SprintPicker
            sprints={sprints}
            currentId={issue.sprint}
            onChange={(id) => updateMutation.mutate({ sprint: id })}
          />
        );

      case "createdAt":
        return issue.created_at ? (
          <span className="text-xs text-muted-foreground tabular-nums truncate" title={new Date(issue.created_at).toLocaleString()}>
            {formatDate(issue.created_at)}
          </span>
        ) : null;

      case "updatedAt":
        return issue.updated_at ? (
          <span className="text-xs text-muted-foreground tabular-nums truncate" title={new Date(issue.updated_at).toLocaleString()}>
            {formatDate(issue.updated_at)}
          </span>
        ) : null;

      default: return null;
    }
  };

  // Phase 3.4 — 5초 strip 표시 selector
  const isRecent = useRecentChangesStore((s) => !!s.recent[issue.id]);
  const recentColor = useRecentChangesStore((s) => s.recent[issue.id]?.color);

  return (
    <div>
      <div
        draggable={true}
        data-recently-changed={isRecent ? "true" : undefined}
        style={isRecent && recentColor ? ({ ["--recent-color" as never]: recentColor } as React.CSSProperties) : undefined}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData("text/plain", `issue-${issue.id}`);
          e.dataTransfer.effectAllowed = "move";
          onDragStart(issue);
        }}
        onDragOver={(e) => {
          e.preventDefault(); e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const relY = (e.clientY - rect.top) / rect.height;
          // 상단 30% → before, 하단 30% → after, 중간 40% → nest
          // 모든 depth에서 nest 허용 (순환 참조는 handleDrop에서 검증)
          const zone: "before" | "after" | "nest" =
            relY < 0.30 ? "before" : relY > 0.70 ? "after" : "nest";
          onDragOver(e, issue, zone);
        }}
        onDragEnd={(e) => { e.stopPropagation(); onDragEnd(); }}
        onDrop={(e) => { e.stopPropagation(); onDrop(issue); }}
        className={cn(
          // transition: 드래그 중 liveDisplayOrder로 카드 순서가 바뀔 때 부드럽게 이동
          "relative flex items-center gap-3 bg-card rounded-xl border border-border shadow-sm px-4 py-3 group mb-1.5 transition-[opacity,transform,box-shadow,filter] duration-base",
          // 하위 이슈 시각 구분 — depth별 좌측 보더 색상 차별화
          depth === 1 && "border-l-[3px] border-l-primary/40 bg-card/90",
          depth === 2 && "border-l-[3px] border-l-blue-400/40 bg-card/80",
          depth >= 3 && "border-l-[3px] border-l-violet-400/40 bg-card/70",
          isDragging
            ? "opacity-30 border-dashed border-primary/60 bg-primary/[0.03] shadow-none scale-[0.99]"
            : isNestTarget
              // 어느 깊이의 카드든 동일한 nest 하이라이트 — 상위/하위 구분 없이 통일
              ? "ring-2 ring-primary border-primary/50 bg-primary/[0.03] shadow-[0_0_0_4px_hsl(var(--primary)/0.08)]"
              : "hover:ring-1 hover:ring-border/40 hover:shadow-md hover:border-border",
          !isDragging && "cursor-grab active:cursor-grabbing",
          // 관계 강조 모드 — 비연결 이슈 dim, 포커스 이슈 primary ring, 연결 이슈 amber ring
          isDimmed && "opacity-30 saturate-50",
          isFocused && "ring-2 ring-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]",
          isDirectConnected && "ring-1 ring-amber-400/80 shadow-[0_0_0_3px_rgba(251,191,36,0.15)]",
          isIndirectConnected && "ring-1 ring-amber-400/40 shadow-[0_0_0_2px_rgba(251,191,36,0.06)]",
        )}
      >
        {/* 드롭 인디케이터 — 트리 깊이 시각화. 좌측 offset 이 depth 를 반영해 어느 계층에 편입되는지 한눈에.
            depth 0(최상위) = left 16px, depth 1 = 38px, depth 2 = 60px...  (22px per level)
            시작점에 작은 노드 점을 달아 "여기로 분기" 를 더 명확히 표현 */}
        {dropTarget === issue.id && dropZone === "before" && !isDragging && (
          <div
            className="absolute -top-1 right-4 pointer-events-none z-20"
            style={{ left: 16 + depth * 22 }}
          >
            <div className="h-0.5 bg-primary rounded-full" />
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
          </div>
        )}
        {dropTarget === issue.id && dropZone === "after" && !isDragging && (
          <div
            className="absolute -bottom-1 right-4 pointer-events-none z-20"
            style={{ left: 16 + depth * 22 }}
          >
            <div className="h-0.5 bg-primary rounded-full" />
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
          </div>
        )}
        {isNestTarget && (
          <>
            <div className="absolute inset-0 rounded-xl flex items-center justify-center pointer-events-none z-20">
              <span className="text-2xs font-semibold text-primary bg-background px-3 py-1 rounded-full border border-primary/30 shadow-sm">
                ↳ {t("issues.table.nestHere")}
              </span>
            </div>
            {/* 하위 편입 위치 미리보기 — target 의 bottom 에 depth+1 들여쓰기된 라인 */}
            <div
              className="absolute -bottom-1 right-4 pointer-events-none z-20"
              style={{ left: 16 + (depth + 1) * 22 }}
            >
              <div className="h-0.5 bg-primary/60 rounded-full border-dashed" />
              <div className="absolute -left-1 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary/60 ring-2 ring-background" />
            </div>
          </>
        )}
        {onToggleSelect && (
          <span
            onClick={(e) => { e.stopPropagation(); onToggleSelect(issue.id, e.shiftKey); }}
            className="shrink-0"
          >
            <Checkbox checked={!!selected} onChange={() => {}} className="pointer-events-none" />
          </span>
        )}

        {showId && (
          <>
            <div
              className="shrink-0 flex items-center truncate overflow-hidden"
              style={{ width: "var(--col-w-_id)", minWidth: "var(--col-w-_id)" }}
            >
              {/* Phase 3.3 — IssueDetailPage의 issueRef와 같은 layoutId. 모달 열림 시 자연 이어짐 */}
              <motion.span
                layoutId={`issue-ref-${issue.id}`}
                className="font-mono text-xs font-semibold text-muted-foreground/70 truncate"
              >
                {projectIdentifier ? `${projectIdentifier}-${issue.sequence_id}` : `#${issue.sequence_id}`}
              </motion.span>
            </div>

            <div className="w-[10px] self-stretch shrink-0 flex items-center text-transparent">|</div>
          </>
        )}

        {/* 제목 영역 (인덴트를 제목 패딩으로 이동시켜 전체 컬럼 정렬 유지) */}
        <div
          className="flex items-center gap-2 shrink-0 overflow-hidden"
          style={{ width: "var(--col-w-_title)", minWidth: "var(--col-w-_title)", paddingLeft: indent }}
        >
          {/* 확장 토글 / 그립 아이콘 (w-5 고정) */}
          <div className="w-5 h-5 shrink-0 flex items-center justify-center">
          {hasChildren ? (
            <button
              onClick={toggleExpand}
              className="rounded p-0.5 hover:bg-muted/60 transition-colors"
            >
              {expanded
                ? <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              }
            </button>
          ) : (
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/35 transition-colors" />
          )}
        </div>

        <div
          className="flex items-center gap-2 cursor-pointer shrink-0 flex-1 min-w-0"
          onClick={() => onIssueClick(issue.id)}
        >
          <span
            className={cn(
              "text-sm font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1",
              /* Phase 2.2 — cancelled state 이슈는 취소선 표시 */
              issue.state_detail?.group === "cancelled" && "line-through text-muted-foreground",
            )}
          >
            {issue.title}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setAddingChild(true); setExpanded(true); }}
            title={t("issues.table.addSubIssue")}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted/60 shrink-0"
          >
            <Plus className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
        </div>

        {activeCols.map((col) => (
          <Fragment key={col.id}>
            <div className="w-[10px] self-stretch flex items-stretch justify-center shrink-0">
              <div className="w-px bg-border/60 self-stretch" />
            </div>
            <div style={{ width: `var(--col-w-${col.id})`, minWidth: `var(--col-w-${col.id})` }} className="shrink-0 flex flex-col justify-center min-w-0 overflow-hidden">
              {cellContent(col)}
            </div>
          </Fragment>
        ))}

        {/* 작업 ↔ 필드 토글 — 3-dot 메뉴 바로 왼쪽. 테마 토글처럼 현재 상태 아이콘만 보여줌.
            연타 방지: 뮤테이션 진행 중엔 비활성화. */}
        <Tooltip
          content={
            <div className="space-y-1">
              <p className="font-semibold">
                {issue.is_field ? t("issues.table.toField.toIssue") : t("issues.table.toField.toField")}
              </p>
              <p className="opacity-80">
                {issue.is_field ? t("issues.table.toField.toIssueDesc") : t("issues.table.toField.toFieldDesc")}
              </p>
            </div>
          }
        >
          <button
            type="button"
            disabled={updateMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              if (updateMutation.isPending) return;
              updateMutation.mutate({ is_field: !issue.is_field } as any);
            }}
            className="shrink-0 ml-auto opacity-0 group-hover:opacity-100 h-6 w-6 rounded-md flex items-center justify-center hover:bg-muted/60 transition-all disabled:opacity-40 disabled:cursor-wait"
          >
            {issue.is_field
              ? <Layers className="h-3.5 w-3.5 text-violet-500" />
              : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </Tooltip>

        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-6 w-6 rounded-md flex items-center justify-center hover:bg-muted/60 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32 rounded-xl p-1.5" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                className="gap-2 rounded-lg text-xs cursor-pointer"
                onClick={handleCopy}
              >
                <Copy className="h-3.5 w-3.5" />
                {t("issues.table.copy")}
              </DropdownMenuItem>
              {perms.can_archive && (
                <DropdownMenuItem
                  className="gap-2 rounded-lg text-xs cursor-pointer"
                  onClick={handleArchive}
                >
                  <Archive className="h-3.5 w-3.5" />
                  {t("issues.table.archive")}
                </DropdownMenuItem>
              )}
              {perms.can_delete && (
                <DropdownMenuItem
                  className="gap-2 rounded-lg text-xs cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("issues.table.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 인라인 하위 이슈 입력창 — 상위 항목 바로 아래, 기존 하위 이슈 위에 배치 */}
      {addingChild && (
        <div
          style={{ marginLeft: (depth + 1) * 28 }}
          className="mt-1 flex items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5"
        >
          <div className="w-5 shrink-0" />
          <input
            ref={(el) => { if (el) el.focus({ preventScroll: true }); }}
            type="text"
            value={childTitle}
            onChange={(e) => setChildTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && childTitle.trim()) {
                e.preventDefault();
                createSubMutation.mutate(childTitle.trim());
              }
              if (e.key === "Escape") {
                setAddingChild(false);
                setChildTitle("");
              }
            }}
            onBlur={() => {
              if (childTitle.trim()) {
                createSubMutation.mutate(childTitle.trim());
              } else {
                setAddingChild(false);
                setChildTitle("");
              }
            }}
            placeholder={t("issues.table.subIssuePlaceholder")}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground/50"
          />
          <span className="text-xs text-muted-foreground/60 shrink-0">
            {t("issues.table.pressEnterToAdd")}
          </span>
        </div>
      )}

      {expanded && (
        <div className="mt-1 space-y-1">
          {/* liveSubOrder: 하위 이슈도 드래그 중 실시간 순서 미리보기 */}
          {liveSubOrder.map((sub) => (
            <IssueCard
              key={sub.id}
              issue={sub}
              activeCols={activeCols}
              states={states}
              members={members}
              labels={labels}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              projectIdentifier={projectIdentifier}
              depth={depth + 1}
              onIssueClick={onIssueClick}
              categories={categories}
              sprints={sprints}
              hideCompleted={hideCompleted}
              selected={selectedIds?.has(sub.id)}
              onToggleSelect={onToggleSelect}
              selectedIds={selectedIds}
              showId={showId}
            />
          ))}
        </div>
      )}

      <IssueCreateDialog
        open={subDialogOpen}
        onOpenChange={setSubDialogOpen}
        states={states}
        defaultStateId={issue.state}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        parentIssueId={issue.id}
        defaultCategoryId={issue.category ?? undefined}
        defaultSprintId={issue.sprint ?? undefined}
      />
    </div>
  );
}

function SortIndicator({ active, dir }: { active?: boolean; dir?: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity shrink-0" />;
  return dir === "asc"
    ? <ArrowUp className="h-3 w-3 text-primary shrink-0" />
    : <ArrowDown className="h-3 w-3 text-primary shrink-0" />;
}

function ColDropIndicator({
  active,
  onResizeStart,
  isResizing,
}: {
  active:          boolean;
  onResizeStart?:  (e: React.MouseEvent) => void;
  isResizing?:     boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const highlighted = active || hovered || isResizing;
  const canResize   = !!onResizeStart;

  return (
    <div
      className="self-stretch shrink-0 flex items-stretch justify-center"
      style={{ width: 10, cursor: canResize ? "col-resize" : "default", flexShrink: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={onResizeStart}
    >
      <div
        className="self-stretch rounded-full transition-all duration-fast"
        style={{
          width:      highlighted ? 3 : 1,
          opacity:    active || isResizing ? 1 : hovered ? 0.85 : 0.55,
          background: active || isResizing
            ? "hsl(var(--primary))"
            : hovered
              ? "hsl(var(--primary) / 0.7)"
              : "hsl(var(--border))",
          boxShadow: active || isResizing
            ? "0 0 10px 3px hsl(var(--primary) / 0.45)"
            : hovered
              ? "0 0 6px 2px hsl(var(--primary) / 0.25)"
              : "none",
        }}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════
   FilterDropdown
══════════════════════════════════════════════════ */

function FilterDropdown({
  label, emptyLabel, items, selected, onToggle, onClear, variant = "grid",
}: {
  label:      string;
  emptyLabel: string;
  items:      { id: string; label: string; color?: string }[];
  selected:   Set<string>;
  onToggle:   (id: string) => void;
  /** 선택 전체 해제 — 드롭다운 안의 X 버튼에서 호출 */
  onClear?:   () => void;
  /** grid: 토글 버튼 2열 그리드 (클릭해도 팝오버 유지) / checkbox: 체크박스 리스트 (담당자처럼 많을 때) */
  variant?:   "grid" | "checkbox";
}) {
  const count = selected.size;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 border transition-all duration-fast",
            count > 0
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}
        >
          {label}
          {count > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center text-2xs font-bold">
              {count}
            </span>
          )}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn("rounded-xl p-2", variant === "grid" ? "w-64" : "w-44 p-1.5")}
      >
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-1.5">{emptyLabel}</p>
        ) : variant === "grid" ? (
          /* 버튼 그리드 — 토글해도 팝오버 유지 (preventDefault) */
          <div className="grid grid-cols-2 gap-1">
            {items.map((item) => {
              const active = selected.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={(e) => { e.preventDefault(); onToggle(item.id); }}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md border transition-all text-left",
                    active
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "text-muted-foreground border-border hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  {item.color && (
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: item.color }} />
                  )}
                  <span className="truncate flex-1">{item.label}</span>
                  {active && <Check className="h-3 w-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        ) : (
          /* 체크박스 리스트 — 담당자처럼 많을 때 */
          items.map((item) => (
            <DropdownMenuCheckboxItem
              key={item.id}
              checked={selected.has(item.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onToggle(item.id)}
              className="text-xs gap-2 rounded-lg"
            >
              {item.color && (
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: item.color }} />
              )}
              {item.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
        {/* 선택 해제 — 드롭다운 맨 아래. 아이템 위치가 바뀌지 않도록 하단 고정 */}
        {count > 0 && onClear && (
          <>
            <div className="h-px bg-border/50 my-1.5" />
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onClear(); }}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-2xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-md transition-colors"
            >
              <X className="h-3 w-3" />
              <span>선택 해제 ({count})</span>
            </button>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

