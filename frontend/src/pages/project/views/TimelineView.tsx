/**
 * Timeline 뷰 — Google-style Modern Gantt 차트
 *
 * 디자인:
 *  - 날짜 헤더: 두 레벨(월 + 일/주/월), glass 배경, primary-tinted 월 레이블
 *  - 이슈 행: 교번 배경(even/odd), hover tint
 *  - 간트 바: 솔리드 컬러, 85% 불투명, 6px radius, 내부 shadow
 *  - 오늘 선: 2px 너비, 10px 원형 헤드 + glow
 *  - 왼쪽 컬럼: 그룹 행 4px 왼쪽 보더, 이슈 제목 text-sm
 *  - 설정 패널: 기존 글라스 스타일 유지
 */

import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useIssueRefresh } from "@/hooks/useIssueMutations";
import { useTranslation } from "react-i18next";
import { Settings2, ChevronDown, Plus, ChevronRight } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { StatePicker } from "@/components/issues/state-picker";
import { AssigneePicker } from "@/components/issues/assignee-picker";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { cn } from "@/lib/utils";
import { Z_SETTINGS_OVERLAY, Z_SETTINGS_PANEL } from "@/constants/z-index";
import type { TimelineSettings } from "@/hooks/useViewSettings";
import type { Issue, State, ProjectEvent } from "@/types";
import { EVENT_TYPES } from "@/constants/event-types";
import { toast } from "sonner";
function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay());
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

interface Column {
  start:     Date;
  end:       Date;
  label:     string;
  dayOffset: number;
  days:      number;
}

// 업데이트된 컬럼 너비 — 더 넓게
const COL_WIDTH: Record<TimelineSettings["scale"], number> = {
  day:   52,   // 이전: 44
  week:  110,  // 이전: 88
  month: 150,  // 이전: 132
};

const MONTH_KEYS = ["calendar.jan","calendar.feb","calendar.mar","calendar.apr","calendar.may","calendar.jun","calendar.jul","calendar.aug","calendar.sep","calendar.oct","calendar.nov","calendar.dec"] as const;

/** 컬럼 경계선 스타일 — 주/월 경계를 짙게, 일반 컬럼은 기본
 *  firstDow: 주 시작 요일 (0=일요일, 1=월요일) */
function getColBorderRight(col: Column, nextCol: Column | undefined, scale: TimelineSettings["scale"], isToday: boolean, firstDow: number = 0): string {
  if (isToday) return "1px solid hsl(var(--primary) / 0.25)";
  if (!nextCol) return "1px solid hsl(var(--border))";
  if (scale === "day") {
    /* 다음 컬럼이 주 시작 요일이면 주 경계 */
    if (nextCol.start.getDay() === firstDow) return "2px solid hsl(var(--border))";
  } else if (scale === "week") {
    /* 다음 컬럼이 다른 월이면 월 경계 */
    if (nextCol.start.getMonth() !== col.start.getMonth()) return "2px solid hsl(var(--border))";
  }
  return "1px solid hsl(var(--border))";
}

function buildColumns(rangeStart: Date, rangeEnd: Date, scale: TimelineSettings["scale"], tMonth: (idx: number) => string, hideWeekends: boolean = false): Column[] {
  const cols: Column[] = [];

  if (scale === "day") {
    let cur = new Date(rangeStart);
    while (cur <= rangeEnd) {
      const dow = cur.getDay();
      const isWeekend = dow === 0 || dow === 6;
      if (!(hideWeekends && isWeekend)) {
        cols.push({
          start:     new Date(cur),
          end:       new Date(cur),
          label:     String(cur.getDate()),
          dayOffset: diffDays(rangeStart, cur),
          days:      1,
        });
      }
      cur = addDays(cur, 1);
    }
  } else if (scale === "week") {
    let cur = startOfWeek(rangeStart);
    while (cur <= rangeEnd) {
      const wEnd = addDays(cur, 6);
      cols.push({
        start:     new Date(cur),
        end:       new Date(wEnd),
        label:     `${cur.getMonth()+1}/${cur.getDate()}`,
        dayOffset: Math.max(diffDays(rangeStart, cur), 0),
        days:      7,
      });
      cur = addDays(cur, 7);
    }
  } else {
    let cur = startOfMonth(rangeStart);
    while (cur <= rangeEnd) {
      const mEnd = endOfMonth(cur);
      const days = diffDays(cur, mEnd) + 1;
      cols.push({
        start:    new Date(cur),
        end:      new Date(mEnd),
        label:    `${tMonth(cur.getMonth())} ${cur.getFullYear()}`,
        dayOffset: Math.max(diffDays(rangeStart, cur), 0),
        days,
      });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  }

  return cols;
}

/* 좌측 다중 컬럼 기본 너비 — 사용자가 드래그로 조절 가능 (세션 동안만) */
const DEFAULT_COL_WIDTHS = { issue: 260, state: 100, assignee: 100 };
const COL_MIN = { issue: 140, state: 60, assignee: 60 };
const COL_MAX = { issue: 500, state: 220, assignee: 220 };
const ROW_H  = 48;  // px — 행 높이
const HDR_H  = 60;  // px — 날짜 헤더 (상단 28px 월 / 하단 32px 날짜)

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#ef4444", high: "#f97316", medium: "#eab308", low: "#60a5fa", none: "#9ca3af",
};

function SettingsPanel({
  settings, onChange, onClose, triggerRef,
}: {
  settings: TimelineSettings;
  onChange:  (s: Partial<TimelineSettings>) => void;
  onClose:   () => void;
  triggerRef: React.RefObject<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  /* trigger 버튼 좌표 기반 fixed 위치 계산 — containing block 완전 탈출 */
  const rect = triggerRef.current?.getBoundingClientRect();
  const panelW = 280;
  const top = rect ? rect.bottom + 4 : 0;
  const left = rect ? Math.min(rect.right - panelW, window.innerWidth - panelW - 8) : 0;

  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: Z_SETTINGS_OVERLAY }} onClick={onClose} />
      <div
        className="fixed w-[280px] rounded-2xl border border-border shadow-2xl p-4 space-y-4 text-sm"
        style={{
          top, left, zIndex: Z_SETTINGS_PANEL,
          background: "var(--glass-bg)",
          boxShadow: "var(--glass-shadow)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">
          {t("views.timeline.settingsTitle")}
        </p>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground/60 font-medium">{t("views.timeline.columnScale")}</p>
          <div className="flex gap-1.5">
            {(["day","week","month"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onChange({ scale: s })}
                className={cn(
                  "flex-1 text-xs py-1.5 rounded-xl border transition-all duration-150 font-medium",
                  settings.scale === s
                    ? "bg-primary text-primary-foreground border-primary shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border-border"
                )}
              >
                {{ day: t("views.timeline.scaleDay"), week: t("views.timeline.scaleWeek"), month: t("views.timeline.scaleMonth") }[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground/60 font-medium">{t("views.timeline.groupBy")}</p>
          <div className="flex gap-1.5 flex-wrap">
            {(["none","state","priority","category","sprint"] as const).map((g) => (
              <button
                key={g}
                onClick={() => onChange({ groupBy: g })}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-xl border transition-all duration-150 font-medium",
                  settings.groupBy === g
                    ? "bg-primary text-primary-foreground border-primary shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border-border"
                )}
              >
                {{
                  none: t("views.timeline.groupNone"),
                  state: t("views.timeline.groupState"),
                  priority: t("views.timeline.groupPriority"),
                  category: t("views.timeline.groupModule"),
                  sprint: t("views.timeline.groupCycle"),
                }[g]}
              </button>
            ))}
          </div>
        </div>

        {[
          { key: "showCompleted" as const, label: t("views.timeline.showCompleted") },
          { key: "showNoDate"    as const, label: t("views.timeline.showNoDate") },
          { key: "hideWeekends"  as const, label: t("views.timeline.hideWeekends") },
          { key: "showEvents"    as const, label: t("views.timeline.showEvents") },
        ].map(({ key, label }) => (
          <label key={key} className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => onChange({ [key]: !settings[key] })}
              className={cn(
                "h-5 w-9 rounded-full border transition-all duration-200 flex items-center px-0.5",
                settings[key]
                  ? "bg-primary border-primary"
                  : "bg-muted/40 border-border group-hover:border-border"
              )}
            >
              <div className={cn(
                "h-4 w-4 rounded-full shadow-sm transition-all duration-200",
                settings[key]
                  ? "translate-x-4 bg-primary-foreground"
                  : "translate-x-0 bg-muted-foreground/60"
              )} />
            </div>
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              {label}
            </span>
          </label>
        ))}
      </div>
    </>,
    document.body,
  );
}

interface Props {
  workspaceSlug:    string;
  projectId:        string;
  onIssueClick:     (issueId: string) => void;
  issueFilter?:     { sprint?: string; category?: string };
  settings:         TimelineSettings;
  onSettingsChange: (s: Partial<TimelineSettings>) => void;
}

export function TimelineView({ workspaceSlug, projectId, onIssueClick, issueFilter, settings, onSettingsChange }: Props) {
  const { t } = useTranslation();
  const { refresh } = useIssueRefresh(workspaceSlug, projectId);
  const firstDow = useAuthStore((s) => s.user?.first_day_of_week ?? 0); // 0=일요일, 1=월요일
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const scrollRef       = useRef<HTMLDivElement>(null);
  const savedScrollLeft = useRef<number>(0);
  const didScrollToday  = useRef(false); // 초기 마운트 시 오늘 날짜로 한 번만 스크롤
  /* 스케일 변경 전 화면 중앙 날짜 — 변경 후 동일 날짜로 스크롤 복원 */
  const pendingCenterDate = useRef<Date | null>(null);

  /* ── 빈 영역 pan drag 상태 ── */
  const panRef = useRef<{ startX: number; scrollLeft: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  /* 타임라인은 하위 이슈까지 fetch — 시각적 계층 트리를 그리기 위함 */
  const { data: issues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, issueFilter, "with-sub"],
    queryFn:  async () => {
      const { api } = await import("@/lib/axios");
      /* params 대신 URL에 직접 쿼리 스트링 붙이기 — axios params 변환 이슈 회피 */
      const qs = new URLSearchParams({ ...issueFilter, include_sub_issues: "true" } as Record<string, string>).toString();
      const res = await api.get(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/?${qs}`);
      return (res.data.results ?? res.data) as Issue[];
    },
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn:  () => projectsApi.states.list(workspaceSlug, projectId),
  });

  /* 캘린더와 공유: 프로젝트 이벤트 — settings.showEvents 활성 시 타임라인 상단에 별도 그룹으로 표시 */
  const { data: events = [] } = useQuery({
    queryKey: ["events", workspaceSlug, projectId],
    queryFn:  () => projectsApi.events.list(workspaceSlug, projectId),
    enabled:  !!settings.showEvents,
  });

  /* 카테고리/스프린트 — 이슈 행 배지 + groupBy "category"/"sprint" 옵션용 */
  const { data: projectCategories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, projectId],
    queryFn:  () => projectsApi.categories.list(workspaceSlug, projectId),
  });
  const { data: projectSprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn:  () => projectsApi.sprints.list(workspaceSlug, projectId),
  });
  const categoryMap = useMemo(
    () => new Map(projectCategories.map((m) => [m.id, m.name])),
    [projectCategories],
  );
  const sprintMap = useMemo(
    () => new Map(projectSprints.map((c) => [c.id, c.name])),
    [projectSprints],
  );

  /* 날짜 인라인 수정 뮤테이션 */
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Issue> }) =>
      issuesApi.update(workspaceSlug, projectId, id, data),
    onMutate: () => {
      // 드래그 완료 순간의 스크롤 위치를 저장해둠
      if (scrollRef.current) savedScrollLeft.current = scrollRef.current.scrollLeft;
    },
    onSuccess: () => {
      refresh();
      // refresh 후 rangeStart/rangeEnd가 재계산되어 DOM이 바뀌기 전까지
      // 두 프레임을 기다린 뒤 스크롤 위치를 복원 (double rAF 패턴)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollLeft = savedScrollLeft.current;
        });
      });
    },
  });

  const completedIds = useMemo(
    () => new Set(states.filter((s) => s.group === "completed" || s.group === "cancelled").map((s) => s.id)),
    [states]
  );

  const stateMap = useMemo(() => Object.fromEntries(states.map((s) => [s.id, s])), [states]);

  /* 좌측 서브컬럼 너비 (리사이즈 가능, localStorage 저장) */
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = localStorage.getItem("orbitail_timeline_col_widths");
      if (saved) {
        const parsed = JSON.parse(saved);
        /* min/max 범위 검증 후 사용 */
        if (typeof parsed.issue === "number" && typeof parsed.state === "number" && typeof parsed.assignee === "number") {
          return {
            issue: Math.max(COL_MIN.issue, Math.min(COL_MAX.issue, parsed.issue)),
            state: Math.max(COL_MIN.state, Math.min(COL_MAX.state, parsed.state)),
            assignee: Math.max(COL_MIN.assignee, Math.min(COL_MAX.assignee, parsed.assignee)),
          };
        }
      }
    } catch {}
    return DEFAULT_COL_WIDTHS;
  });

  /* colWidths 변경 시 localStorage에 저장 */
  useEffect(() => {
    localStorage.setItem("orbitail_timeline_col_widths", JSON.stringify(colWidths));
  }, [colWidths]);
  const LEFT_W = colWidths.issue + colWidths.state + colWidths.assignee;
  const COL_ISSUE = colWidths.issue;
  const COL_STATE = colWidths.state;
  const COL_ASSIGNEE = colWidths.assignee;

  /* 리사이즈 핸들 mousedown — column 이름을 받아 해당 너비 조절 */
  const startColResize = (col: "issue" | "state" | "assignee") => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[col];
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = Math.max(COL_MIN[col], Math.min(COL_MAX[col], startW + delta));
      setColWidths((c) => ({ ...c, [col]: next }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /* 인라인 이슈 빠른 생성 */
  const [quickCreating, setQuickCreating] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const quickCreateMutation = useMutation({
    mutationFn: (title: string) => {
      /* Todo(unstarted) 우선 선택 → default → 첫 번째 */
      const defaultState = states.find((s) => s.group === "unstarted") ?? states.find((s) => s.default) ?? states[0];
      if (!defaultState?.id) throw new Error("No state configured for this project.");
      return issuesApi.create(workspaceSlug, projectId, {
        title,
        state: defaultState.id,
        project: projectId,
      });
    },
    onSuccess: () => {
      refresh();
      /* 새 이슈는 날짜 없이 생성됨 → showNoDate가 꺼져 있으면 안 보이므로 자동 켜기 */
      if (!settings.showNoDate) onSettingsChange({ showNoDate: true });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : t("issues.detail.toast.subIssueCreateFailed");
      toast.error(msg);
      /* 실패 시 입력값 복원 (아래 submitQuickCreate에서 즉시 비웠으므로) */
    },
  });
  /* 엔터/블러 양쪽에서 중복 호출 방지 — 한 번만 제출되도록 */
  const submittingRef = useRef(false);
  const submitQuickCreate = () => {
    const title = quickTitle.trim();
    if (!title) { setQuickCreating(false); return; }
    if (submittingRef.current) return;
    submittingRef.current = true;
    /* 즉시 입력값 비움 — 다음 제목 바로 타이핑 가능 */
    setQuickTitle("");
    quickCreateMutation.mutate(title, {
      onSettled: () => { submittingRef.current = false; },
      onError: () => { setQuickTitle(title); }, // 실패 시 복원
    });
  };

  /* 하위 이슈 인라인 생성 — 타임라인 행 옆 + 버튼에서 호출 */
  const [addingChildFor, setAddingChildFor] = useState<string | null>(null);
  const [childTitle, setChildTitle] = useState("");
  const createSubMutation = useMutation({
    mutationFn: ({ parentId, title }: { parentId: string; title: string }) =>
      issuesApi.subIssues.create(workspaceSlug, projectId, parentId, { title }),
    onSuccess: (_, vars) => {
      setChildTitle("");
      setAddingChildFor(null);
      refresh(vars.parentId);
    },
    onError: () => toast.error(t("issues.detail.toast.subIssueCreateFailed")),
  });

  /* 프로젝트 멤버 — 담당자 컬럼용 */
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug, projectId),
  });

  /* 상태 필터 — 선택된 state id 집합. 비어있으면 전부 표시(필터 없음) */
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set());
  const toggleStateFilter = (id: string) => {
    setStateFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (!settings.showCompleted && completedIds.has(issue.state)) return false;
      /* 자식 이슈(parent 있음)는 showNoDate 필터 우회 — 부모-자식 계층 유지를 위해.
         날짜 없는 루트 이슈만 showNoDate=false일 때 숨김 */
      if (!settings.showNoDate && !issue.parent && !issue.start_date && !issue.due_date) return false;
      /* 상태 필터: 선택된 state가 있으면 그것만 표시 */
      if (stateFilter.size > 0 && !stateFilter.has(issue.state)) return false;
      return true;
    });
  }, [issues, settings, completedIds, stateFilter]);

  /* 루트 이슈(부모 없음)만 — 그룹핑은 루트 기준으로 */
  const rootIssues = useMemo(() => filteredIssues.filter((i) => !i.parent), [filteredIssues]);

  /* parent id → 자식 이슈 목록 맵 — 전체 필터링된 이슈에서 계산 */
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of filteredIssues) {
      if (i.parent) {
        if (!m.has(i.parent)) m.set(i.parent, []);
        m.get(i.parent)!.push(i);
      }
    }
    return m;
  }, [filteredIssues]);

  type Group = { label: string; color: string; issues: Issue[] };

  /* 그룹핑은 "루트 이슈"만을 대상으로 함 — 자식은 각 부모 아래에 tree 형태로 붙음 */
  const groups = useMemo((): Group[] => {
    if (settings.groupBy === "none") {
      return [{ label: "", color: "", issues: rootIssues }];
    }
    if (settings.groupBy === "state") {
      return states
        .map((s): Group => ({ label: s.name, color: s.color, issues: rootIssues.filter((i) => i.state === s.id) }))
        .filter((g) => g.issues.length > 0);
    }
    if (settings.groupBy === "category") {
      const groups: Group[] = projectCategories
        .map((m): Group => ({ label: m.name, color: "#a855f7", issues: rootIssues.filter((i) => i.category === m.id) }))
        .filter((g) => g.issues.length > 0);
      const unassigned = rootIssues.filter((i) => !i.category);
      if (unassigned.length > 0) groups.push({ label: t("views.timeline.noModule"), color: "#6b7280", issues: unassigned });
      return groups;
    }
    if (settings.groupBy === "sprint") {
      const groups: Group[] = projectSprints
        .map((c): Group => ({ label: c.name, color: "#3b82f6", issues: rootIssues.filter((i) => i.sprint === c.id) }))
        .filter((g) => g.issues.length > 0);
      const unassigned = rootIssues.filter((i) => !i.sprint);
      if (unassigned.length > 0) groups.push({ label: t("views.timeline.noCycle"), color: "#6b7280", issues: unassigned });
      return groups;
    }
    const priorities = ["urgent","high","medium","low","none"] as const;
    const labels: Record<string,string> = { urgent: t("issues.priority.urgent"), high: t("issues.priority.high"), medium: t("issues.priority.medium"), low: t("issues.priority.low"), none: t("issues.priority.none") };
    return priorities
      .map((p): Group => ({ label: labels[p], color: PRIORITY_COLORS[p], issues: rootIssues.filter((i) => i.priority === p) }))
      .filter((g) => g.issues.length > 0);
  }, [rootIssues, settings.groupBy, states, projectCategories, projectSprints, t]);

  /* 날짜 범위 — 기본 ±2개월, 스크롤 끝 도달 시 추가 2개월씩 lazy 로딩 (청크) */
  const CHUNK_DAYS = 60; // 2개월
  const [rangeStart, setRangeStart] = useState(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return addDays(now, -CHUNK_DAYS);
  });
  const [rangeEnd, setRangeEnd] = useState(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return addDays(now, CHUNK_DAYS);
  });

  /* 이슈 범위가 현재 range 바깥이면 한 번만 맞춰 확장 */
  useEffect(() => {
    const dated = filteredIssues.filter((i) => i.start_date || i.due_date);
    if (dated.length === 0) return;
    const starts = dated.map((i) => parseLocalDate(i.start_date || i.due_date!));
    const ends = dated.map((i) => parseLocalDate(i.due_date || i.start_date!));
    const minStart = starts.reduce((a, b) => a < b ? a : b);
    const maxEnd = ends.reduce((a, b) => a > b ? a : b);
    setRangeStart((prev) => (minStart < prev ? addDays(minStart, -7) : prev));
    setRangeEnd((prev) => (maxEnd > prev ? addDays(maxEnd, 7) : prev));
  }, [filteredIssues]);

  const tMonth = (idx: number) => t(MONTH_KEYS[idx]);
  const columns = useMemo(
    () => buildColumns(rangeStart, rangeEnd, settings.scale, tMonth, settings.hideWeekends),
    [rangeStart, rangeEnd, settings.scale, settings.hideWeekends, t]
  );

  const colW       = COL_WIDTH[settings.scale];
  const totalWidth = columns.length * colW;
  const pxPerDay   = colW / (settings.scale === "day" ? 1 : settings.scale === "week" ? 7 : 30);

  /* 스케일 변경 시 화면 중앙 날짜 보존 — 변경 직전 중앙 날짜를 ref에 저장하고
     변경 후 effect에서 새 픽셀 좌표로 스크롤 복원 */
  const handleSettingsChange = useCallback((s: Partial<TimelineSettings>) => {
    if (s.scale !== undefined && s.scale !== settings.scale && scrollRef.current) {
      const container = scrollRef.current;
      const centerPx = container.scrollLeft + container.clientWidth / 2;
      const dayOffset = centerPx / pxPerDay;
      pendingCenterDate.current = addDays(rangeStart, Math.round(dayOffset));
    }
    onSettingsChange(s);
  }, [settings.scale, pxPerDay, rangeStart, onSettingsChange]);

  useEffect(() => {
    if (!pendingCenterDate.current || !scrollRef.current) return;
    const container = scrollRef.current;
    const target = pendingCenterDate.current;
    pendingCenterDate.current = null;
    /* 새 scale의 pxPerDay로 다시 계산 */
    const newPxPerDay = COL_WIDTH[settings.scale] / (settings.scale === "day" ? 1 : settings.scale === "week" ? 7 : 30);
    const dayOffset = diffDays(rangeStart, target);
    const targetPx = dayOffset * newPxPerDay;
    container.scrollLeft = Math.max(0, targetPx - container.clientWidth / 2);
  }, [settings.scale, rangeStart]);

  const [dragState, setDragState] = useState<{
    issueId: string;
    type: "start" | "end" | "both";
    initialStart: Date;
    initialDue: Date;
    startX: number;
    currentX: number;
  } | null>(null);

  /* 드래그 직후 click 이벤트 억제 — mouseup 다음 tick에서 자동 해제 */
  const suppressClickRef = useRef(false);

  /* 일정 생성 — 2-click 방식:
     잡고 이동 = pan(가로 스크롤), 짧게 클릭 = 일정 생성 단계
     1) 첫 클릭: 시작일 기록 → 모드 진입
     2) 마우스 이동: 끝일 preview
     3) 두 번째 클릭: 일정 확정
     Esc로 취소 */
  const [scheduleMode, setScheduleMode] = useState<{
    issueId: string;
    startDate: Date;
    currentDate: Date | null;
  } | null>(null);

  /* mousedown 시작 좌표 — click vs drag 판별용 */
  const clickStartRef = useRef<{ x: number; y: number } | null>(null);

  /* ESC로 모드 취소 */
  useEffect(() => {
    if (!scheduleMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setScheduleMode(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scheduleMode]);

  /* 모드 활성 시 mousemove로 endDate preview 갱신 */
  useEffect(() => {
    if (!scheduleMode) return;
    const handleMove = (e: MouseEvent) => {
      /* 타임라인 영역 안에서만 preview. row element 찾아 offsetX 계산 */
      const rowEl = (e.target as HTMLElement)?.closest("[data-timeline-area]") as HTMLElement | null;
      if (!rowEl) return;
      const rect = rowEl.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const colIdx = Math.max(0, Math.min(columns.length - 1, Math.floor(offsetX / colW)));
      const currentDate = new Date(columns[colIdx].start);
      setScheduleMode((prev) => prev ? { ...prev, currentDate } : null);
    };
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [scheduleMode, colW, columns]);

  useEffect(() => {
    if (!dragState) return;
    let rafId: number | null = null;
    const handleMove = (e: MouseEvent) => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        setDragState(prev => prev ? { ...prev, currentX: e.clientX } : null);
        rafId = null;
      });
    };
    const handleUp = (e: MouseEvent) => {
      // dragState를 closure에서 직접 읽어 사용 (setState 내부에서 mutate 호출 금지)
      if (!dragState) return;
      const deltaPx = e.clientX - dragState.startX;
      /* 실제 이동이 있었으면 다음 click 이벤트 억제 (mouseup → click 전파 방지) */
      if (Math.abs(deltaPx) > 3) {
        suppressClickRef.current = true;
        setTimeout(() => { suppressClickRef.current = false; }, 100);
      }
      const deltaDays = Math.round(deltaPx / pxPerDay);

      let newStart = new Date(dragState.initialStart);
      let newDue = new Date(dragState.initialDue);

      if (dragState.type === "start") {
        newStart = addDays(newStart, deltaDays);
        if (newStart > newDue) newStart = new Date(newDue);
      } else if (dragState.type === "end") {
        newDue = addDays(newDue, deltaDays);
        if (newDue < newStart) newDue = new Date(newStart);
      } else if (dragState.type === "both") {
        newStart = addDays(newStart, deltaDays);
        newDue = addDays(newDue, deltaDays);
      }

      const issueId = dragState.issueId;

      // setState 먼저 호출 후 mutate 호출 (순서 중요)
      setDragState(null);

      if (deltaDays !== 0) {
        updateMutation.mutate({
          id: issueId,
          data: {
            start_date: toIso(newStart),
            due_date: toIso(newDue),
          }
        });
      }
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragState, pxPerDay, updateMutation]);

  function getBarBounds(start: Date, end: Date) {
    /* day scale + hideWeekends: 가시 컬럼 인덱스 기반 계산 (주말 제외)
       주말에 걸친 bar는 가장 가까운 주중 컬럼으로 clamp */
    if (settings.scale === "day" && settings.hideWeekends) {
      const startIso = toIso(start);
      const endIso   = toIso(end);
      let startIdx = columns.findIndex((c) => toIso(c.start) >= startIso);
      let endIdx = -1;
      for (let i = columns.length - 1; i >= 0; i--) {
        if (toIso(columns[i].start) <= endIso) { endIdx = i; break; }
      }
      if (startIdx < 0) startIdx = 0;
      if (endIdx < 0 || startIdx > endIdx) return { left: 0, width: 0 };
      return { left: startIdx * colW, width: (endIdx - startIdx + 1) * colW };
    }
    return {
      left:  Math.max(diffDays(rangeStart, start) * pxPerDay, 0),
      width: Math.max((diffDays(start, end) + 1) * pxPerDay, 10),
    };
  }

  /* 오늘 라인 위치 — 컬럼 기반으로 정확히 계산
       1) 오늘이 포함된 컬럼을 찾음 (day/week/month 모두 start~end 범위 비교)
       2) 해당 컬럼 내에서 오늘의 상대 위치(daysIn / col.days)를 계산해 colW에 곱함
       → hideWeekends / 월별 일수 차이 / week scale의 rangeStart 중간 시작 모두 정확 반영 */
  const todayLeft = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (columns.length === 0) return 0;

    const idx = columns.findIndex(
      (c) => today.getTime() >= c.start.getTime() && today.getTime() <= c.end.getTime(),
    );
    if (idx !== -1) {
      const col = columns[idx];
      const daysIn = diffDays(col.start, today);
      const ratio  = col.days > 1 ? daysIn / col.days : 0;
      return idx * colW + ratio * colW;
    }

    /* 오늘이 컬럼 범위 밖 (또는 hideWeekends로 숨겨진 주말) 처리 — 가장 가까운 컬럼 경계로 스냅 */
    if (today.getTime() < columns[0].start.getTime()) return 0;
    if (today.getTime() > columns[columns.length - 1].end.getTime()) return columns.length * colW;
    const nextIdx = columns.findIndex((c) => today.getTime() < c.start.getTime());
    return nextIdx > 0 ? nextIdx * colW : 0;
  }, [columns, colW]);

  /* 스케일이 바뀌면 "오늘로 이동" 플래그를 리셋 — 다음 todayLeft 계산 후 재스크롤 */
  useEffect(() => {
    didScrollToday.current = false;
  }, [settings.scale]);

  /* 초기 마운트 + 스케일 변경 시 오늘 날짜를 화면 중앙에 오도록 1회만 스크롤
   * - issues.length === 0 이면 아직 데이터 없는 상태이므로 건너뜀
   *   (데이터 로드 후 todayLeft가 다시 계산되면 그때 한 번 실행)
   * - didScrollToday가 true이면 이미 스크롤한 것이므로 skip (리패치 시 재스크롤 방지)
   */
  useEffect(() => {
    if (!scrollRef.current || issues.length === 0) return;
    if (didScrollToday.current) return;
    const container = scrollRef.current;
    const viewW = container.clientWidth - LEFT_W;
    container.scrollLeft = Math.max(0, todayLeft - viewW / 2);
    didScrollToday.current = true;
  }, [todayLeft, issues.length]); // issues 로드 완료 후 + todayLeft 확정 시 실행

  /* 오늘로 이동 핸들러 (툴바 버튼) */
  const scrollToToday = () => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const viewW = container.clientWidth - LEFT_W;
    container.scrollTo({ left: Math.max(0, todayLeft - viewW / 2), behavior: "smooth" });
  };

  /* 빈 영역 pan drag 핸들러 — 이슈 바나 버튼 위가 아닌 곳에서만 동작 */
  const handlePanStart = (e: React.MouseEvent) => {
    // 인터랙티브 요소(버튼, 바, 핸들) 위에서는 pan 시작 안 함
    if ((e.target as HTMLElement).closest("button, [data-no-pan]")) return;
    if (!scrollRef.current) return;
    panRef.current = { startX: e.clientX, scrollLeft: scrollRef.current.scrollLeft };
    setIsPanning(true);
  };

  const handlePanMove = (e: React.MouseEvent) => {
    if (!panRef.current || !scrollRef.current) return;
    const dx = e.clientX - panRef.current.startX;
    scrollRef.current.scrollLeft = panRef.current.scrollLeft - dx;
  };

  const handlePanEnd = () => {
    panRef.current = null;
    setIsPanning(false);
  };

  /* 상단 구분 헤더:
     - day scale: "N월 N주차" 단위로 병합
     - week scale: 월 단위로 병합
     - month scale: 없음 (컬럼 자체가 월) */
  const monthHeaders = useMemo(() => {
    if (settings.scale === "month") return [];
    const headers: { label: string; left: number; width: number }[] = [];
    let startLeft = 0;

    if (settings.scale === "day") {
      /* day 모드 — 주 시작 요일(firstDow) 기준으로 병합 */
      let curWeekKey = -1;
      columns.forEach((col, i) => {
        const d = col.start;
        const weekStart = new Date(d);
        const offset = (d.getDay() - firstDow + 7) % 7;
        weekStart.setDate(d.getDate() - offset);
        const key = weekStart.getTime();
        if (key !== curWeekKey) {
          if (curWeekKey >= 0) headers[headers.length - 1].width = i * colW - startLeft;
          startLeft = i * colW;
          curWeekKey = key;
          const monthName = t(MONTH_KEYS[weekStart.getMonth()]);
          const weekOfMonth = Math.ceil(weekStart.getDate() / 7);
          headers.push({ label: t("views.timeline.weekHeader", { monthName, week: weekOfMonth }), left: startLeft, width: 0 });
        }
      });
    } else {
      /* week 모드 — 월 단위로 병합 */
      let curMonth = -1;
      columns.forEach((col, i) => {
        const m = col.start.getMonth();
        if (m !== curMonth) {
          if (curMonth >= 0) headers[headers.length - 1].width = i * colW - startLeft;
          startLeft = i * colW;
          curMonth = m;
          headers.push({ label: `${t(MONTH_KEYS[m])} ${col.start.getFullYear()}`, left: startLeft, width: 0 });
        }
      });
    }

    if (headers.length > 0) headers[headers.length - 1].width = columns.length * colW - startLeft;
    return headers;
  }, [columns, colW, settings.scale, t]);

  type Row =
    | { type: "group"; group: Group }
    | { type: "issue"; issue: Issue; stateObj?: State; depth: number; hasChildren: boolean }
    | { type: "event"; event: ProjectEvent };

  /* 접힌 parent 이슈 — children을 rows에서 숨김 */
  /* 그룹 접기 — 그룹 라벨 기준 (state id, priority key, module id 등) */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroupCollapse = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rows: Row[] = useMemo(() => {
    const r: Row[] = [];

    /* 이벤트 — 활성화 시 최상단에 "Events" 그룹으로 배치 */
    if (settings.showEvents && events.length > 0) {
      const eventsGroup: Group = { label: t("views.timeline.eventsGroup"), color: "#a855f7", issues: [] };
      r.push({ type: "group", group: eventsGroup });
      if (!collapsedGroups.has(eventsGroup.label)) {
        for (const evt of events) {
          r.push({ type: "event", event: evt });
        }
      }
    }

    /* 각 그룹의 루트 이슈들 → 트리 walk로 자식까지 indent로 배치 */
    const walk = (issue: Issue, depth: number) => {
      const children = childrenByParent.get(issue.id) ?? [];
      const hasChildren = children.length > 0;
      r.push({ type: "issue", issue, stateObj: stateMap[issue.state], depth, hasChildren });
      if (hasChildren && !collapsedIds.has(issue.id)) {
        for (const child of children) walk(child, depth + 1);
      }
    };

    for (const group of groups) {
      if (settings.groupBy !== "none") {
        r.push({ type: "group", group });
        /* 그룹 접혀있으면 이슈 행 생성 생략 */
        if (collapsedGroups.has(group.label)) continue;
      }
      for (const root of group.issues) walk(root, 0);
    }
    return r;
  }, [groups, settings.groupBy, settings.showEvents, events, stateMap, collapsedIds, collapsedGroups, childrenByParent, t]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden relative bg-background select-none">

      <div
        className="flex items-center justify-between px-5 py-2.5 border-b border-border shrink-0 relative"
        style={{
          background: "var(--glass-sidebar-bg)",
        }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={scrollToToday}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-primary/40 text-primary hover:bg-primary/10 transition-all duration-150"
          >
            {t("views.timeline.today")}
          </button>

          {states.length > 0 && (
            <div className="flex items-center gap-1 ml-2">
              {states.map((s) => {
                const active = stateFilter.has(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleStateFilter(s.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-1 text-2xs font-medium rounded-md border transition-all",
                      active
                        ? "border-transparent text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                    style={{
                      backgroundColor: active ? `${s.color}26` : undefined,
                      borderLeftColor: active ? s.color : undefined,
                      borderLeftWidth: active ? "3px" : undefined,
                    }}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                    {s.name}
                  </button>
                );
              })}
              {stateFilter.size > 0 && (
                <button
                  onClick={() => setStateFilter(new Set())}
                  className="text-2xs text-muted-foreground hover:text-foreground px-1.5 py-1 rounded-md hover:bg-muted/40"
                >
                  ×
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-1 bg-muted/30 rounded-xl p-1 border border-border/70">
            {(["day","week","month"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onSettingsChange({ scale: s })}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-lg transition-all duration-150",
                  settings.scale === s
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {{ day: t("views.timeline.scaleDay"), week: t("views.timeline.scaleWeek"), month: t("views.timeline.scaleMonth") }[s]}
              </button>
            ))}
          </div>
        </div>

        {/* 설정 버튼 — Portal 기반 패널 위치를 위해 ref 사용 */}
        <div className="relative">
          <button
            ref={settingsBtnRef}
            onClick={() => setSettingsOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 border",
              settingsOpen
                ? "bg-primary/10 text-primary border-primary/30"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border-border"
            )}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t("views.timeline.settingsBtn")}
            <ChevronDown className={cn("h-3 w-3 transition-transform", settingsOpen && "rotate-180")} />
          </button>
          {settingsOpen && (
            <SettingsPanel
              settings={settings}
              onChange={handleSettingsChange}
              onClose={() => setSettingsOpen(false)}
              triggerRef={settingsBtnRef}
            />
          )}
        </div>
      </div>

      {/* ── Gantt 본문 — 빈 영역 pan + 스크롤 끝에서 lazy chunk 로딩 ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
        onScroll={(e) => {
          const el = e.currentTarget;
          const { scrollLeft, scrollWidth, clientWidth } = el;
          /* 오른쪽 끝 근접 (200px 이내) — 미래 CHUNK_DAYS 확장 */
          if (scrollLeft + clientWidth > scrollWidth - 200) {
            setRangeEnd((prev) => addDays(prev, CHUNK_DAYS));
          }
          /* 왼쪽 끝 근접 — 과거 CHUNK_DAYS 확장 + 스크롤 위치 보정 */
          if (scrollLeft < 200) {
            setRangeStart((prev) => addDays(prev, -CHUNK_DAYS));
            /* 새 컬럼이 앞에 추가되므로 scrollLeft을 이동시켜 사용자 시점 유지 */
            requestAnimationFrame(() => {
              if (scrollRef.current) {
                scrollRef.current.scrollLeft += CHUNK_DAYS * colW;
              }
            });
          }
        }}
      >
        <div style={{ minWidth: LEFT_W + totalWidth }} className="flex flex-col min-h-full">

          {/* ── 날짜 헤더 (sticky top) — 두 레벨: 상단 월 / 하단 날짜 ── */}
          <div
            className="sticky top-0 z-20 flex"
            style={{
              height: HDR_H,
              background: "var(--glass-sidebar-bg)",
              borderBottom: "2px solid hsl(var(--border))",
            }}
          >
            {/* 코너 셀 (왼쪽 고정) — 3 서브컬럼 헤더 */}
            <div
              className="sticky left-0 z-30 shrink-0 flex items-end"
              style={{
                width: LEFT_W,
                height: HDR_H,
                background: "var(--glass-sidebar-bg)",
                borderRight: "2px solid hsl(var(--border))",
              }}
            >
              <div
                className="relative flex items-end px-4 pb-2 shrink-0"
                style={{ width: COL_ISSUE, borderRight: "1px solid hsl(var(--border))" }}
              >
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground/50">{t("views.timeline.issuesColumn")}</span>
                {/* 리사이즈 핸들 — 우측 경계 */}
                <div
                  onMouseDown={startColResize("issue")}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
                />
              </div>
              <div
                className="relative flex items-end px-3 pb-2 shrink-0"
                style={{ width: COL_STATE, borderRight: "1px solid hsl(var(--border))" }}
              >
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground/50">{t("views.timeline.stateColumn")}</span>
                <div
                  onMouseDown={startColResize("state")}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
                />
              </div>
              <div
                className="relative flex items-end px-3 pb-2 shrink-0"
                style={{ width: COL_ASSIGNEE }}
              >
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground/50">{t("views.timeline.assigneeColumn")}</span>
                <div
                  onMouseDown={startColResize("assignee")}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
                />
              </div>
            </div>

            {/* 날짜 컬럼 헤더 영역 */}
            <div className="relative flex-shrink-0" style={{ width: totalWidth, height: HDR_H }}>

              {/* 상단 32px: 월 레이블 (일/주 모드) — 굵은 primary 색조 */}
              {monthHeaders.map((h) => (
                <div
                  key={h.label + h.left}
                  className="absolute top-0 flex items-center px-3"
                  style={{
                    left: h.left,
                    width: h.width,
                    height: HDR_H / 2,
                    borderRight: "2px solid hsl(var(--border))",
                  }}
                >
                  <span className="text-xs font-bold text-primary/80 truncate">{h.label}</span>
                </div>
              ))}

              {/* 하단 30px: 일/주/월 컬럼 레이블 — day scale은 날짜+요일 이중 표기 */}
              {columns.map((col, i) => {
                const isToday = settings.scale === "day" && col.start.toDateString() === today.toDateString();
                const dow = col.start.getDay(); // 0=일, 6=토
                const isWeekend = settings.scale === "day" && (dow === 0 || dow === 6);
                const DAY_KEYS = ["calendar.sun","calendar.mon","calendar.tue","calendar.wed","calendar.thu","calendar.fri","calendar.sat"] as const;
                const weekdayLabel = settings.scale === "day"
                  ? t(DAY_KEYS[dow])
                  : null;
                return (
                  <div
                    key={i}
                    className={cn(
                      "absolute flex flex-col items-center justify-center text-2xs font-semibold transition-colors gap-0",
                      isToday
                        ? "text-primary"
                        : dow === 0 && settings.scale === "day" ? "text-rose-500/80"
                          : dow === 6 && settings.scale === "day" ? "text-sky-500/80"
                            : "text-muted-foreground/50"
                    )}
                    style={{
                      left:   i * colW,
                      width:  colW,
                      // 월 모드는 전체 높이 사용, 일/주 모드는 하단 절반
                      top:    settings.scale === "month" ? 0 : HDR_H / 2,
                      height: settings.scale === "month" ? HDR_H : HDR_H / 2,
                      borderRight: getColBorderRight(col, columns[i + 1], settings.scale, isToday, firstDow),
                      background: isWeekend ? "hsl(var(--muted) / 0.3)" : undefined,
                    }}
                  >
                    {/* 오늘 날짜는 primary 원형 배지 */}
                    {isToday ? (
                      <span className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xs font-bold">
                        {col.label}
                      </span>
                    ) : settings.scale === "day" ? (
                      <>
                        <span className="text-xs leading-tight">{col.label}</span>
                        <span className="text-3xs font-medium opacity-70 leading-tight">{weekdayLabel}</span>
                      </>
                    ) : col.label}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 이슈 행 ── */}
          {rows.map((row, ri) => {
            const isGroup = row.type === "group";
            const isEven  = ri % 2 === 0;

            return (
              <Fragment key={ri}>
              <div
                className={cn(
                  "flex group/row transition-colors duration-100 relative",
                  isGroup
                    ? "border-y-2 border-border bg-muted/20"
                    : "border-b border-border hover:bg-primary/[0.04]"
                )}
                style={{ height: ROW_H }}
              >
                {/* 왼쪽 고정 영역 — 3 서브컬럼 (이슈/상태/담당자) */}
                <div
                  data-no-pan
                  className="sticky left-0 z-20 shrink-0 flex items-stretch overflow-hidden"
                  style={{
                    width: LEFT_W,
                    /* 완전 불투명 배경 — 뒤 타임라인 바가 비치지 않도록 */
                    background: isGroup
                      ? `linear-gradient(to right, ${row.group?.color || "hsl(var(--primary))"}18, hsl(var(--background)))`
                      : "hsl(var(--background))",
                    borderRight: "2px solid hsl(var(--border))",
                    borderLeft: isGroup
                      ? `3px solid ${row.group?.color || "hsl(var(--primary))"}`
                      : undefined,
                  }}
                >
                  {row.type === "event" ? (
                    (() => {
                      const TypeIcon = EVENT_TYPES[row.event.event_type]?.icon ?? EVENT_TYPES.other.icon;
                      return (
                        <div className="flex items-center gap-2 w-full pl-4 pr-3 overflow-hidden">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ background: row.event.color }}
                          />
                          <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.2} />
                          <span className="text-sm truncate text-foreground/85 font-medium" title={row.event.title}>
                            {row.event.title}
                          </span>
                        </div>
                      );
                    })()
                  ) : isGroup && row.type === "group" ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleGroupCollapse(row.group.label); }}
                      className="flex items-center gap-2 w-full pl-2 pr-3 hover:bg-muted/20 transition-colors text-left"
                      title={collapsedGroups.has(row.group.label) ? t("views.timeline.expand") : t("views.timeline.collapse")}
                    >
                      {/* 그룹 chevron — 접힘/펼침 표시 */}
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-transform",
                          !collapsedGroups.has(row.group.label) && "rotate-90"
                        )}
                        style={{ color: row.group.color || "hsl(var(--primary))" }}
                      />
                      <span
                        className="text-2xs font-bold uppercase tracking-widest truncate"
                        style={{ color: row.group.color || "hsl(var(--primary))" }}
                      >
                        {row.group.label}
                      </span>
                      <span className="text-2xs text-muted-foreground/40 ml-auto shrink-0">
                        {row.group.issues.length}
                      </span>
                    </button>
                  ) : (
                    row.type === "issue" && <>
                      {/* 상태 색상 stripe — 행 좌측 전체 높이 */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-1"
                        style={{ background: row.stateObj?.color ?? "#888", opacity: 0.7 }}
                      />

                      {/* 서브컬럼 1: 이슈 제목 + 모듈/사이클 배지 + 우측 chevron (depth 들여쓰기) */}
                      <div
                        className="flex items-center gap-1.5 overflow-hidden pr-2"
                        style={{
                          width: COL_ISSUE,
                          paddingLeft: `${16 + row.depth * 16}px`,
                          borderRight: "1px solid hsl(var(--border))",
                        }}
                      >
                        <span
                          className="text-sm truncate cursor-pointer text-foreground/85 hover:text-foreground transition-colors leading-none font-medium"
                          onClick={() => { if (!dragState && !suppressClickRef.current) onIssueClick(row.issue.id); }}
                        >
                          {row.issue.title}
                        </span>
                        {row.issue.category && categoryMap.get(row.issue.category) && (
                          <span className="text-2xs px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-700 dark:text-purple-400 font-medium shrink-0">
                            {categoryMap.get(row.issue.category)}
                          </span>
                        )}
                        {row.issue.sprint && sprintMap.get(row.issue.sprint) && (
                          <span className="text-2xs px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-700 dark:text-blue-400 font-medium shrink-0">
                            {sprintMap.get(row.issue.sprint)}
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-0.5 shrink-0">
                          {/* 하위 이슈 추가 버튼 — 호버 시 등장 */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAddingChildFor(row.issue.id);
                              setChildTitle("");
                            }}
                            className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0"
                            title={t("issues.table.addSubIssue")}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                          {/* Expand/Collapse chevron — 자식이 있을 때만 */}
                          {row.hasChildren && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleCollapse(row.issue.id); }}
                              className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground shrink-0"
                              title={collapsedIds.has(row.issue.id) ? t("views.timeline.expand") : t("views.timeline.collapse")}
                            >
                              <ChevronRight
                                className={cn(
                                  "h-3.5 w-3.5 transition-transform",
                                  !collapsedIds.has(row.issue.id) && "rotate-90"
                                )}
                              />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 서브컬럼 2: 상태 — 공용 StatePicker */}
                      <div
                        className="flex items-center px-2 overflow-hidden"
                        style={{ width: COL_STATE, borderRight: "1px solid hsl(var(--border))" }}
                      >
                        <StatePicker
                          states={states}
                          currentStateId={row.issue.state}
                          currentState={row.stateObj}
                          onChange={(id) => updateMutation.mutate({ id: row.issue.id, data: { state: id } })}
                        />
                      </div>

                      {/* 서브컬럼 3: 담당자 — 공용 AssigneePicker */}
                      <div
                        className="flex items-center px-2 overflow-hidden"
                        style={{ width: COL_ASSIGNEE }}
                      >
                        <AssigneePicker
                          members={members}
                          currentIds={row.issue.assignees}
                          currentDetails={row.issue.assignee_details}
                          onChange={(ids) => updateMutation.mutate({ id: row.issue.id, data: { assignees: ids } })}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* 오른쪽: 타임라인 영역 — 드래그=pan, 짧은 클릭=일정 생성(일정 없는 이슈만) */}
                <div
                  className="relative flex-shrink-0 group/timeline"
                  data-timeline-area
                  onMouseDown={(e) => {
                    clickStartRef.current = { x: e.clientX, y: e.clientY };
                  }}
                  onClick={(e) => {
                    const start = clickStartRef.current;
                    clickStartRef.current = null;
                    if (!start) return;
                    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
                    /* 드래그였으면 무시 (pan으로 처리됨) */
                    if (moved > 3) return;
                    /* 일정 없는 이슈만 */
                    if (row.type !== "issue" || row.issue.start_date || row.issue.due_date) {
                      setScheduleMode(null);
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    const offsetX = e.clientX - rect.left;
                    const colIdx = Math.max(0, Math.min(columns.length - 1, Math.floor(offsetX / colW)));
                    const clickDate = new Date(columns[colIdx].start);

                    if (scheduleMode?.issueId === row.issue.id) {
                      /* 두 번째 클릭: 일정 확정 */
                      let s = scheduleMode.startDate;
                      let d = clickDate;
                      if (d < s) [s, d] = [d, s];
                      updateMutation.mutate({
                        id: row.issue.id,
                        data: { start_date: toIso(s), due_date: toIso(d) },
                      });
                      setScheduleMode(null);
                    } else {
                      /* 첫 번째 클릭: 모드 진입 */
                      setScheduleMode({ issueId: row.issue.id, startDate: clickDate, currentDate: clickDate });
                    }
                  }}
                  style={{
                    width: totalWidth,
                    height: ROW_H,
                    // 교번 배경 + 모드 활성 행은 강조
                    background: scheduleMode?.issueId === (row.type === "issue" ? row.issue.id : "")
                      ? "hsl(var(--primary) / 0.06)"
                      : isEven ? "rgba(var(--muted), 0.03)" : undefined,
                    cursor: row.type === "issue" && !row.issue.start_date && !row.issue.due_date ? "crosshair" : undefined,
                  }}
                >
                  {/* 열 구분선 + 오늘 컬럼 배경 + 주/월 경계 강조 */}
                  {columns.map((col, ci) => {
                    const isToday = settings.scale === "day" && col.start.toDateString() === today.toDateString();
                    return (
                      <div
                        key={ci}
                        className="absolute top-0 bottom-0"
                        style={{
                          left: ci * colW,
                          width: colW,
                          background: isToday
                            ? "hsl(var(--primary) / 0.05)"
                            : undefined,
                          borderRight: getColBorderRight(col, columns[ci + 1], settings.scale, isToday, firstDow),
                        }}
                      />
                    );
                  })}

                  {/* 오늘 선 — 2px 너비, 10px 원형 헤드 + glow */}
                  {todayLeft >= 0 && todayLeft <= totalWidth && (
                    <div
                      className="absolute top-0 bottom-0 z-10 pointer-events-none"
                      style={{ left: todayLeft }}
                    >
                      {/* 상단 원형 헤드 */}
                      <div
                        className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full"
                        style={{
                          width: 10,
                          height: 10,
                          background: "hsl(var(--primary))",
                          boxShadow: "0 0 8px hsl(var(--primary) / 0.6)",
                        }}
                      />
                      {/* 수직 선 — 완전 불투명 */}
                      <div
                        className="absolute bottom-0"
                        style={{
                          top: 10,
                          left: "50%",
                          width: 2,
                          transform: "translateX(-50%)",
                          background: "hsl(var(--primary))",
                        }}
                      />
                    </div>
                  )}

                  {/* 2-click 일정 생성 preview — 모드 활성 + 해당 이슈 행 */}
                  {row.type === "issue" && scheduleMode?.issueId === row.issue.id && (() => {
                    const start = scheduleMode.startDate;
                    const end = scheduleMode.currentDate ?? start;
                    const lo = start <= end ? start : end;
                    const hi = start <= end ? end : start;
                    const bs = getBarBounds(lo, hi);
                    const barColor = row.stateObj?.color ?? "hsl(var(--primary))";
                    const barH = ROW_H - 18;
                    return (
                      <div
                        className="absolute pointer-events-none flex items-center px-2 overflow-hidden"
                        style={{
                          left: bs.left + 3,
                          width: Math.max(bs.width - 6, 8),
                          top: (ROW_H - barH) / 2,
                          height: barH,
                          backgroundColor: `${barColor}33`,
                          border: `2px dashed ${barColor}`,
                          borderRadius: 5,
                          color: barColor,
                        }}
                      >
                        <span className="text-xs font-semibold truncate">
                          {lo.getMonth() + 1}/{lo.getDate()} ~ {hi.getMonth() + 1}/{hi.getDate()} — {t("views.timeline.clickToConfirm")}
                        </span>
                      </div>
                    );
                  })()}

                  {/* 그룹 행: 그룹 색상 미세 tint 배경 */}
                  {row.type === "group" && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ background: row.group.color ? row.group.color + "08" : undefined }}
                    />
                  )}

                  {/* 이벤트 바 — 이벤트 색상, 일반 클릭 시 캘린더로 이동/편집은 향후 */}
                  {row.type === "event" && (() => {
                    if (!row.event.date) return null;
                    const evtStart = parseLocalDate(row.event.date);
                    const evtEnd   = row.event.end_date ? parseLocalDate(row.event.end_date) : evtStart;
                    const bs = getBarBounds(evtStart, evtEnd);
                    const barColor = row.event.color;
                    const barH = ROW_H - 18;
                    return (
                      <div
                        data-no-pan
                        title={row.event.title}
                        className="absolute flex items-center overflow-hidden"
                        style={{
                          left:      bs.left + 3,
                          width:     Math.max(bs.width - 6, 8),
                          height:    barH,
                          top:       (ROW_H - barH) / 2,
                          backgroundColor: barColor,
                          color:           "#fff",
                          borderRadius:    5,
                          cursor:          "pointer",
                          transition:      "filter 0.15s",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.filter = "brightness(1.08)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.filter = "none"; }}
                      >
                        <span className="text-xs font-semibold truncate px-3 pointer-events-none">
                          {row.event.title}
                        </span>
                      </div>
                    );
                  })()}

                  {/* 간트 바 — 솔리드 100% 불투명, 6px radius
                      한쪽 날짜만 있으면 그 날짜를 양쪽으로 사용 (1일짜리 바) */}
                  {row.type === "issue" && (() => {
                    if (!row.issue.start_date && !row.issue.due_date) return null;

                    let renderStart = parseLocalDate(row.issue.start_date ?? row.issue.due_date!);
                    let renderDue   = parseLocalDate(row.issue.due_date ?? row.issue.start_date!);
                    const isDragging = dragState?.issueId === row.issue.id;

                    if (isDragging) {
                      const deltaPx = dragState.currentX - dragState.startX;
                      const deltaDays = Math.round(deltaPx / pxPerDay);
                      if (dragState.type === "start") {
                        renderStart = addDays(dragState.initialStart, deltaDays);
                        if (renderStart > renderDue) renderStart = new Date(renderDue);
                      } else if (dragState.type === "end") {
                        renderDue = addDays(dragState.initialDue, deltaDays);
                        if (renderDue < renderStart) renderDue = new Date(renderStart);
                      } else if (dragState.type === "both") {
                        renderStart = addDays(dragState.initialStart, deltaDays);
                        renderDue = addDays(dragState.initialDue, deltaDays);
                      }
                    }

                    const bs = getBarBounds(renderStart, renderDue);
                    const barColor = row.stateObj?.color ?? "#888";
                    const barH = ROW_H - 18; // 행 높이 기준 여백
                    return (
                      <div
                        data-no-pan
                        title={row.issue.title}
                        className="absolute flex items-center overflow-visible group/bar"
                        style={{
                          left:      bs.left + 3,
                          width:     Math.max(bs.width - 6, 8),
                          height:    barH,
                          top:       (ROW_H - barH) / 2,
                          /* 가시성 향상: 100% 불투명 + 흰색 텍스트 */
                          backgroundColor: barColor,
                          borderLeft:      `3px solid ${barColor}`,
                          borderRight:     `1px solid ${barColor}`,
                          borderTop:       `1px solid ${barColor}`,
                          borderBottom:    `1px solid ${barColor}`,
                          color:           "#fff",
                          borderRadius: 5,
                          boxShadow: isDragging
                            ? `0 4px 16px ${barColor}60`
                            : "none",
                          cursor: isDragging ? "grabbing" : "pointer",
                          transition: isDragging ? "none" : "background-color 0.15s, box-shadow 0.15s, filter 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          if (!dragState) {
                            (e.currentTarget as HTMLDivElement).style.filter = "brightness(1.08)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!dragState) {
                            (e.currentTarget as HTMLDivElement).style.filter = "none";
                          }
                        }}
                      >
                        {/* Drag Handle: Start */}
                        <div
                          className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-black/10 transition-colors z-20 rounded-l-[6px]"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDragState({
                              issueId: row.issue.id,
                              type: "start",
                              initialStart: parseLocalDate(row.issue.start_date ?? row.issue.due_date!),
                              initialDue: parseLocalDate(row.issue.due_date ?? row.issue.start_date!),
                              startX: e.clientX,
                              currentX: e.clientX,
                            });
                          }}
                        />

                        {/* 제목 텍스트 (본문 드래그 이동) */}
                        <div
                          className="flex-1 h-full flex items-center px-3 cursor-grab active:cursor-grabbing overflow-hidden z-10"
                          onClick={() => { if (!dragState && !suppressClickRef.current) onIssueClick(row.issue.id); }}
                          onMouseDown={(e) => {
                            // Only trigger both/move if we didn't click handles
                            setDragState({
                              issueId: row.issue.id,
                              type: "both",
                              initialStart: parseLocalDate(row.issue.start_date ?? row.issue.due_date!),
                              initialDue: parseLocalDate(row.issue.due_date ?? row.issue.start_date!),
                              startX: e.clientX,
                              currentX: e.clientX,
                            });
                          }}
                        >
                          <span className="text-xs font-semibold truncate pointer-events-none">
                            {row.issue.title}
                          </span>
                        </div>

                        {/* Drag Handle: End */}
                        <div
                          className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-black/10 transition-colors z-20 rounded-r-[6px]"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDragState({
                              issueId: row.issue.id,
                              type: "end",
                              initialStart: parseLocalDate(row.issue.start_date ?? row.issue.due_date!),
                              initialDue: parseLocalDate(row.issue.due_date ?? row.issue.start_date!),
                              startX: e.clientX,
                              currentX: e.clientX,
                            });
                          }}
                        />
                      </div>
                    );
                  })()}
                </div>
              </div>
              {/* 하위 이슈 인라인 입력 — addingChildFor 활성화 시 해당 행 바로 아래 */}
              {row.type === "issue" && addingChildFor === row.issue.id && (
                <div className="flex border-b border-dashed border-primary/30 bg-primary/[0.03]" style={{ height: ROW_H }}>
                  <div
                    data-no-pan
                    className="sticky left-0 z-20 shrink-0 flex items-center gap-2 pl-4 pr-3"
                    style={{
                      width: LEFT_W,
                      paddingLeft: `${16 + (row.depth + 1) * 16}px`,
                      background: "hsl(var(--background))",
                      borderRight: "2px solid hsl(var(--border))",
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 text-primary shrink-0" />
                    <input
                      ref={(el) => { if (el) el.focus({ preventScroll: true }); }}
                      type="text"
                      value={childTitle}
                      onChange={(e) => setChildTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && childTitle.trim()) {
                          e.preventDefault();
                          createSubMutation.mutate({ parentId: row.issue.id, title: childTitle.trim() });
                        } else if (e.key === "Escape") {
                          setAddingChildFor(null);
                          setChildTitle("");
                        }
                      }}
                      onBlur={() => {
                        if (childTitle.trim()) {
                          createSubMutation.mutate({ parentId: row.issue.id, title: childTitle.trim() });
                        } else {
                          setAddingChildFor(null);
                          setChildTitle("");
                        }
                      }}
                      placeholder={t("issues.table.subIssuePlaceholder")}
                      className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 text-foreground min-w-0"
                    />
                  </div>
                  <div className="relative flex-shrink-0" style={{ width: totalWidth }} />
                </div>
              )}
              </Fragment>
            );
          })}

          {/* 빈 상태 — 좌측 고정 컬럼 형식 유지 */}
          {rows.length === 0 && (
            <div className="flex" style={{ height: 120 }}>
              <div
                className="sticky left-0 z-20 shrink-0 flex items-center justify-center px-4"
                style={{
                  width: LEFT_W,
                  background: "hsl(var(--background))",
                  borderRight: "2px solid hsl(var(--border))",
                }}
              >
                <p className="text-xs text-muted-foreground/60 text-center">
                  {stateFilter.size > 0
                    ? t("views.timeline.emptyFiltered")
                    : t("views.timeline.emptyNoDate")}
                </p>
              </div>
              <div className="relative flex-shrink-0" style={{ width: totalWidth }}>
                {columns.map((col, i) => {
                  const isToday = settings.scale === "day" && col.start.toDateString() === today.toDateString();
                  return (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0"
                      style={{
                        left: i * colW,
                        width: colW,
                        borderRight: getColBorderRight(col, columns[i + 1], settings.scale, isToday, firstDow),
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* 하단 "+ 이슈 추가" 행 — 인라인 텍스트 입력 방식 */}
          <div className="flex group/addrow hover:bg-primary/[0.04] transition-colors border-b border-border" style={{ height: 40 }}>
            <div
              data-no-pan
              className="sticky left-0 z-20 shrink-0 flex items-center gap-2 pl-4 pr-3"
              style={{
                width: LEFT_W,
                background: "hsl(var(--background))",
                borderRight: "2px solid hsl(var(--border))",
              }}
            >
              <Plus className={cn("h-4 w-4 shrink-0 transition-colors", quickCreating ? "text-primary" : "text-muted-foreground/60")} />
              {quickCreating ? (
                <input
                  ref={(el) => { if (el) el.focus({ preventScroll: true }); }}
                  type="text"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  onBlur={submitQuickCreate}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitQuickCreate();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setQuickCreating(false);
                      setQuickTitle("");
                    }
                  }}
                  placeholder={t("views.timeline.quickAddPlaceholder")}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 text-foreground min-w-0"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => { setQuickCreating(true); setQuickTitle(""); }}
                  className="flex-1 text-sm text-muted-foreground/70 hover:text-primary text-left transition-colors font-medium"
                >
                  {t("views.addIssue")}
                </button>
              )}
            </div>
            {/* 오른쪽 — 컬럼 그리드 + 오늘선으로 통일감 유지 */}
            <div className="relative flex-shrink-0" style={{ width: totalWidth }}>
              {columns.map((col, i) => {
                const dow = col.start.getDay();
                const isWeekend = settings.scale === "day" && (dow === 0 || dow === 6);
                const isToday = settings.scale === "day" && col.start.toDateString() === today.toDateString();
                return (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0"
                    style={{
                      left: i * colW,
                      width: colW,
                      borderRight: getColBorderRight(col, columns[i + 1], settings.scale, isToday, firstDow),
                      background: isWeekend ? "hsl(var(--muted) / 0.15)" : undefined,
                    }}
                  />
                );
              })}
              {todayLeft >= 0 && todayLeft <= totalWidth && (
                <div
                  className="absolute top-0 bottom-0 z-10 pointer-events-none"
                  style={{ left: todayLeft }}
                >
                  <div
                    className="absolute top-0 bottom-0"
                    style={{ left: "50%", width: 2, transform: "translateX(-50%)", background: "hsl(var(--primary))" }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* 빈 공간 filler — 이슈가 적을 때 세로 공간을 column grid로 채움 */}
          {(
            <div className="flex flex-1 min-h-[80px] pointer-events-none">
              <div
                className="sticky left-0 z-20 shrink-0"
                style={{
                  width: LEFT_W,
                  background: "hsl(var(--background))",
                  borderRight: "2px solid hsl(var(--border))",
                }}
              />
              <div className="relative flex-shrink-0" style={{ width: totalWidth }}>
                {columns.map((col, i) => {
                  const dow = col.start.getDay();
                  const isWeekend = settings.scale === "day" && (dow === 0 || dow === 6);
                  const isToday = settings.scale === "day" && col.start.toDateString() === today.toDateString();
                  return (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0"
                      style={{
                        left: i * colW,
                        width: colW,
                        borderRight: getColBorderRight(col, columns[i + 1], settings.scale, isToday, firstDow),
                        background: isWeekend ? "hsl(var(--muted) / 0.15)" : undefined,
                      }}
                    />
                  );
                })}
                {todayLeft >= 0 && todayLeft <= totalWidth && (
                  <div
                    className="absolute top-0 bottom-0 z-10 pointer-events-none"
                    style={{ left: todayLeft }}
                  >
                    <div
                      className="absolute top-0 bottom-0"
                      style={{ left: "50%", width: 2, transform: "translateX(-50%)", background: "hsl(var(--primary))" }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

