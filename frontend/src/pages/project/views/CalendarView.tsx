/**
 * Calendar 뷰 — Google Calendar 스타일
 * - 월간 그리드, start_date~due_date 범위 막대 표시
 * - due_date만 있는 이슈는 dot+텍스트 칩으로 표시
 * - flex 기반 균등 행 높이로 화면을 꽉 채움
 * - 설정: 완료 이슈 표시 여부, 날짜 없는 이슈 표시 여부
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useIssueRefresh } from "@/hooks/useIssueMutations";
import { useUndoStore } from "@/stores/undoStore";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Settings2, Maximize2, Minimize2, Plus, User as UserIcon, Users, Inbox, GripVertical, X as XIcon, ChevronDown } from "lucide-react";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { cn } from "@/lib/utils";
import { Z_SETTINGS_OVERLAY, Z_SETTINGS_PANEL } from "@/constants/z-index";
import type { CalendarSettings } from "@/hooks/useViewSettings";
import type { Issue, ProjectEvent } from "@/types";
import { EVENT_TYPES } from "@/constants/event-types";
import { EventDialog } from "@/components/events/EventDialog";
import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { useAuthStore } from "@/stores/authStore";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** "YYYY-MM-DD" 문자열을 로컬 타임으로 파싱 (UTC 오프셋 문제 방지) */
function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toIso(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** 해당 월의 주(week) 배열 반환. 각 주는 7일(일~토) */
function getWeeksInMonth(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);

  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay()); // 해당 주의 일요일로 이동

  const weeks: Date[][] = [];
  const cur = new Date(start);

  while (cur <= last || weeks.length === 0) {
    if (cur > last && weeks.length >= 4) break;
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
    if (cur > last) break;
  }

  // 마지막 주 7일 채우기
  const lastWeek = weeks[weeks.length - 1];
  while (lastWeek.length < 7) {
    lastWeek.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }

  return weeks;
}

interface WeekBar {
  issue:           Issue;
  colStart:        number;  // 0=일요일
  span:            number;  // 열 수
  lane:            number;  // 수직 행 (겹침 방지)
  continuesBefore: boolean; // 이전 주에서 이어짐
  continuesAfter:  boolean; // 다음 주로 이어짐
}

function getBarsForWeek(issues: Issue[], weekStart: Date, weekEnd: Date, expandedIds: Set<string>): WeekBar[] {
  const raw: Omit<WeekBar, "lane">[] = [];

  for (const issue of issues) {
    /* 확장된 이슈만 bar로 그림 — 기본은 chip으로 표시됨 */
    if (!expandedIds.has(issue.id)) continue;
    /* start 또는 due 둘 중 하나만 있어도 표시 — 한쪽만 있으면 1일짜리 bar */
    if (!issue.start_date && !issue.due_date) continue;

    const start = parseLocalDate(issue.start_date ?? issue.due_date!);
    const end   = parseLocalDate(issue.due_date   ?? issue.start_date!);

    if (end < weekStart || start > weekEnd) continue;

    const barStart = start < weekStart ? new Date(weekStart) : start;
    const barEnd   = end   > weekEnd   ? new Date(weekEnd)   : end;

    const colStart = barStart.getDay();
    const colEnd   = barEnd.getDay();
    const span     = Math.max(colEnd - colStart + 1, 1);

    raw.push({
      issue,
      colStart,
      span,
      continuesBefore: start < weekStart,
      continuesAfter:  end   > weekEnd,
    });
  }

  // 시작 열 기준 정렬 후 레인 할당
  const sorted    = [...raw].sort((a, b) => a.colStart - b.colStart);
  const laneEnds: number[] = [];

  return sorted.map((bar) => {
    let lane = 0;
    while (laneEnds[lane] !== undefined && laneEnds[lane] >= bar.colStart) {
      lane++;
    }
    laneEnds[lane] = bar.colStart + bar.span - 1;
    return { ...bar, lane };
  });
}

/** 당일 chip으로 표시할 이슈 — 확장되지 않은 이슈 중 due_date가 해당 날짜인 것 */
function getChipsForDay(issues: Issue[], day: Date, expandedIds: Set<string>): Issue[] {
  const key = dateKey(day);
  return issues.filter((i) => !expandedIds.has(i.id) && i.due_date === key);
}

interface EventWeekBar {
  event:           ProjectEvent;
  colStart:        number;
  span:            number;
  lane:            number;
  continuesBefore: boolean;
  continuesAfter:  boolean;
}

/** 이벤트를 해당 주에 bar로 표시 — 항상 펼친 상태 (칩 없음)
 *  end_date가 없으면 date와 같은 날로 처리 (1일짜리 바) */
function getEventBarsForWeek(events: ProjectEvent[], weekStart: Date, weekEnd: Date): EventWeekBar[] {
  const raw: Omit<EventWeekBar, "lane">[] = [];

  for (const evt of events) {
    if (!evt.date) continue;

    const start = parseLocalDate(evt.date);
    const end   = evt.end_date ? parseLocalDate(evt.end_date) : start;
    if (end < weekStart || start > weekEnd) continue;

    const barStart = start < weekStart ? new Date(weekStart) : start;
    const barEnd   = end   > weekEnd   ? new Date(weekEnd)   : end;
    const colStart = barStart.getDay();
    const colEnd   = barEnd.getDay();
    const span     = Math.max(colEnd - colStart + 1, 1);

    raw.push({ event: evt, colStart, span, continuesBefore: start < weekStart, continuesAfter: end > weekEnd });
  }

  const sorted = [...raw].sort((a, b) => a.colStart - b.colStart);
  const laneEnds: number[] = [];
  return sorted.map((bar) => {
    let lane = 0;
    while (laneEnds[lane] !== undefined && laneEnds[lane] >= bar.colStart) lane++;
    laneEnds[lane] = bar.colStart + bar.span - 1;
    return { ...bar, lane };
  });
}

/** 주말 숨김 모드일 때 bar의 colStart/span을 월~금(1~5) 기준으로 재매핑.
 *  완전히 주말에만 걸친 bar는 null 반환(렌더 제외). */
function remapBarForWeekdays(colStart: number, span: number): { colStart: number; span: number } | null {
  const origEnd = colStart + span;        // exclusive end
  const weekdayStart = Math.max(colStart, 1);  // 월요일=1
  const weekdayEnd   = Math.min(origEnd, 6);   // 금요일=5 (exclusive=6)
  if (weekdayStart >= weekdayEnd) return null; // 주말에만 걸침
  return { colStart: weekdayStart - 1, span: weekdayEnd - weekdayStart };
}

/** 결과 날짜가 주말(토/일)이면 가장 가까운 주중(금 또는 월)으로 스냅 */
function snapToWeekday(d: Date): Date {
  const day = d.getDay();
  if (day === 0) return addDays(d, 1); // 일→월
  if (day === 6) return addDays(d, -1); // 토→금
  return d;
}

const MONTH_KEYS = ["calendar.jan","calendar.feb","calendar.mar","calendar.apr","calendar.may","calendar.jun","calendar.jul","calendar.aug","calendar.sep","calendar.oct","calendar.nov","calendar.dec"] as const;
const DAY_KEYS   = ["calendar.sun","calendar.mon","calendar.tue","calendar.wed","calendar.thu","calendar.fri","calendar.sat"] as const;
const BAR_HEIGHT   = 30; // px — 폰트 18px 기준 line-height 고려
const BAR_GAP      = 3;  // px
/** 한 주 행에 표시할 최대 이벤트 레인 수 (초과분은 "+N개 더"로 표시) */

interface SettingsPanelProps {
  settings:  CalendarSettings;
  onChange:  (s: Partial<CalendarSettings>) => void;
  onClose:   () => void;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

function SettingsPanel({ settings, onChange, onClose, triggerRef }: SettingsPanelProps) {
  const { t } = useTranslation();
  /* trigger 버튼 좌표 기반 fixed 위치 — containing block 탈출 */
  const rect = triggerRef.current?.getBoundingClientRect();
  const panelW = 240;
  const top = rect ? rect.bottom + 4 : 0;
  const left = rect ? Math.min(rect.right - panelW, window.innerWidth - panelW - 8) : 0;

  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: Z_SETTINGS_OVERLAY }} onClick={onClose} />

      <div
        className="glass fixed w-60 rounded-2xl border border-border shadow-2xl p-4 space-y-3.5 text-sm"
        style={{ top, left, zIndex: Z_SETTINGS_PANEL }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-2xs font-bold uppercase tracking-widest text-muted-foreground/60">
          {t("calendar.settings.title")}
        </p>

        {([
          { key: "showCompleted" as const, label: t("calendar.settings.showCompleted") },
          { key: "hideWeekends"  as const, label: t("calendar.settings.hideWeekends") },
          { key: "showEvents"    as const, label: t("calendar.settings.showEvents") },
          { key: "alwaysExpand"  as const, label: t("calendar.settings.alwaysExpand") },
        ] as const).map(({ key, label }) => (
          <label key={key} className="flex items-center gap-3 cursor-pointer group">
            {/* 토글 트랙 */}
            <div
              onClick={() => onChange({ [key]: !settings[key] })}
              className={cn(
                "h-5 w-9 rounded-full border transition-all duration-base flex items-center px-0.5 shrink-0",
                settings[key]
                  ? "bg-primary border-primary"
                  : "bg-muted/40 border-border group-hover:border-border"
              )}
            >
              <div className={cn(
                "h-4 w-4 rounded-full shadow-sm transition-all duration-base",
                settings[key]
                  ? "translate-x-4 bg-primary-foreground"
                  : "translate-x-0 bg-muted-foreground/60"
              )} />
            </div>
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors leading-tight">
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
  /** 이슈 쿼리 필터 (sprint/category URL 기반 필터) */
  issueFilter?:     Record<string, string>;
  settings:         CalendarSettings;
  onSettingsChange: (s: Partial<CalendarSettings>) => void;
}

export function CalendarView({ workspaceSlug, projectId, onIssueClick, issueFilter, settings, onSettingsChange }: Props) {
  const { t } = useTranslation();
  const today  = new Date();
  const todayKey = dateKey(today);

  const [year,         setYear]         = useState(today.getFullYear());
  const [month,        setMonth]        = useState(today.getMonth());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();
  const { perms } = useProjectPerms();
  const canSchedule = !!perms.can_schedule;

  /* ── 백로그 Drawer 상태 — 일정 없는 이슈를 끌어와서 캘린더에 드롭 ── */
  const DRAWER_KEY = `orbitail_cal_drawer_${projectId}`;
  const loadDrawerPrefs = (): { stateIds: string[] | null; meOnly: boolean; open: boolean } => {
    try {
      const raw = localStorage.getItem(DRAWER_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { stateIds: null, meOnly: false, open: false };
  };
  const initialDrawer = useMemo(() => loadDrawerPrefs(), [projectId]);
  const [drawerOpen, setDrawerOpen] = useState(initialDrawer.open);
  const [drawerStateIds, setDrawerStateIds] = useState<Set<string> | null>(
    initialDrawer.stateIds ? new Set(initialDrawer.stateIds) : null,
  );
  const [drawerMeOnly, setDrawerMeOnly] = useState(initialDrawer.meOnly);
  const [drawerStateOpen, setDrawerStateOpen] = useState(false);
  const drawerDragIdRef = useRef<string | null>(null);
  /* 드래그 중 시각 피드백 — 드래그 시작/종료 + 호버 중인 셀 dayKey */
  const [drawerDraggingId, setDrawerDraggingId] = useState<string | null>(null);
  const [drawerDropDayKey, setDrawerDropDayKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(DRAWER_KEY, JSON.stringify({
        stateIds: drawerStateIds ? Array.from(drawerStateIds) : null,
        meOnly: drawerMeOnly,
        open: drawerOpen,
      }));
    } catch {}
  }, [DRAWER_KEY, drawerStateIds, drawerMeOnly, drawerOpen]);


  const pushUndo = useUndoStore((s) => s.push);
  const { refresh, refreshIssue } = useIssueRefresh(workspaceSlug, projectId);

  /* 확장된 이슈/이벤트 id 집합 — chip을 span bar로 확장 표시. 세션 동안만 유지 */
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

  /* 셀에서 이슈 생성 — 다이얼로그 팝업 방식 (기존 인라인 input 제거)
     날짜 클릭 시 해당 날짜를 마감일로 프리필 */
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDefaultDueDate, setCreateDefaultDueDate] = useState<string | undefined>(undefined);
  const openCreateDialog = (dayKey: string) => {
    setCreateDefaultDueDate(dayKey);
    setCreateDialogOpen(true);
  };
  const toggleExpand = (id: string) => {
    setExpandedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  /* 드래그 여부 판정용 — mousedown→mouseup 거리가 3px 이하면 클릭으로 간주 */
  const dragDistRef = useRef(0);

  const [dragState, setDragState] = useState<{
    targetId:     string;
    targetType:   "issue" | "event";
    type:         "start" | "end" | "both" | "due-only";
    initialStart: Date;
    initialDue:   Date;
    startX:       number;
    currentX:     number;
    startY:       number;
    currentY:     number;
    cellWidth:    number;
    rowHeight:    number;
  } | null>(null);

  /* 하위 이슈까지 포함하여 fetch — 부모 이슈 아래 자식 이슈도 캘린더에 표시 */
  const { data: issues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, issueFilter, "with-sub"],
    queryFn:  () => issuesApi.list(workspaceSlug, projectId, { ...issueFilter, include_sub_issues: "true" }),
  });

  /* "항상 확장" 모드: start_date+due_date 있는 모든 이슈를 자동 확장 */
  const effectiveExpanded = useMemo(() => {
    if (!settings.alwaysExpand) return expandedIssues;
    const all = new Set(expandedIssues);
    for (const issue of issues) {
      if (issue.start_date && issue.due_date) all.add(issue.id);
    }
    return all;
  }, [settings.alwaysExpand, expandedIssues, issues]);

  /* 프로젝트 캘린더 이벤트 (이슈 아님) */
  const { data: events = [] } = useQuery({
    queryKey: ["events", workspaceSlug, projectId],
    queryFn: () => projectsApi.events.list(workspaceSlug, projectId),
    enabled: !!settings.showEvents,
  });

  /* 이벤트 다이얼로그 상태 */
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ProjectEvent | null>(null);
  const [eventDefaultDate, setEventDefaultDate] = useState<string | undefined>(undefined);
  const openEventCreate = (dayKey: string) => {
    setEditingEvent(null);
    setEventDefaultDate(dayKey);
    setEventDialogOpen(true);
  };
  const openEventEdit = (evt: ProjectEvent) => {
    setEditingEvent(evt);
    setEventDefaultDate(undefined);
    setEventDialogOpen(true);
  };

  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn:  () => projectsApi.states.list(workspaceSlug, projectId),
  });

  /* drawerStateIds 가 null(첫 진입) 이면 default — backlog/unstarted/started state 들을 자동 선택 */
  useEffect(() => {
    if (drawerStateIds === null && states.length > 0) {
      const defaults = new Set(
        states.filter((s) => ["backlog", "unstarted", "started"].includes(s.group)).map((s) => s.id),
      );
      setDrawerStateIds(defaults);
    }
  }, [states, drawerStateIds]);

  /* 사용자 필터: null=전체, "me"=내 일정, userId=특정 사용자 */
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn:  () => projectsApi.members.list(workspaceSlug, projectId),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Issue> }) =>
      issuesApi.update(workspaceSlug, projectId, id, data),
    onMutate: ({ id, data }) => {
      const issue = issues.find((i) => i.id === id);
      if (!issue) return;
      const prev: Partial<Issue> = {};
      for (const key of Object.keys(data) as (keyof Issue)[]) {
        (prev as any)[key] = (issue as any)[key];
      }
      return { id, prev };
    },
    onSuccess: (_, variables, context) => {
      refresh();
      refreshIssue(variables.id);
      if (context?.prev) {
        pushUndo({
          label: `Calendar: ${Object.keys(variables.data).join(", ")}`,
          undo: async () => {
            await issuesApi.update(workspaceSlug, projectId, context.id, context.prev);
            refresh();
            refreshIssue(context.id);
          },
        });
      }
    },
  });

  /* 이벤트 드래그용 mutation */
  const eventUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProjectEvent> }) =>
      projectsApi.events.update(workspaceSlug, projectId, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events", workspaceSlug, projectId] });
    },
  });

  /* 완료/취소 상태 ID 집합 */
  /* ── 백로그 drawer 표시 대상 — 일정(due_date) 없는 이슈 ── */
  const drawerItems = useMemo(() => {
    return issues
      .filter((i) => !i.is_field)
      .filter((i) => !i.due_date)
      .filter((i) => (drawerStateIds && drawerStateIds.size > 0 ? drawerStateIds.has(i.state) : true))
      .filter((i) => (drawerMeOnly && currentUserId ? (i.assignees ?? []).includes(currentUserId) : true))
      .sort((a, b) => a.sequence_id - b.sequence_id);
  }, [issues, drawerStateIds, drawerMeOnly, currentUserId]);

  /* 드롭 — 카드의 일정(시작/마감) 동일 날짜로 설정 */
  const handleDrawerDrop = (dayKey: string) => {
    if (!canSchedule) return;
    const dragId = drawerDragIdRef.current;
    drawerDragIdRef.current = null;
    if (!dragId) return;
    /* 드래그한 카드의 due_date 만 설정. start_date 도 동일 날짜로 — 기존 날짜 이슈와 동일하게 동작(확장 등) */
    updateMutation.mutate({ id: dragId, data: { start_date: dayKey, due_date: dayKey } });
  };

  const completedStateIds = useMemo(
    () => new Set(states.filter((s) => s.group === "completed" || s.group === "cancelled").map((s) => s.id)),
    [states]
  );

  /* 사용자 필터로 매칭할 ID 결정 — "me"는 현재 로그인 유저 id로 변환 */
  const filterUserId = userFilter === "me" ? currentUserId : userFilter;

  /* 설정 필터 + 드래그 중 가상 날짜 반영 */
  const renderIssues = useMemo(() => {
    const arr = issues.filter((issue) => {
      if (issue.is_field) return false; // 필드는 상태 기반 뷰에서 전역 제외 — 값은 보존
      if (!settings.showCompleted && completedStateIds.has(issue.state)) return false;
      // 캘린더는 날짜가 있는 이슈만 의미가 있음 — 둘 다 없으면 항상 제외
      if (!issue.start_date && !issue.due_date) return false;
      // 사용자 필터: 해당 사용자가 담당자에 포함되어야 함
      if (filterUserId && !(issue.assignees ?? []).includes(filterUserId)) return false;
      return true;
    });

    if (!dragState || dragState.targetType !== "issue") return arr;
    return arr.map((issue) => {
      if (issue.id !== dragState.targetId) return issue;
      /* 좌우(날짜) + 상하(주) 이동을 합산 — 상하는 "both" 이동 시에만 적용
         start/end 리사이즈 시에는 좌우만 사용 (주 경계 건너뛰는 리사이즈는 혼란스러움) */
      const deltaDaysX  = Math.round((dragState.currentX - dragState.startX) / dragState.cellWidth);
      const deltaWeeksY = dragState.rowHeight > 0
        ? Math.round((dragState.currentY - dragState.startY) / dragState.rowHeight)
        : 0;
      const deltaDays = deltaDaysX + deltaWeeksY * 7;
      let renderStart   = new Date(dragState.initialStart);
      let renderDue     = new Date(dragState.initialDue);

      if (dragState.type === "start") {
        renderStart = addDays(renderStart, deltaDays);
        if (renderStart > renderDue) renderStart = new Date(renderDue);
      } else if (dragState.type === "end") {
        renderDue = addDays(renderDue, deltaDays);
        if (renderDue < renderStart) renderDue = new Date(renderStart);
      } else if (dragState.type === "both") {
        renderStart = addDays(renderStart, deltaDays);
        renderDue   = addDays(renderDue, deltaDays);
      } else if (dragState.type === "due-only") {
        /* chip 드래그: due_date만 이동, renderStart는 표시용으로 같이 옮김(실제 저장은 안 함) */
        renderStart = addDays(renderStart, deltaDays);
        renderDue   = addDays(renderDue, deltaDays);
      }
      return { ...issue, start_date: toIso(renderStart), due_date: toIso(renderDue) };
    });
  }, [issues, settings, completedStateIds, dragState, filterUserId]);

  /* 드래그 중 이벤트 가상 날짜 반영 + 사용자 필터.
     "내 일정" 또는 특정 사용자 필터 시 — 글로벌 이벤트(is_global=true)는 항상 표시,
     비글로벌은 본인이 participants에 포함된 경우만 표시. */
  const renderEvents = useMemo(() => {
    if (!settings.showEvents) return [];
    const filtered = filterUserId
      ? events.filter((e) => e.is_global || (e.participants ?? []).includes(filterUserId))
      : events;
    if (!dragState || dragState.targetType !== "event") return filtered;
    return filtered.map((evt) => {
      if (evt.id !== dragState.targetId) return evt;
      const deltaDaysX  = Math.round((dragState.currentX - dragState.startX) / dragState.cellWidth);
      const deltaWeeksY = dragState.rowHeight > 0
        ? Math.round((dragState.currentY - dragState.startY) / dragState.rowHeight)
        : 0;
      const deltaDays = deltaDaysX + deltaWeeksY * 7;
      let renderStart = new Date(dragState.initialStart);
      let renderEnd   = new Date(dragState.initialDue);
      if (dragState.type === "start") {
        renderStart = addDays(renderStart, deltaDays);
        if (renderStart > renderEnd) renderStart = new Date(renderEnd);
      } else if (dragState.type === "end") {
        renderEnd = addDays(renderEnd, deltaDays);
        if (renderEnd < renderStart) renderEnd = new Date(renderStart);
      } else {
        renderStart = addDays(renderStart, deltaDays);
        renderEnd   = addDays(renderEnd, deltaDays);
      }
      return { ...evt, date: toIso(renderStart), end_date: toIso(renderEnd) };
    });
  }, [events, settings.showEvents, dragState, filterUserId]);

  /* 이슈 상태 색상 맵 */
  const stateColorMap = useMemo(
    () => Object.fromEntries(states.map((s) => [s.id, s.color])),
    [states]
  );

  const weeks = useMemo(() => getWeeksInMonth(year, month), [year, month]);

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  /* dragStateRef: mousemove마다 useEffect가 재부착되지 않도록
   * isDragging(boolean)만 deps에 두고, handleUp에서 최신 dragState를 ref로 읽음 */
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;
  const isDragging = dragState !== null;

  /* 마우스 드래그 이벤트 리스너 — [isDragging] deps로 드래그 시작/종료 시에만 재부착 */
  useEffect(() => {
    if (!isDragging) return;

    dragDistRef.current = 0;
    const handleMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (ds) dragDistRef.current = Math.max(dragDistRef.current, Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY));
      setDragState(prev => prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null);
    };

    const handleUp = (e: MouseEvent) => {
      // ref로 최신 dragState를 읽음 (closure 캡처 문제 방지)
      const ds = dragStateRef.current;
      if (!ds) return;
      const deltaDaysX  = Math.round((e.clientX - ds.startX) / ds.cellWidth);
      const deltaWeeksY = ds.rowHeight > 0
        ? Math.round((e.clientY - ds.startY) / ds.rowHeight)
        : 0;
      const deltaDays = deltaDaysX + deltaWeeksY * 7;

      let newStart = new Date(ds.initialStart);
      let newDue   = new Date(ds.initialDue);

      if (ds.type === "start") {
        newStart = addDays(newStart, deltaDays);
        if (newStart > newDue) newStart = new Date(newDue);
      } else if (ds.type === "end") {
        newDue = addDays(newDue, deltaDays);
        if (newDue < newStart) newDue = new Date(newStart);
      } else if (ds.type === "both") {
        newStart = addDays(newStart, deltaDays);
        newDue   = addDays(newDue, deltaDays);
      } else if (ds.type === "due-only") {
        newDue = addDays(newDue, deltaDays);
      }

      /* 주말 숨김 모드: drop 결과가 주말이면 가장 가까운 주중으로 스냅 */
      if (settings.hideWeekends) {
        newStart = snapToWeekday(newStart);
        newDue = snapToWeekday(newDue);
        if (newStart > newDue) newStart = new Date(newDue);
      }

      const targetId = ds.targetId;
      const targetType = ds.targetType;
      const isDueOnly = ds.type === "due-only";
      setDragState(null);
      if (deltaDays !== 0) {
        if (targetType === "event") {
          /* 이벤트: date/end_date 업데이트 */
          eventUpdateMutation.mutate({
            id: targetId,
            data: isDueOnly
              ? { date: toIso(newDue) }
              : { date: toIso(newStart), end_date: toIso(newDue) },
          });
        } else {
          /* 이슈: start_date/due_date 업데이트 */
          updateMutation.mutate({
            id: targetId,
            data: isDueOnly
              ? { due_date: toIso(newDue) }
              : { start_date: toIso(newStart), due_date: toIso(newDue) },
          });
        }
      }
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup",   handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup",   handleUp);
    };
  }, [isDragging, updateMutation, eventUpdateMutation, settings.hideWeekends]);

  /* 오늘이 현재 표시 중인 월에 있는지 → 요일 헤더 컬럼 강조용 */
  const todayColIndex = (year === today.getFullYear() && month === today.getMonth())
    ? today.getDay()
    : -1;

  return (
    <div className="p-3 h-full flex gap-3 overflow-hidden">
      <div className="flex-1 flex flex-col glass rounded-xl border overflow-hidden select-none shadow-sm min-w-0">

        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-0.5">
            <button
              onClick={prevMonth}
              className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <h2 className="text-lg font-semibold w-36 text-center tabular-nums text-foreground">
              {t(MONTH_KEYS[month])} {year}
            </h2>

            <button
              onClick={nextMonth}
              className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <button
              onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
              className="ml-2 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1 rounded-md border border-border hover:bg-muted/40 transition-colors"
            >
              {t("calendar.today")}
            </button>
          </div>

          {/* 사용자 필터 — All / Me / 특정 사용자 */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setUserFilter(null)}
              className={cn(
                "text-xs font-medium px-3 py-1 rounded-md border transition-colors flex items-center gap-1.5",
                userFilter === null
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
              title={t("calendar.filter.all")}
            >
              <Users className="h-3.5 w-3.5" />
              {t("calendar.filter.all")}
            </button>
            <button
              onClick={() => setUserFilter("me")}
              className={cn(
                "text-xs font-medium px-3 py-1 rounded-md border transition-colors flex items-center gap-1.5",
                userFilter === "me"
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
              title={t("calendar.filter.me")}
            >
              <UserIcon className="h-3.5 w-3.5" />
              {t("calendar.filter.me")}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "text-xs font-medium px-3 py-1 rounded-md border transition-colors flex items-center gap-1.5",
                    userFilter && userFilter !== "me"
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  )}
                >
                  {userFilter && userFilter !== "me" ? (
                    (() => {
                      const m = members.find((x) => x.member.id === userFilter);
                      return m ? <><AvatarInitials name={m.member.display_name} avatar={m.member.avatar} size="xs" />{m.member.display_name}</> : t("calendar.filter.user");
                    })()
                  ) : (
                    t("calendar.filter.user")
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                {members.map((m) => (
                  <DropdownMenuItem
                    key={m.member.id}
                    onClick={() => setUserFilter(m.member.id)}
                    className="text-xs gap-2"
                  >
                    <AvatarInitials name={m.member.display_name} avatar={m.member.avatar} size="xs" />
                    {m.member.display_name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* 백로그 Drawer 토글 */}
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            className={cn(
              "h-8 px-2.5 rounded-full flex items-center gap-1.5 text-xs font-medium transition-colors",
              drawerOpen
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            title={t("calendar.drawer.toggle", "이슈 패널")}
          >
            <Inbox className="h-4 w-4" />
            {drawerItems.length > 0 && (
              <span className="text-2xs font-semibold">{drawerItems.length}</span>
            )}
          </button>

          <div className="relative">
            <button
              ref={settingsBtnRef}
              onClick={() => setSettingsOpen((v) => !v)}
              className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center transition-colors",
                settingsOpen
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Settings2 className="h-4 w-4" />
            </button>
            {settingsOpen && (
              <SettingsPanel
                settings={settings}
                onChange={onSettingsChange}
                onClose={() => setSettingsOpen(false)}
                triggerRef={settingsBtnRef}
              />
            )}
          </div>
        </div>

        <div
          className={cn(
            "grid border-b border-border shrink-0",
            settings.hideWeekends ? "grid-cols-5" : "grid-cols-7",
          )}
        >
          {DAY_KEYS.map((key, i) => {
            if (settings.hideWeekends && (i === 0 || i === 6)) return null;
            return (
              <div
                key={key}
                className={cn(
                  "py-2 text-center text-xs font-semibold tracking-wider uppercase transition-colors",
                  // 오늘 요일 컬럼 강조
                  i === todayColIndex
                    ? "text-primary"
                    : i === 0
                      ? "text-rose-500/60"
                      : i === 6
                        ? "text-sky-500/60"
                        : "text-muted-foreground/70"
                )}
              >
                {t(key)}
              </div>
            );
          })}
        </div>

        {/* ── 월간 그리드 — 행은 콘텐츠에 따라 자라고, 컨테이너가 부족하면 페이지 스크롤 ── */}
        <div className="flex-1 flex flex-col overflow-y-auto divide-y divide-border" data-calendar-grid>
          {weeks.map((week, wi) => {
            const weekStart = week[0];
            const weekEnd   = week[6];
            const allBars   = getBarsForWeek(renderIssues, weekStart, weekEnd, effectiveExpanded);
            const allEventBars = settings.showEvents
              ? getEventBarsForWeek(renderEvents, weekStart, weekEnd)
              : [];

            // 이슈 바 레인 수 — 이벤트 바 컨테이너 top 오프셋 계산용
            const issueLanes = allBars.length > 0 ? Math.max(...allBars.map((b) => b.lane)) + 1 : 0;
            const issuesBarsH = issueLanes * (BAR_HEIGHT + BAR_GAP);

            // 각 열(요일)별 실제 bar 높이 — bar가 없는 열은 칩을 최상단에 배치
            const totalCols = settings.hideWeekends ? 5 : 7;
            const colBarH: number[] = new Array(totalCols).fill(0);
            for (const bar of allBars) {
              const rm = settings.hideWeekends
                ? remapBarForWeekdays(bar.colStart, bar.span)
                : { colStart: bar.colStart, span: bar.span };
              if (!rm) continue;
              for (let c = rm.colStart; c < rm.colStart + rm.span; c++) {
                colBarH[c] = Math.max(colBarH[c], (bar.lane + 1) * (BAR_HEIGHT + BAR_GAP));
              }
            }
            for (const bar of allEventBars) {
              const rm = settings.hideWeekends
                ? remapBarForWeekdays(bar.colStart, bar.span)
                : { colStart: bar.colStart, span: bar.span };
              if (!rm) continue;
              for (let c = rm.colStart; c < rm.colStart + rm.span; c++) {
                colBarH[c] = Math.max(colBarH[c], issuesBarsH + (bar.lane + 1) * (BAR_HEIGHT + BAR_GAP));
              }
            }

            /* 셀별 칩 개수를 미리 계산 → 행 minHeight에 반영 (콘텐츠가 많을수록 행이 자람)
               CHIP_H는 폰트 스케일(18px base) + line-height + padding 고려해 넉넉히 */
            const CHIP_H = 34;
            const cellTotalH: number[] = new Array(totalCols).fill(0);
            for (let i = 0; i < week.length; i++) {
              const day = week[i];
              if (settings.hideWeekends && (i === 0 || i === 6)) continue;
              const colIdx = settings.hideWeekends ? i - 1 : i;
              const chipsCount = getChipsForDay(renderIssues, day, effectiveExpanded).length;
              /* +호버 시 나타나는 "이슈/이벤트 추가" 버튼 영역 24px 여유까지 포함 */
              cellTotalH[colIdx] = 36 + (colBarH[colIdx] || 0) + chipsCount * CHIP_H + 24;
            }
            const dynamicMinH = Math.max(120, ...cellTotalH);

            return (
              <div
                key={wi}
                className="relative flex-1"
                data-week-row
                style={{
                  /* 기본은 flex-1 로 컨테이너 높이를 균등 분할 → 화면 꽉 차게.
                     콘텐츠(바 + 칩)가 많아지면 minHeight 가 꽉 차고 컨테이너가 세로 스크롤. */
                  flexBasis: dynamicMinH,
                  minHeight: dynamicMinH,
                }}
              >
                {/* ── 막대 레이어 (absolute 오버레이) — top-9(36px) = 날짜 숫자 영역 높이 ── */}
                {/* pointer-events-none이 컨테이너에 있으므로 개별 바에 pointer-events-auto 필수 */}
                <div className="absolute inset-x-0 top-9 pointer-events-none z-10">
                  {allBars.map((bar) => {
                    const barColor  = stateColorMap[bar.issue.state] ?? "#888";
                    // 주말 숨김 모드면 colStart/span 재매핑 (주말에만 걸친 bar는 스킵)
                    const remapped = settings.hideWeekends
                      ? remapBarForWeekdays(bar.colStart, bar.span)
                      : { colStart: bar.colStart, span: bar.span };
                    if (!remapped) return null;
                    const totalCols = settings.hideWeekends ? 5 : 7;
                    // 이어지는 방향에 따라 모서리 radius 조정
                    const br = bar.continuesBefore
                      ? (bar.continuesAfter ? "0" : "0 5px 5px 0")
                      : (bar.continuesAfter ? "5px 0 0 5px" : "5px");
                    const isDragging = dragState?.targetId === bar.issue.id;

                    return (
                      <div
                        key={bar.issue.id + wi}
                        className="absolute flex items-center overflow-visible pointer-events-auto"
                        style={{
                          left:            `calc(${remapped.colStart} / ${totalCols} * 100% + 3px)`,
                          width:           `calc(${remapped.span} / ${totalCols} * 100% - 6px)`,
                          top:             bar.lane * (BAR_HEIGHT + BAR_GAP),
                          height:          BAR_HEIGHT,
                          backgroundColor: `${barColor}26`, // ≈15% opacity tint 본체
                          borderLeft:      bar.continuesBefore ? "none" : `3px solid ${barColor}`,
                          borderRight:     bar.continuesAfter ? "none" : `1px solid ${barColor}40`,
                          borderTop:       `1px solid ${barColor}40`,
                          borderBottom:    `1px solid ${barColor}40`,
                          borderRadius:    br,
                          zIndex:          isDragging ? 50 : 10,
                          opacity:         isDragging ? 1 : 1,
                          boxShadow:       isDragging ? `0 4px 14px ${barColor}50` : "none",
                          transition:      isDragging ? "none" : "background-color 0.15s",
                        }}
                      >
                        {/* 드래그 핸들: 시작점 — continuesBefore여도 표시 (다른 주에서도 start_date 조절 가능) */}
                        <div
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 z-20 rounded-l-[5px] transition-colors"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                            const visibleCols = settings.hideWeekends ? 5 : 7;
                            const cellW = row ? row.offsetWidth / visibleCols : 100;
                            const rowH = row ? row.offsetHeight : 0;
                            setDragState({
                              targetId:     bar.issue.id,
                              targetType:   "issue",
                              type:         "start",
                              initialStart: parseLocalDate(bar.issue.start_date!),
                              initialDue:   parseLocalDate(bar.issue.due_date!),
                              startX:       e.clientX,
                              currentX:     e.clientX,
                              startY:       e.clientY,
                              currentY:     e.clientY,
                              cellWidth:    cellW,
                              rowHeight:    rowH,
                            });
                          }}
                        />

                        {/* 본문 바 — 클릭: 이슈 열기 / 마우스다운: 전체 이동 드래그 */}
                        <div
                          className="flex-1 h-full flex items-center px-2 cursor-grab active:cursor-grabbing overflow-hidden z-10 whitespace-nowrap hover:brightness-110 group/bar"
                          onClick={() => { if (dragDistRef.current < 4) onIssueClick(bar.issue.id); }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                            const visibleCols = settings.hideWeekends ? 5 : 7;
                            const cellW = row ? row.offsetWidth / visibleCols : 100;
                            const rowH = row ? row.offsetHeight : 0;
                            setDragState({
                              targetId:     bar.issue.id,
                              targetType:   "issue",
                              type:         "both",
                              initialStart: parseLocalDate(bar.issue.start_date!),
                              initialDue:   parseLocalDate(bar.issue.due_date!),
                              startX:       e.clientX,
                              currentX:     e.clientX,
                              startY:       e.clientY,
                              currentY:     e.clientY,
                              cellWidth:    cellW,
                              rowHeight:    rowH,
                            });
                          }}
                        >
                          {/* 이전 주에서 이어지는 경우 제목 생략 */}
                          {!bar.continuesBefore && (
                            <>
                              <span className="text-sm font-medium text-foreground/80 pointer-events-none truncate flex-1">
                                {bar.issue.title}
                              </span>
                              {/* 접기 아이콘 */}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleExpand(bar.issue.id); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="shrink-0 ml-1 p-1 rounded hover:bg-black/10 opacity-60 group-hover/bar:opacity-100 transition-opacity"
                                title={t("calendar.collapseBar")}
                              >
                                <Minimize2 className="h-3.5 w-3.5 text-foreground/60" />
                              </button>
                            </>
                          )}
                        </div>

                        {/* 드래그 핸들: 끝점 — continuesAfter여도 표시 (다른 주에서도 due_date 조절 가능) */}
                        <div
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 z-20 rounded-r-[5px] transition-colors"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                            const visibleCols = settings.hideWeekends ? 5 : 7;
                            const cellW = row ? row.offsetWidth / visibleCols : 100;
                            const rowH = row ? row.offsetHeight : 0;
                            setDragState({
                              targetId:     bar.issue.id,
                              targetType:   "issue",
                              type:         "end",
                              initialStart: parseLocalDate(bar.issue.start_date!),
                              initialDue:   parseLocalDate(bar.issue.due_date!),
                              startX:       e.clientX,
                              currentX:     e.clientX,
                              startY:       e.clientY,
                              currentY:     e.clientY,
                              cellWidth:    cellW,
                              rowHeight:    rowH,
                            });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* ── 이벤트 막대 레이어 — 이슈 바 아래에 배치 ── */}
                {allEventBars.length > 0 && (
                  <div className="absolute inset-x-0 pointer-events-none z-10" style={{ top: 36 + issuesBarsH }}>
                    {allEventBars.map((bar) => {
                      const barColor = bar.event.color;
                      const remapped = settings.hideWeekends
                        ? remapBarForWeekdays(bar.colStart, bar.span)
                        : { colStart: bar.colStart, span: bar.span };
                      if (!remapped) return null;
                      const totalCols = settings.hideWeekends ? 5 : 7;
                      const br = bar.continuesBefore
                        ? (bar.continuesAfter ? "0" : "0 5px 5px 0")
                        : (bar.continuesAfter ? "5px 0 0 5px" : "5px");
                      const isDraggingThis = dragState?.targetId === bar.event.id;

                      return (
                        <div
                          key={`evt-${bar.event.id}-${wi}`}
                          className="absolute flex items-center overflow-visible pointer-events-auto"
                          style={{
                            left:            `calc(${remapped.colStart} / ${totalCols} * 100% + 3px)`,
                            width:           `calc(${remapped.span} / ${totalCols} * 100% - 6px)`,
                            top:             bar.lane * (BAR_HEIGHT + BAR_GAP),
                            height:          BAR_HEIGHT,
                            backgroundColor: barColor,
                            borderRadius:    br,
                            zIndex:          isDraggingThis ? 50 : 10,
                            boxShadow:       isDraggingThis ? `0 4px 14px ${barColor}80` : "none",
                            transition:      isDraggingThis ? "none" : "background-color 0.15s",
                          }}
                        >
                          {/* 리사이즈 핸들: 시작점 */}
                          <div
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 z-20 rounded-l-[5px] transition-colors"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                              const visibleCols = settings.hideWeekends ? 5 : 7;
                              const cellW = row ? row.offsetWidth / visibleCols : 100;
                              const rowH = row ? row.offsetHeight : 0;
                              setDragState({
                                targetId: bar.event.id, targetType: "event", type: "start",
                                initialStart: parseLocalDate(bar.event.date),
                                initialDue:   parseLocalDate(bar.event.end_date ?? bar.event.date),
                                startX: e.clientX, currentX: e.clientX,
                                startY: e.clientY, currentY: e.clientY,
                                cellWidth: cellW, rowHeight: rowH,
                              });
                            }}
                          />
                          {/* 본문 — 클릭: 수정 / 드래그: 전체 이동 */}
                          <div
                            className="flex-1 h-full flex items-center px-2 cursor-grab active:cursor-grabbing overflow-hidden z-10 whitespace-nowrap hover:brightness-110 group/ebar"
                            onClick={() => { if (dragDistRef.current < 4) openEventEdit(bar.event); }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                              const visibleCols = settings.hideWeekends ? 5 : 7;
                              const cellW = row ? row.offsetWidth / visibleCols : 100;
                              const rowH = row ? row.offsetHeight : 0;
                              setDragState({
                                targetId: bar.event.id, targetType: "event", type: "both",
                                initialStart: parseLocalDate(bar.event.date),
                                initialDue:   parseLocalDate(bar.event.end_date ?? bar.event.date),
                                startX: e.clientX, currentX: e.clientX,
                                startY: e.clientY, currentY: e.clientY,
                                cellWidth: cellW, rowHeight: rowH,
                              });
                            }}
                          >
                            {!bar.continuesBefore && (() => {
                              const TypeIcon = EVENT_TYPES[bar.event.event_type]?.icon ?? EVENT_TYPES.other.icon;
                              return (
                                <>
                                  <TypeIcon className="h-3.5 w-3.5 text-white shrink-0" strokeWidth={2.5} />
                                  <span className="text-2xs font-bold text-white pointer-events-none truncate flex-1 ml-1.5">
                                    {bar.event.title}
                                  </span>
                                </>
                              );
                            })()}
                          </div>
                          {/* 리사이즈 핸들: 끝점 */}
                          <div
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 z-20 rounded-r-[5px] transition-colors"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                              const visibleCols = settings.hideWeekends ? 5 : 7;
                              const cellW = row ? row.offsetWidth / visibleCols : 100;
                              const rowH = row ? row.offsetHeight : 0;
                              setDragState({
                                targetId: bar.event.id, targetType: "event", type: "end",
                                initialStart: parseLocalDate(bar.event.date),
                                initialDue:   parseLocalDate(bar.event.end_date ?? bar.event.date),
                                startX: e.clientX, currentX: e.clientX,
                                startY: e.clientY, currentY: e.clientY,
                                cellWidth: cellW, rowHeight: rowH,
                              });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── 일(day) 셀 그리드 — 주말 숨김 시 5일만.
                    h-full 제거: 부모 row는 minHeight만 가짐 → grid가 content 기반으로 자라고
                    row가 grid 높이에 맞춰 늘어남(순환 참조 없음) */}
                <div
                  className={cn(
                    "grid divide-x divide-border min-h-full",
                    settings.hideWeekends ? "grid-cols-5" : "grid-cols-7",
                  )}
                >
                  {week.map((day, di) => {
                    const isCurrentMonth = day.getMonth() === month;
                    const isToday        = dateKey(day) === todayKey;
                    const isWeekend      = di === 0 || di === 6;
                    if (settings.hideWeekends && isWeekend) return null;
                    const chips          = getChipsForDay(renderIssues, day, effectiveExpanded);

                    return (
                      <div
                        key={di}
                        onDragEnter={(e) => {
                          if (!drawerDragIdRef.current || !canSchedule) return;
                          e.preventDefault();
                          setDrawerDropDayKey(dateKey(day));
                        }}
                        onDragOver={(e) => {
                          if (!drawerDragIdRef.current || !canSchedule) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDragLeave={(e) => {
                          /* leave 이벤트가 자식으로 전이될 때 깜빡임 방지 — 정확히 셀을 떠난 경우만 처리 */
                          if (!drawerDragIdRef.current) return;
                          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                          setDrawerDropDayKey((prev) => (prev === dateKey(day) ? null : prev));
                        }}
                        onDrop={(e) => {
                          if (!drawerDragIdRef.current || !canSchedule) return;
                          e.preventDefault();
                          handleDrawerDrop(dateKey(day));
                          setDrawerDropDayKey(null);
                        }}
                        className={cn(
                          "relative flex flex-col group transition-colors hover:bg-accent/40",
                          // 이전/다음 달 날짜: 흐린 배경
                          !isCurrentMonth && "bg-muted/[0.08]",
                          // 오늘: primary tint + ring-inset으로 강조
                          isToday && "bg-primary/[0.08] ring-2 ring-primary/40 ring-inset z-[1]",
                          // 주말: 더 뚜렷한 tint (오늘이 아닐 때만)
                          isWeekend && !isToday && "bg-muted/[0.15]",
                          // drawer 에서 드래그 중인 셀 — 강한 강조
                          drawerDropDayKey === dateKey(day) && "!bg-primary/15 ring-2 ring-primary ring-inset z-[2]",
                          // drawer 드래그 중 모든 셀 — 드롭 가능 표시 (살짝 dashed)
                          drawerDraggingId && drawerDropDayKey !== dateKey(day) && "ring-1 ring-primary/20 ring-inset",
                        )}
                      >
                        {/* 날짜 숫자 영역 — 고정 높이 36px (top-9과 일치) */}
                        <div className="h-9 flex items-start justify-end pt-1.5 pr-1.5 shrink-0">
                          <span
                            className={cn(
                              "w-7 h-7 rounded-full flex items-center justify-center text-xs transition-colors",
                              isToday
                                ? "bg-primary text-primary-foreground font-bold"
                                : !isCurrentMonth
                                  ? "text-muted-foreground/35"
                                  : di === 0
                                    ? "text-rose-500/70 font-medium"
                                    : di === 6
                                      ? "text-sky-500/70 font-medium"
                                      : "text-foreground/75 font-medium"
                            )}
                          >
                            {day.getDate()}
                          </span>
                        </div>

                        {/* 칩 영역 — 해당 열에 bar가 있으면 그 높이만큼 paddingTop, 없으면 0
                            콘텐츠에 따라 자유롭게 자람 → 행이 늘어나며 페이지 스크롤 */}
                        <div
                          className="flex flex-col gap-0.5 px-1 pb-1"
                          style={{
                            paddingTop: (() => {
                              const colIdx = settings.hideWeekends ? di - 1 : di;
                              const h = colBarH[colIdx] || 0;
                              return h > 0 ? h + 2 : 0;
                            })(),
                          }}
                        >
                          {chips.map((issue) => {
                            const chipColor = stateColorMap[issue.state] ?? "#888";
                            /* start_date + due_date 있으면 기간 bar로 확장 가능
                               단일 날짜라도 향후 기간 추가 가능하도록 확장 버튼은 노출 */
                            const canExpand = !!issue.due_date;
                            return (
                              <div
                                key={issue.id}
                                className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing rounded-[3px] pl-2 pr-1 py-1 hover:brightness-110 transition-all group/chip"
                                style={{
                                  backgroundColor: `${chipColor}14`, // ~8% opacity tint
                                  borderLeft: `3px solid ${chipColor}`,
                                  opacity: dragState?.targetId === issue.id ? 0.5 : 1,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (dragDistRef.current < 4) onIssueClick(issue.id);
                                }}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  /* chip 드래그: due_date만 이동 (start_date 있어도 유지).
                                     주 경계 건너편으로 움직이면 위/아래 셀의 같은 요일로 이동 */
                                  const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                                  const visibleCols = settings.hideWeekends ? 5 : 7;
                                  const cellW = row ? row.offsetWidth / visibleCols : 100;
                                  const rowH = row ? row.offsetHeight : 0;
                                  const dueDate = parseLocalDate(issue.due_date!);
                                  setDragState({
                                    targetId:     issue.id,
                                    targetType:   "issue",
                                    type:         "due-only",
                                    initialStart: dueDate, // 사용되지 않지만 타입 만족용
                                    initialDue:   dueDate,
                                    startX:       e.clientX,
                                    currentX:     e.clientX,
                                    startY:       e.clientY,
                                    currentY:     e.clientY,
                                    cellWidth:    cellW,
                                    rowHeight:    rowH,
                                  });
                                }}
                              >
                                {/* 제목 */}
                                <span className="text-sm truncate text-foreground/80 group-hover/chip:text-foreground transition-colors leading-tight flex-1 font-medium">
                                  {issue.title}
                                </span>
                                {/* 확장 아이콘 — 기간이 있는 이슈만, 호버 시 등장 */}
                                {canExpand && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleExpand(issue.id);
                                    }}
                                    className="shrink-0 opacity-50 group-hover/chip:opacity-100 transition-opacity p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary"
                                    title={t("calendar.expandBar")}
                                  >
                                    <Maximize2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })}

                          {/* 추가 버튼들 — 셀 호버 시 등장: 이슈 / 이벤트 */}
                          {isCurrentMonth && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openCreateDialog(dateKey(day)); }}
                                className="flex items-center gap-1 text-2xs text-muted-foreground/70 hover:text-primary px-1.5 py-1 rounded-md hover:bg-primary/10 border border-dashed border-transparent hover:border-primary/30 font-medium"
                                title={t("calendar.addIssueOnDay")}
                              >
                                <Plus className="h-3 w-3" />
                                <span>{t("calendar.addIssue")}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openEventCreate(dateKey(day)); }}
                                className="flex items-center gap-1 text-2xs text-muted-foreground/70 hover:text-purple-500 px-1.5 py-1 rounded-md hover:bg-purple-500/10 border border-dashed border-transparent hover:border-purple-500/30 font-medium"
                                title={t("events.addOnDay")}
                              >
                                <Plus className="h-3 w-3" />
                                <span>{t("events.add")}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* 백로그 Drawer — 일정 없는 이슈를 끌어와서 캘린더 셀로 드롭하면 due_date 설정 */}
      {drawerOpen && (
        <BacklogDrawer
          items={drawerItems}
          states={states}
          drawerStateIds={drawerStateIds}
          setDrawerStateIds={setDrawerStateIds}
          drawerStateOpen={drawerStateOpen}
          setDrawerStateOpen={setDrawerStateOpen}
          meOnly={drawerMeOnly}
          setMeOnly={setDrawerMeOnly}
          onClose={() => setDrawerOpen(false)}
          onDragStart={(id) => { drawerDragIdRef.current = id; setDrawerDraggingId(id); }}
          onDragEnd={() => { drawerDragIdRef.current = null; setDrawerDraggingId(null); setDrawerDropDayKey(null); }}
          draggingId={drawerDraggingId}
          onIssueClick={onIssueClick}
          canSchedule={canSchedule}
        />
      )}

      {/* 이슈 생성 다이얼로그 — 셀 "+ 이슈 추가" 버튼에서 호출, 해당 날짜를 마감일로 프리필 */}
      <IssueCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        states={states}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        defaultDueDate={createDefaultDueDate}
      />
      <EventDialog
        open={eventDialogOpen}
        onOpenChange={setEventDialogOpen}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        event={editingEvent}
        defaultDate={eventDefaultDate}
      />
    </div>
  );
}

/* ── 백로그 Drawer ── */
interface BacklogDrawerProps {
  items: Issue[];
  states: { id: string; name: string; color: string; group: string }[];
  drawerStateIds: Set<string> | null;
  setDrawerStateIds: (s: Set<string> | null) => void;
  drawerStateOpen: boolean;
  setDrawerStateOpen: (v: boolean) => void;
  meOnly: boolean;
  setMeOnly: (v: boolean) => void;
  onClose: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  draggingId: string | null;
  onIssueClick: (id: string) => void;
  canSchedule: boolean;
}

function BacklogDrawer({
  items, states, drawerStateIds, setDrawerStateIds, drawerStateOpen, setDrawerStateOpen,
  meOnly, setMeOnly, onClose, onDragStart, onDragEnd, draggingId, onIssueClick, canSchedule,
}: BacklogDrawerProps) {
  const { t } = useTranslation();
  const stateById = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const s of states) m.set(s.id, { name: s.name, color: s.color });
    return m;
  }, [states]);

  const toggleStateFilter = (sid: string) => {
    setDrawerStateIds((() => {
      const cur = drawerStateIds ?? new Set<string>();
      const next = new Set(cur);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    })());
  };

  return (
    <div className="w-72 shrink-0 flex flex-col rounded-xl border bg-background shadow-sm overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">{t("calendar.drawer.title", "이슈")}</span>
          <span className="text-2xs text-muted-foreground">{items.length}</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/50"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 필터 바 */}
      <div className="px-3 py-2 border-b border-border space-y-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMeOnly(!meOnly)}
            className={cn(
              "text-2xs px-2 py-1 rounded-md border transition-colors flex items-center gap-1",
              meOnly
                ? "bg-primary/10 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <UserIcon className="h-3 w-3" />
            {t("calendar.drawer.meOnly", "내 이슈만")}
          </button>

          <div className="relative flex-1">
            <button
              onClick={() => setDrawerStateOpen(!drawerStateOpen)}
              className="w-full text-2xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-between"
            >
              <span>{t("calendar.drawer.statesFilter", "상태")} · {(drawerStateIds?.size ?? 0)}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {drawerStateOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 w-44 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md p-1">
                {states.map((s) => {
                  const checked = drawerStateIds?.has(s.id) ?? false;
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleStateFilter(s.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1 rounded text-2xs hover:bg-muted/60",
                        checked && "bg-muted/40",
                      )}
                    >
                      <input type="checkbox" checked={checked} readOnly className="h-3 w-3" />
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className="truncate">{s.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* 리스트 */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {items.length === 0 ? (
          <p className="text-2xs text-muted-foreground text-center py-6">
            {t("calendar.drawer.empty", "표시할 이슈가 없습니다")}
          </p>
        ) : items.map((issue) => {
          const st = stateById.get(issue.state);
          const isDragging = draggingId === issue.id;
          return (
            <div
              key={issue.id}
              draggable={canSchedule}
              onDragStart={(e) => {
                if (!canSchedule) { e.preventDefault(); return; }
                onDragStart(issue.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", issue.id);
              }}
              onDragEnd={onDragEnd}
              onClick={() => onIssueClick(issue.id)}
              className={cn(
                "group flex items-start gap-1.5 px-2 py-1.5 rounded-md border text-xs transition-all duration-fast cursor-pointer",
                "border-transparent hover:bg-muted/40 hover:border-border",
                !canSchedule && "cursor-not-allowed opacity-70",
                isDragging && "opacity-30 scale-[0.97]",
              )}
              title={canSchedule ? t("calendar.drawer.dragHint", "드래그해서 캘린더에 놓기") : t("calendar.drawer.noPerm", "일정 수정 권한이 없습니다")}
            >
              {canSchedule && (
                <GripVertical className="h-3 w-3 mt-0.5 text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
              <div className="flex-1 min-w-0">
                <p className="truncate text-foreground/90">{issue.title}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {st && (
                    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
                      {st.name}
                    </span>
                  )}
                  <span className="text-2xs text-muted-foreground/70 font-mono">#{issue.sequence_id}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
