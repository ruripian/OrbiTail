/** 마이 캘린더 탭 — 본인 이슈(due/start) + 본인 참여 ProjectEvent + 개인 PersonalEvent 통합.
 *
 * 시각/기능을 가능한 한 프로젝트 CalendarView 패턴과 맞춤:
 *   - 같은 EventType 아이콘/색 (EVENT_TYPES)
 *   - 같은 EventDialog (mode="me" 로 PersonalEvent endpoint 사용)
 *   - 셀 호버 시 "+ 새 이벤트" 버튼
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon } from "lucide-react";
import { meApi } from "@/api/me";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenIssue } from "@/hooks/useOpenIssue";
import { EVENT_TYPES } from "@/constants/event-types";
import { EventDialog } from "@/components/events/EventDialog";
import type { Issue, ProjectEvent, PersonalEvent } from "@/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfMonthGrid(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  return new Date(year, month, 1 - first.getDay());
}

type CellItem =
  | {
      kind: "issue";
      id: string;
      title: string;
      color: string;
      workspaceSlug: string;
      projectId: string;
      href: string;
    }
  | {
      kind: "project_event";
      id: string;
      title: string;
      color: string;
      eventType: ProjectEvent["event_type"];
      href: string;
    }
  | {
      kind: "personal";
      id: string;
      title: string;
      color: string;
      eventType: PersonalEvent["event_type"];
      event: PersonalEvent;
    };

function inRange(d: string, start: string, end: string | null): boolean {
  const e = end ?? start;
  return start <= d && d <= e;
}

export function MyCalendarTab() {
  const { t } = useTranslation();
  const openIssue = useOpenIssue();
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<PersonalEvent | null>(null);
  const [defaultDate, setDefaultDate] = useState<string>("");
  const [hoverCell, setHoverCell] = useState<string | null>(null);

  const gridStart = useMemo(() => startOfMonthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const gridDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }
    return days;
  }, [gridStart]);

  const fromKey = dateKey(gridDays[0]);
  const toKey = dateKey(gridDays[gridDays.length - 1]);

  const { data: issues = [], isLoading: loadingIssues } = useQuery({
    queryKey: ["me", "issues", "calendar"],
    queryFn: () => meApi.issues({ include_completed: true }),
  });
  const { data: projectEvents = [], isLoading: loadingProj } = useQuery({
    queryKey: ["me", "events", "calendar", fromKey, toKey],
    queryFn: () => meApi.projectEvents({ from: fromKey, to: toKey }),
  });
  const { data: personalEvents = [], isLoading: loadingPersonal } = useQuery({
    queryKey: ["me", "personal-events", fromKey, toKey],
    queryFn: () => meApi.personalEvents.list({ from: fromKey, to: toKey }),
  });

  const itemsByDate = useMemo(() => {
    const m = new Map<string, CellItem[]>();
    const push = (key: string, item: CellItem) => {
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(item);
    };

    for (const issue of issues as Issue[]) {
      const start = issue.start_date;
      const end = issue.due_date;
      if (!start && !end) continue;
      const s = start ?? end!;
      const e = end ?? start!;
      for (const day of gridDays) {
        const dk = dateKey(day);
        if (inRange(dk, s, e)) {
          const ws = issue.workspace_slug ?? "";
          push(dk, {
            kind: "issue",
            id: issue.id,
            title: issue.title,
            color: issue.state_detail?.color ?? "#9ca3af",
            workspaceSlug: ws,
            projectId: issue.project,
            href: ws ? `/${ws}/projects/${issue.project}/issues?issue=${issue.id}` : "#",
          });
        }
      }
    }
    for (const ev of projectEvents as ProjectEvent[]) {
      for (const day of gridDays) {
        const dk = dateKey(day);
        if (inRange(dk, ev.date, ev.end_date)) {
          push(dk, {
            kind: "project_event",
            id: ev.id,
            title: ev.title,
            color: ev.color,
            eventType: ev.event_type,
            href: ev.project_workspace_slug ? `/${ev.project_workspace_slug}/projects/${ev.project}/issues?view=calendar` : "#",
          });
        }
      }
    }
    for (const ev of personalEvents) {
      for (const day of gridDays) {
        const dk = dateKey(day);
        if (inRange(dk, ev.date, ev.end_date)) {
          push(dk, {
            kind: "personal",
            id: ev.id,
            title: ev.title,
            color: ev.color,
            eventType: ev.event_type,
            event: ev,
          });
        }
      }
    }
    return m;
  }, [issues, projectEvents, personalEvents, gridDays]);

  const monthLabel = `${cursor.getFullYear()}.${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const todayKey = dateKey(today);
  const isLoading = loadingIssues || loadingProj || loadingPersonal;

  const openNew = (date?: string) => {
    setEditEvent(null);
    setDefaultDate(date ?? todayKey);
    setDialogOpen(true);
  };
  const openEdit = (ev: PersonalEvent) => {
    setEditEvent(ev);
    setDialogOpen(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 네비 + 새 이벤트 — 컴팩트한 단일 라인 */}
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <Button
          variant="ghost" size="sm"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-base font-semibold tabular-nums px-1">{monthLabel}</span>
        <Button
          variant="ghost" size="sm"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>
          {t("me.calendar.today", "오늘")}
        </Button>
        <div className="ml-auto">
          <Button size="sm" onClick={() => openNew()}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("me.calendar.newEvent", "새 이벤트")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="flex-1 rounded-md" />
      ) : (
        <div className="flex-1 rounded-md border border-border bg-card overflow-hidden flex flex-col">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b border-border text-sm shrink-0">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={"px-2 py-2 text-center font-medium " + (i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-muted-foreground")}
              >
                {w}
              </div>
            ))}
          </div>
          {/* 6주 셀 — 화면 꽉 차게 균등 분할 */}
          <div className="grid grid-cols-7 flex-1" style={{ gridTemplateRows: "repeat(6, minmax(0, 1fr))" }}>
            {gridDays.map((d) => {
              const dk = dateKey(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const items = itemsByDate.get(dk) ?? [];
              const isToday = dk === todayKey;
              const isHover = hoverCell === dk;
              return (
                <div
                  key={dk}
                  className={
                    "relative border-r border-b border-border last-of-type:border-r-0 px-1.5 py-1 cursor-pointer hover:bg-accent/30 transition-colors min-h-0 overflow-hidden " +
                    (inMonth ? "bg-card" : "bg-muted/20")
                  }
                  onMouseEnter={() => setHoverCell(dk)}
                  onMouseLeave={() => setHoverCell((c) => (c === dk ? null : c))}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-item]")) return;
                    openNew(dk);
                  }}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={
                      "text-xs tabular-nums " +
                      (isToday ? "bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 font-semibold" :
                        inMonth ? "text-foreground font-medium" : "text-muted-foreground/50")
                    }>
                      {d.getDate()}
                    </span>
                    {/* 호버 시 "+ 새 이벤트" 버튼 — 그 날짜에 PersonalEvent 빠르게 추가 */}
                    {isHover && inMonth && (
                      <button
                        type="button"
                        data-item
                        onClick={(e) => { e.stopPropagation(); openNew(dk); }}
                        className="opacity-70 hover:opacity-100 transition-opacity rounded p-0.5 hover:bg-muted"
                        title={t("me.calendar.newEvent", "새 이벤트")}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="space-y-0.5 overflow-hidden">
                    {items.slice(0, 4).map((it, idx) => {
                      const Icon = it.kind === "issue"
                        ? CalendarIcon
                        : EVENT_TYPES[it.eventType]?.icon ?? CalendarIcon;
                      const chip = (
                        <span
                          data-item
                          className="flex items-center gap-1 text-2xs truncate rounded px-1 py-0.5 cursor-pointer hover:opacity-80 font-medium leading-tight"
                          style={{ backgroundColor: `${it.color}22`, color: it.color }}
                        >
                          <Icon className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{it.title}</span>
                        </span>
                      );
                      if (it.kind === "personal") {
                        return (
                          <button
                            key={`${it.kind}-${it.id}-${idx}`}
                            type="button"
                            className="w-full text-left"
                            onClick={(e) => { e.stopPropagation(); openEdit(it.event); }}
                          >
                            {chip}
                          </button>
                        );
                      }
                      if (it.kind === "issue") {
                        return (
                          <Link
                            key={`${it.kind}-${it.id}-${idx}`}
                            to={it.href}
                            onClick={(e) => {
                              e.stopPropagation();
                              openIssue(e, it.workspaceSlug, it.projectId, it.id);
                            }}
                          >
                            {chip}
                          </Link>
                        );
                      }
                      return (
                        <Link
                          key={`${it.kind}-${it.id}-${idx}`}
                          to={it.href}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {chip}
                        </Link>
                      );
                    })}
                    {items.length > 4 && (
                      <span className="text-2xs text-muted-foreground/80 px-1">+{items.length - 4}{t("me.calendar.more", "개 더")}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <EventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode="me"
        event={editEvent}
        defaultDate={defaultDate}
      />
    </div>
  );
}
