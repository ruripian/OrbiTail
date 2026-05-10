/**
 * CalendarMonth — 월 그리드 캘린더 시각 + 드래그 시스템 (재사용 컴포넌트).
 *
 * 책임:
 *   - 주(week) 행 렌더 + bar overlay + chip + day cell
 *   - 드래그/리사이즈 상태 관리 + mousemove/mouseup
 *   - chip ↔ bar 확장 토글 (외부 expandedIds state)
 *   - drawer drop 지원 (optional)
 *
 * 비책임 (호출자 = CalendarView/MyCalendarTab 가 담당):
 *   - 데이터 fetch (issues/events/states)
 *   - mutation 실행 (onIssueUpdate/onEventUpdate 콜백만 받음)
 *   - 사용자/멤버 필터 (이미 필터된 issues 가 들어옴)
 *   - settings 값 저장/UI (settings prop 으로 받음)
 *   - drawer 자체 (drawerProps optional 로 drop hooks 만)
 *
 * Why: 마이 페이지(다중 워크스페이스 통합) + 프로젝트 페이지가 같은 시각/드래그 동작 공유.
 *      (feedback_reuse_project_components — mode prop 분기 대신 데이터 prop 추출 패턴)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, Minimize2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { EVENT_TYPES } from "@/constants/event-types";
import type { Issue, ProjectEvent } from "@/types";

/* ── 헬퍼 ───────────────────────────────────────────── */

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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 해당 월의 주 배열 — 일~토 7일씩, 마지막 주 비어있는 칸도 채움 */
function getWeeksInMonth(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());
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
  const lastWeek = weeks[weeks.length - 1];
  while (lastWeek.length < 7) {
    lastWeek.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return weeks;
}

interface WeekBar {
  issue: Issue;
  colStart: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}
function getBarsForWeek(issues: Issue[], weekStart: Date, weekEnd: Date, expandedIds: Set<string>): WeekBar[] {
  const raw: Omit<WeekBar, "lane">[] = [];
  for (const issue of issues) {
    if (!expandedIds.has(issue.id)) continue;
    if (!issue.start_date && !issue.due_date) continue;
    const start = parseLocalDate(issue.start_date ?? issue.due_date!);
    const end = parseLocalDate(issue.due_date ?? issue.start_date!);
    if (end < weekStart || start > weekEnd) continue;
    const barStart = start < weekStart ? new Date(weekStart) : start;
    const barEnd = end > weekEnd ? new Date(weekEnd) : end;
    const colStart = barStart.getDay();
    const colEnd = barEnd.getDay();
    const span = Math.max(colEnd - colStart + 1, 1);
    raw.push({
      issue,
      colStart,
      span,
      continuesBefore: start < weekStart,
      continuesAfter: end > weekEnd,
    });
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

function getChipsForDay(issues: Issue[], day: Date, expandedIds: Set<string>): Issue[] {
  const key = dateKey(day);
  return issues.filter((i) => !expandedIds.has(i.id) && i.due_date === key);
}

interface EventWeekBar {
  event: ProjectEvent;
  colStart: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}
function getEventBarsForWeek(events: ProjectEvent[], weekStart: Date, weekEnd: Date): EventWeekBar[] {
  const raw: Omit<EventWeekBar, "lane">[] = [];
  for (const evt of events) {
    if (!evt.date) continue;
    const start = parseLocalDate(evt.date);
    const end = evt.end_date ? parseLocalDate(evt.end_date) : start;
    if (end < weekStart || start > weekEnd) continue;
    const barStart = start < weekStart ? new Date(weekStart) : start;
    const barEnd = end > weekEnd ? new Date(weekEnd) : end;
    const colStart = barStart.getDay();
    const colEnd = barEnd.getDay();
    const span = Math.max(colEnd - colStart + 1, 1);
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

/** 주말 숨김 모드 — 월~금(1~5) 범위로 colStart/span 재매핑. 주말에만 걸친 bar 는 null */
function remapBarForWeekdays(colStart: number, span: number): { colStart: number; span: number } | null {
  const origEnd = colStart + span;
  const weekdayStart = Math.max(colStart, 1);
  const weekdayEnd = Math.min(origEnd, 6);
  if (weekdayStart >= weekdayEnd) return null;
  return { colStart: weekdayStart - 1, span: weekdayEnd - weekdayStart };
}

/** 주말이면 가장 가까운 주중으로 스냅 (주말 숨김 모드 drop 시) */
function snapToWeekday(d: Date): Date {
  const day = d.getDay();
  if (day === 0) return addDays(d, 1);
  if (day === 6) return addDays(d, -1);
  return d;
}

const DAY_KEYS = ["calendar.sun", "calendar.mon", "calendar.tue", "calendar.wed", "calendar.thu", "calendar.fri", "calendar.sat"] as const;
const BAR_HEIGHT = 30;
const BAR_GAP = 3;

/* ── Props ──────────────────────────────────────────── */

export interface CalendarMonthSettings {
  hideWeekends: boolean;
  showEvents: boolean;
  alwaysExpand: boolean;
}

export interface CalendarMonthProps {
  /** 표시 년/월 (외부 컨트롤) */
  year: number;
  month: number;

  /** 이미 사용자/완료 등 필터된 이슈 */
  issues: Issue[];
  /** 이미 필터된 이벤트 (showEvents 가 false 면 빈 배열로 넘기거나 그대로) */
  events: ProjectEvent[];

  /** 이슈 상태 ID → 색상 매핑 */
  stateColorMap: Record<string, string>;

  /** 시각 설정 — 외부 state */
  settings: CalendarMonthSettings;

  /** 확장 상태 — 외부 state (chip ↔ bar 토글) */
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;

  /** 일정 변경 권한 — false 면 드래그/리사이즈 비활성 */
  canSchedule: boolean;

  /** 액션 콜백 — 호출자가 적절한 mutation 실행 */
  onIssueClick: (id: string) => void;
  onIssueUpdate: (id: string, data: Partial<Issue>) => void;
  onEventUpdate: (id: string, data: Partial<ProjectEvent>) => void;
  /** 셀 호버 시 "+ 이슈" 버튼 — undefined 면 버튼 숨김 (마이 페이지) */
  onIssueCreate?: (dayKey: string) => void;
  /** 셀 호버 시 "+ 이벤트" 버튼 */
  onEventCreate?: (dayKey: string) => void;
  /** 이벤트 bar 클릭 시 편집 다이얼로그 */
  onEventEdit: (event: ProjectEvent) => void;

  /** 외부 drawer 에서 드래그된 이슈를 셀에 drop — undefined 면 drop zone 비활성 */
  drawerDragIdRef?: React.MutableRefObject<string | null>;
  drawerDraggingId?: string | null;
  drawerDropDayKey?: string | null;
  onDrawerDropDayKeyChange?: (key: string | null) => void;
  onDrawerDrop?: (dayKey: string) => void;

  /** 마이 페이지 등 다중 프로젝트 통합 뷰에서 — projectId → 색 매핑.
   *  주어지면 bar 외곽선/chip 우측 점이 프로젝트 색으로 표시됨. 단일 프로젝트 뷰에선 undefined. */
  projectColorMap?: Record<string, string>;
}

/* ── 컴포넌트 ──────────────────────────────────────────── */

export function CalendarMonth({
  year, month,
  issues, events, stateColorMap, settings,
  expandedIds, onToggleExpand,
  canSchedule,
  onIssueClick, onIssueUpdate, onEventUpdate,
  onIssueCreate, onEventCreate, onEventEdit,
  drawerDragIdRef, drawerDraggingId, drawerDropDayKey, onDrawerDropDayKeyChange, onDrawerDrop,
  projectColorMap,
}: CalendarMonthProps) {
  const { t } = useTranslation();
  const today = new Date();
  const todayKey = dateKey(today);

  /* "항상 확장" 모드면 start+due 있는 이슈를 자동 확장 */
  const effectiveExpanded = useMemo(() => {
    if (!settings.alwaysExpand) return expandedIds;
    const all = new Set(expandedIds);
    for (const issue of issues) {
      if (issue.start_date && issue.due_date) all.add(issue.id);
    }
    return all;
  }, [settings.alwaysExpand, expandedIds, issues]);

  /* ── 드래그 상태 ───────────────────────────────────────── */
  const dragDistRef = useRef(0);
  const [dragState, setDragState] = useState<{
    targetId: string;
    targetType: "issue" | "event";
    type: "start" | "end" | "both" | "due-only";
    initialStart: Date;
    initialDue: Date;
    startX: number;
    currentX: number;
    startY: number;
    currentY: number;
    cellWidth: number;
    rowHeight: number;
  } | null>(null);

  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;
  const isDragging = dragState !== null;

  /* 콜백/설정을 ref 에 보관 — useEffect 가 isDragging 토글 시에만 재부착되도록 */
  const onIssueUpdateRef = useRef(onIssueUpdate);
  onIssueUpdateRef.current = onIssueUpdate;
  const onEventUpdateRef = useRef(onEventUpdate);
  onEventUpdateRef.current = onEventUpdate;
  const hideWeekendsRef = useRef(settings.hideWeekends);
  hideWeekendsRef.current = settings.hideWeekends;

  useEffect(() => {
    if (!isDragging) return;
    dragDistRef.current = 0;
    const handleMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (ds) {
        dragDistRef.current = Math.max(
          dragDistRef.current,
          Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY),
        );
      }
      setDragState((prev) => (prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null));
    };
    const handleUp = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      const deltaDaysX = Math.round((e.clientX - ds.startX) / ds.cellWidth);
      const deltaWeeksY = ds.rowHeight > 0 ? Math.round((e.clientY - ds.startY) / ds.rowHeight) : 0;
      const deltaDays = deltaDaysX + deltaWeeksY * 7;
      let newStart = new Date(ds.initialStart);
      let newDue = new Date(ds.initialDue);
      if (ds.type === "start") {
        newStart = addDays(newStart, deltaDays);
        if (newStart > newDue) newStart = new Date(newDue);
      } else if (ds.type === "end") {
        newDue = addDays(newDue, deltaDays);
        if (newDue < newStart) newDue = new Date(newStart);
      } else if (ds.type === "both") {
        newStart = addDays(newStart, deltaDays);
        newDue = addDays(newDue, deltaDays);
      } else if (ds.type === "due-only") {
        newDue = addDays(newDue, deltaDays);
      }
      if (hideWeekendsRef.current) {
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
          onEventUpdateRef.current(targetId, isDueOnly ? { date: toIso(newDue) } : { date: toIso(newStart), end_date: toIso(newDue) });
        } else {
          onIssueUpdateRef.current(targetId, isDueOnly ? { due_date: toIso(newDue) } : { start_date: toIso(newStart), due_date: toIso(newDue) });
        }
      }
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging]);

  /* 드래그 미리보기 — 표시할 issues/events 의 start/due 를 가상으로 변경 */
  const renderIssues = useMemo(() => {
    if (!dragState || dragState.targetType !== "issue") return issues;
    return issues.map((issue) => {
      if (issue.id !== dragState.targetId) return issue;
      const deltaDaysX = Math.round((dragState.currentX - dragState.startX) / dragState.cellWidth);
      const deltaWeeksY = dragState.rowHeight > 0 ? Math.round((dragState.currentY - dragState.startY) / dragState.rowHeight) : 0;
      const deltaDays = deltaDaysX + deltaWeeksY * 7;
      let renderStart = new Date(dragState.initialStart);
      let renderDue = new Date(dragState.initialDue);
      if (dragState.type === "start") {
        renderStart = addDays(renderStart, deltaDays);
        if (renderStart > renderDue) renderStart = new Date(renderDue);
      } else if (dragState.type === "end") {
        renderDue = addDays(renderDue, deltaDays);
        if (renderDue < renderStart) renderDue = new Date(renderStart);
      } else if (dragState.type === "both") {
        renderStart = addDays(renderStart, deltaDays);
        renderDue = addDays(renderDue, deltaDays);
      } else if (dragState.type === "due-only") {
        renderStart = addDays(renderStart, deltaDays);
        renderDue = addDays(renderDue, deltaDays);
      }
      return { ...issue, start_date: toIso(renderStart), due_date: toIso(renderDue) };
    });
  }, [issues, dragState]);

  const renderEvents = useMemo(() => {
    if (!settings.showEvents) return [];
    if (!dragState || dragState.targetType !== "event") return events;
    return events.map((evt) => {
      if (evt.id !== dragState.targetId) return evt;
      const deltaDaysX = Math.round((dragState.currentX - dragState.startX) / dragState.cellWidth);
      const deltaWeeksY = dragState.rowHeight > 0 ? Math.round((dragState.currentY - dragState.startY) / dragState.rowHeight) : 0;
      const deltaDays = deltaDaysX + deltaWeeksY * 7;
      let renderStart = new Date(dragState.initialStart);
      let renderEnd = new Date(dragState.initialDue);
      if (dragState.type === "start") {
        renderStart = addDays(renderStart, deltaDays);
        if (renderStart > renderEnd) renderStart = new Date(renderEnd);
      } else if (dragState.type === "end") {
        renderEnd = addDays(renderEnd, deltaDays);
        if (renderEnd < renderStart) renderEnd = new Date(renderStart);
      } else {
        renderStart = addDays(renderStart, deltaDays);
        renderEnd = addDays(renderEnd, deltaDays);
      }
      return { ...evt, date: toIso(renderStart), end_date: toIso(renderEnd) };
    });
  }, [events, settings.showEvents, dragState]);

  const weeks = useMemo(() => getWeeksInMonth(year, month), [year, month]);

  /* 오늘이 표시 중인 월에 있으면 요일 헤더 강조 */
  const todayColIndex = (year === today.getFullYear() && month === today.getMonth()) ? today.getDay() : -1;

  /** drawer drop 이 활성화된 셀? — drawerDropDayKey === dateKey(day) */
  const isDrawerDropActive = !!drawerDragIdRef && !!onDrawerDrop;

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      {/* 요일 헤더 */}
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

      {/* 월간 그리드 */}
      <div className="flex-1 flex flex-col overflow-y-auto divide-y divide-border" data-calendar-grid>
        {weeks.map((week, wi) => {
          const weekStart = week[0];
          const weekEnd = week[6];
          const allBars = getBarsForWeek(renderIssues, weekStart, weekEnd, effectiveExpanded);
          const allEventBars = settings.showEvents ? getEventBarsForWeek(renderEvents, weekStart, weekEnd) : [];

          const issueLanes = allBars.length > 0 ? Math.max(...allBars.map((b) => b.lane)) + 1 : 0;
          const issuesBarsH = issueLanes * (BAR_HEIGHT + BAR_GAP);

          const totalCols = settings.hideWeekends ? 5 : 7;
          const colBarH: number[] = new Array(totalCols).fill(0);
          for (const bar of allBars) {
            const rm = settings.hideWeekends ? remapBarForWeekdays(bar.colStart, bar.span) : { colStart: bar.colStart, span: bar.span };
            if (!rm) continue;
            for (let c = rm.colStart; c < rm.colStart + rm.span; c++) {
              colBarH[c] = Math.max(colBarH[c], (bar.lane + 1) * (BAR_HEIGHT + BAR_GAP));
            }
          }
          for (const bar of allEventBars) {
            const rm = settings.hideWeekends ? remapBarForWeekdays(bar.colStart, bar.span) : { colStart: bar.colStart, span: bar.span };
            if (!rm) continue;
            for (let c = rm.colStart; c < rm.colStart + rm.span; c++) {
              colBarH[c] = Math.max(colBarH[c], issuesBarsH + (bar.lane + 1) * (BAR_HEIGHT + BAR_GAP));
            }
          }

          /* 행 minHeight — chip + bar 합계로 계산. 콘텐츠가 많으면 행이 늘어나며 페이지 스크롤 */
          const CHIP_H = 34;
          const cellTotalH: number[] = new Array(totalCols).fill(0);
          for (let i = 0; i < week.length; i++) {
            const day = week[i];
            if (settings.hideWeekends && (i === 0 || i === 6)) continue;
            const colIdx = settings.hideWeekends ? i - 1 : i;
            const chipsCount = getChipsForDay(renderIssues, day, effectiveExpanded).length;
            cellTotalH[colIdx] = 36 + (colBarH[colIdx] || 0) + chipsCount * CHIP_H + 24;
          }
          const dynamicMinH = Math.max(120, ...cellTotalH);

          return (
            <div
              key={wi}
              className="relative flex-1"
              data-week-row
              style={{
                flexBasis: dynamicMinH,
                minHeight: dynamicMinH,
              }}
            >
              {/* ── 이슈 bar 레이어 ── */}
              <div className="absolute inset-x-0 top-9 pointer-events-none z-10">
                {allBars.map((bar) => {
                  const barColor = stateColorMap[bar.issue.state] ?? "#888";
                  /* 마이 페이지 등 통합 뷰: 외곽선을 프로젝트 색으로 표시. 단일 프로젝트 뷰는 기존 옅은 state 색 */
                  const projColor = projectColorMap?.[bar.issue.project];
                  const accentColor = projColor ?? `${barColor}40`;
                  const accentWidth = projColor ? "2px" : "1px";
                  const remapped = settings.hideWeekends ? remapBarForWeekdays(bar.colStart, bar.span) : { colStart: bar.colStart, span: bar.span };
                  if (!remapped) return null;
                  const visibleCols = settings.hideWeekends ? 5 : 7;
                  const br = bar.continuesBefore
                    ? (bar.continuesAfter ? "0" : "0 5px 5px 0")
                    : (bar.continuesAfter ? "5px 0 0 5px" : "5px");
                  const isDraggingThis = dragState?.targetId === bar.issue.id;

                  return (
                    <div
                      key={bar.issue.id + wi}
                      className="absolute flex items-center overflow-visible pointer-events-auto"
                      style={{
                        left: `calc(${remapped.colStart} / ${visibleCols} * 100% + 3px)`,
                        width: `calc(${remapped.span} / ${visibleCols} * 100% - 6px)`,
                        top: bar.lane * (BAR_HEIGHT + BAR_GAP),
                        height: BAR_HEIGHT,
                        backgroundColor: `${barColor}26`,
                        borderLeft: bar.continuesBefore ? "none" : `3px solid ${barColor}`,
                        borderRight: bar.continuesAfter ? "none" : `${accentWidth} solid ${accentColor}`,
                        borderTop: `${accentWidth} solid ${accentColor}`,
                        borderBottom: `${accentWidth} solid ${accentColor}`,
                        borderRadius: br,
                        zIndex: isDraggingThis ? 50 : 10,
                        boxShadow: isDraggingThis ? `0 4px 14px ${barColor}50` : "none",
                        transition: isDraggingThis ? "none" : "background-color 0.15s",
                      }}
                      title={projColor && bar.issue.project_name ? bar.issue.project_name : undefined}
                    >
                      {/* 좌측 핸들 */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 z-20 rounded-l-[5px] transition-colors"
                        onMouseDown={(e) => {
                          if (!canSchedule) return;
                          e.stopPropagation();
                          const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                          const cellW = row ? row.offsetWidth / visibleCols : 100;
                          const rowH = row ? row.offsetHeight : 0;
                          setDragState({
                            targetId: bar.issue.id, targetType: "issue", type: "start",
                            initialStart: parseLocalDate(bar.issue.start_date!),
                            initialDue: parseLocalDate(bar.issue.due_date!),
                            startX: e.clientX, currentX: e.clientX,
                            startY: e.clientY, currentY: e.clientY,
                            cellWidth: cellW, rowHeight: rowH,
                          });
                        }}
                      />
                      {/* 본체 — 클릭=열기, mousedown=이동 */}
                      <div
                        className={cn("flex-1 h-full flex items-center px-2 overflow-hidden z-10 whitespace-nowrap hover:brightness-110 group/bar",
                          canSchedule ? "cursor-grab active:cursor-grabbing" : "cursor-pointer")}
                        onClick={() => { if (dragDistRef.current < 4) onIssueClick(bar.issue.id); }}
                        onMouseDown={(e) => {
                          if (!canSchedule) return;
                          e.stopPropagation();
                          const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                          const cellW = row ? row.offsetWidth / visibleCols : 100;
                          const rowH = row ? row.offsetHeight : 0;
                          setDragState({
                            targetId: bar.issue.id, targetType: "issue", type: "both",
                            initialStart: parseLocalDate(bar.issue.start_date!),
                            initialDue: parseLocalDate(bar.issue.due_date!),
                            startX: e.clientX, currentX: e.clientX,
                            startY: e.clientY, currentY: e.clientY,
                            cellWidth: cellW, rowHeight: rowH,
                          });
                        }}
                      >
                        {!bar.continuesBefore && (
                          <>
                            <span className="text-sm font-medium text-foreground/80 pointer-events-none truncate flex-1">
                              {bar.issue.title}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onToggleExpand(bar.issue.id); }}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="shrink-0 ml-1 p-1 rounded hover:bg-black/10 opacity-60 group-hover/bar:opacity-100 transition-opacity"
                              title={t("calendar.collapseBar", "접기")}
                            >
                              <Minimize2 className="h-3.5 w-3.5 text-foreground/60" />
                            </button>
                          </>
                        )}
                      </div>
                      {/* 우측 핸들 */}
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 z-20 rounded-r-[5px] transition-colors"
                        onMouseDown={(e) => {
                          if (!canSchedule) return;
                          e.stopPropagation();
                          const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                          const cellW = row ? row.offsetWidth / visibleCols : 100;
                          const rowH = row ? row.offsetHeight : 0;
                          setDragState({
                            targetId: bar.issue.id, targetType: "issue", type: "end",
                            initialStart: parseLocalDate(bar.issue.start_date!),
                            initialDue: parseLocalDate(bar.issue.due_date!),
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

              {/* ── 이벤트 bar 레이어 — 이슈 바 아래 배치 ── */}
              {allEventBars.length > 0 && (
                <div className="absolute inset-x-0 pointer-events-none z-10" style={{ top: 36 + issuesBarsH }}>
                  {allEventBars.map((bar) => {
                    const barColor = bar.event.color;
                    /* 마이 페이지: 이벤트도 프로젝트 외곽선 (PersonalEvent 는 project_id="" 라 자동 무시) */
                    const projColor = bar.event.project ? projectColorMap?.[bar.event.project] : undefined;
                    const remapped = settings.hideWeekends ? remapBarForWeekdays(bar.colStart, bar.span) : { colStart: bar.colStart, span: bar.span };
                    if (!remapped) return null;
                    const visibleCols = settings.hideWeekends ? 5 : 7;
                    const br = bar.continuesBefore
                      ? (bar.continuesAfter ? "0" : "0 5px 5px 0")
                      : (bar.continuesAfter ? "5px 0 0 5px" : "5px");
                    const isDraggingThis = dragState?.targetId === bar.event.id;

                    return (
                      <div
                        key={`evt-${bar.event.id}-${wi}`}
                        className="absolute flex items-center overflow-visible pointer-events-auto"
                        style={{
                          left: `calc(${remapped.colStart} / ${visibleCols} * 100% + 3px)`,
                          width: `calc(${remapped.span} / ${visibleCols} * 100% - 6px)`,
                          top: bar.lane * (BAR_HEIGHT + BAR_GAP),
                          height: BAR_HEIGHT,
                          backgroundColor: barColor,
                          /* 이벤트 본체는 색이 진해서 외곽선이 잘 보이려면 box-shadow 로 띄움 */
                          boxShadow: isDraggingThis
                            ? `0 4px 14px ${barColor}80`
                            : projColor ? `0 0 0 2px ${projColor}` : "none",
                          borderRadius: br,
                          zIndex: isDraggingThis ? 50 : 10,
                          transition: isDraggingThis ? "none" : "background-color 0.15s",
                        }}
                        title={projColor && bar.event.project_name ? bar.event.project_name : undefined}
                      >
                        <div
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 z-20 rounded-l-[5px] transition-colors"
                          onMouseDown={(e) => {
                            if (!canSchedule) return;
                            e.stopPropagation();
                            const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                            const cellW = row ? row.offsetWidth / visibleCols : 100;
                            const rowH = row ? row.offsetHeight : 0;
                            setDragState({
                              targetId: bar.event.id, targetType: "event", type: "start",
                              initialStart: parseLocalDate(bar.event.date),
                              initialDue: parseLocalDate(bar.event.end_date ?? bar.event.date),
                              startX: e.clientX, currentX: e.clientX,
                              startY: e.clientY, currentY: e.clientY,
                              cellWidth: cellW, rowHeight: rowH,
                            });
                          }}
                        />
                        <div
                          className={cn("flex-1 h-full flex items-center px-2 overflow-hidden z-10 whitespace-nowrap hover:brightness-110 group/ebar",
                            canSchedule ? "cursor-grab active:cursor-grabbing" : "cursor-pointer")}
                          onClick={() => { if (dragDistRef.current < 4) onEventEdit(bar.event); }}
                          onMouseDown={(e) => {
                            if (!canSchedule) return;
                            e.stopPropagation();
                            const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                            const cellW = row ? row.offsetWidth / visibleCols : 100;
                            const rowH = row ? row.offsetHeight : 0;
                            setDragState({
                              targetId: bar.event.id, targetType: "event", type: "both",
                              initialStart: parseLocalDate(bar.event.date),
                              initialDue: parseLocalDate(bar.event.end_date ?? bar.event.date),
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
                        <div
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 z-20 rounded-r-[5px] transition-colors"
                          onMouseDown={(e) => {
                            if (!canSchedule) return;
                            e.stopPropagation();
                            const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                            const cellW = row ? row.offsetWidth / visibleCols : 100;
                            const rowH = row ? row.offsetHeight : 0;
                            setDragState({
                              targetId: bar.event.id, targetType: "event", type: "end",
                              initialStart: parseLocalDate(bar.event.date),
                              initialDue: parseLocalDate(bar.event.end_date ?? bar.event.date),
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

              {/* ── 일(day) 셀 그리드 ── */}
              <div
                className={cn(
                  "grid divide-x divide-border min-h-full",
                  settings.hideWeekends ? "grid-cols-5" : "grid-cols-7",
                )}
              >
                {week.map((day, di) => {
                  const isCurrentMonth = day.getMonth() === month;
                  const isToday = dateKey(day) === todayKey;
                  const isWeekend = di === 0 || di === 6;
                  if (settings.hideWeekends && isWeekend) return null;
                  const chips = getChipsForDay(renderIssues, day, effectiveExpanded);

                  return (
                    <div
                      key={di}
                      onDragEnter={(e) => {
                        if (!isDrawerDropActive || !drawerDragIdRef!.current || !canSchedule) return;
                        e.preventDefault();
                        onDrawerDropDayKeyChange?.(dateKey(day));
                      }}
                      onDragOver={(e) => {
                        if (!isDrawerDropActive || !drawerDragIdRef!.current || !canSchedule) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDragLeave={(e) => {
                        if (!isDrawerDropActive || !drawerDragIdRef!.current) return;
                        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                        if (drawerDropDayKey === dateKey(day)) onDrawerDropDayKeyChange?.(null);
                      }}
                      onDrop={(e) => {
                        if (!isDrawerDropActive || !drawerDragIdRef!.current || !canSchedule) return;
                        e.preventDefault();
                        onDrawerDrop?.(dateKey(day));
                        onDrawerDropDayKeyChange?.(null);
                      }}
                      className={cn(
                        "relative flex flex-col group transition-colors hover:bg-accent/40",
                        !isCurrentMonth && "bg-muted/[0.08]",
                        /* 오늘은 셀 배경 tint 만 — 숫자 자체에 bg-primary 강조가 이미 있어 ring 불필요.
                           ring 은 셀 grid border 와 겹쳐 정렬이 어긋나 보였음. */
                        isToday && "bg-primary/[0.08]",
                        isWeekend && !isToday && "bg-muted/[0.15]",
                        drawerDropDayKey === dateKey(day) && "!bg-primary/15 ring-2 ring-primary ring-inset z-[2]",
                        drawerDraggingId && drawerDropDayKey !== dateKey(day) && "ring-1 ring-primary/20 ring-inset",
                      )}
                    >
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
                          const projColor = projectColorMap?.[issue.project];
                          const canExpand = !!issue.due_date;
                          return (
                            <div
                              key={issue.id}
                              className={cn(
                                "flex items-center gap-1.5 rounded-[3px] pl-2 pr-1 py-1 hover:brightness-110 transition-all group/chip",
                                canSchedule ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                              )}
                              style={{
                                backgroundColor: `${chipColor}14`,
                                borderLeft: `3px solid ${chipColor}`,
                                /* 마이 페이지: 우측 보더로 프로젝트 색 표시 */
                                borderRight: projColor ? `2px solid ${projColor}` : "none",
                                opacity: dragState?.targetId === issue.id ? 0.5 : 1,
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (dragDistRef.current < 4) onIssueClick(issue.id);
                              }}
                              onMouseDown={(e) => {
                                if (!canSchedule) return;
                                e.stopPropagation();
                                const row = e.currentTarget.closest("[data-week-row]") as HTMLElement | null;
                                const visibleCols = settings.hideWeekends ? 5 : 7;
                                const cellW = row ? row.offsetWidth / visibleCols : 100;
                                const rowH = row ? row.offsetHeight : 0;
                                const dueDate = parseLocalDate(issue.due_date!);
                                setDragState({
                                  targetId: issue.id, targetType: "issue", type: "due-only",
                                  initialStart: dueDate, initialDue: dueDate,
                                  startX: e.clientX, currentX: e.clientX,
                                  startY: e.clientY, currentY: e.clientY,
                                  cellWidth: cellW, rowHeight: rowH,
                                });
                              }}
                            >
                              <span className="text-sm truncate text-foreground/80 group-hover/chip:text-foreground transition-colors leading-tight flex-1 font-medium">
                                {issue.title}
                              </span>
                              {canExpand && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onToggleExpand(issue.id); }}
                                  className="shrink-0 opacity-50 group-hover/chip:opacity-100 transition-opacity p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary"
                                  title={t("calendar.expandBar", "확장")}
                                >
                                  <Maximize2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {/* 셀 호버 시 추가 버튼 — 콜백 있을 때만 노출 */}
                        {isCurrentMonth && (onIssueCreate || onEventCreate) && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {onIssueCreate && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onIssueCreate(dateKey(day)); }}
                                className="flex items-center gap-1 text-2xs text-muted-foreground/70 hover:text-primary px-1.5 py-1 rounded-md hover:bg-primary/10 border border-dashed border-transparent hover:border-primary/30 font-medium"
                                title={t("calendar.addIssueOnDay", "이슈 추가")}
                              >
                                <Plus className="h-3 w-3" />
                                <span>{t("calendar.addIssue", "이슈")}</span>
                              </button>
                            )}
                            {onEventCreate && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onEventCreate(dateKey(day)); }}
                                className="flex items-center gap-1 text-2xs text-muted-foreground/70 hover:text-purple-500 px-1.5 py-1 rounded-md hover:bg-purple-500/10 border border-dashed border-transparent hover:border-purple-500/30 font-medium"
                                title={t("events.addOnDay", "이벤트 추가")}
                              >
                                <Plus className="h-3 w-3" />
                                <span>{t("events.add", "이벤트")}</span>
                              </button>
                            )}
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
  );
}
