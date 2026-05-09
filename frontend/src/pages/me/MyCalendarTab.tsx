/** 마이 캘린더 탭 — 월 그리드. 본인 이슈(due_date) + ProjectEvent + PersonalEvent 통합. */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { meApi } from "@/api/me";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenIssue } from "@/hooks/useOpenIssue";
import type { Issue, ProjectEvent, PersonalEvent } from "@/types";
import { PersonalEventDialog } from "./PersonalEventDialog";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfMonthGrid(year: number, month: number): Date {
  // month: 0-indexed. 그달 1일이 속한 주의 일요일부터 시작.
  const first = new Date(year, month, 1);
  const offset = first.getDay();
  return new Date(year, month, 1 - offset);
}

type CellItem =
  | { kind: "issue"; id: string; title: string; color: string; href: string; workspaceSlug: string; projectId: string }
  | { kind: "project_event"; id: string; title: string; color: string; href: string }
  | { kind: "personal"; id: string; title: string; color: string; event: PersonalEvent };

/** 주어진 항목이 d 일자에 표시되는지 (시작~종료 범위 포함) */
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

  // 그리드: 6주(=42일) 표시
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
    queryKey: ["me", "issues", "calendar", fromKey, toKey],
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

  // 날짜별 항목 매핑
  const itemsByDate = useMemo(() => {
    const m = new Map<string, CellItem[]>();
    const push = (key: string, item: CellItem) => {
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(item);
    };

    // 이슈 — start_date ~ due_date 범위. 둘 다 없으면 표시 X.
    for (const issue of issues as Issue[]) {
      const start = issue.start_date;
      const end = issue.due_date;
      if (!start && !end) continue;
      const s = start ?? end!;
      const e = end ?? start!;
      for (const day of gridDays) {
        const dk = dateKey(day);
        if (inRange(dk, s, e)) {
          const ws = issue.workspace_slug;
          const href = ws
            ? `/${ws}/projects/${issue.project}/issues?issue=${issue.id}`
            : "#";
          push(dk, {
            kind: "issue",
            id: issue.id,
            title: issue.title,
            color: issue.state_detail?.color ?? "#9ca3af",
            href,
            workspaceSlug: ws ?? "",
            projectId: issue.project,
          });
        }
      }
    }
    // ProjectEvent
    for (const ev of projectEvents as ProjectEvent[]) {
      for (const day of gridDays) {
        const dk = dateKey(day);
        if (inRange(dk, ev.date, ev.end_date)) {
          const wsLink = ev.project_workspace_slug;
          push(dk, {
            kind: "project_event",
            id: ev.id,
            title: ev.title,
            color: ev.color,
            href: wsLink ? `/${wsLink}/projects/${ev.project}/issues?view=calendar` : "#",
          });
        }
      }
    }
    // PersonalEvent
    for (const ev of personalEvents) {
      for (const day of gridDays) {
        const dk = dateKey(day);
        if (inRange(dk, ev.date, ev.end_date)) {
          push(dk, { kind: "personal", id: ev.id, title: ev.title, color: ev.color, event: ev });
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
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        {t("me.calendar.hint", "내가 담당한 이슈의 마감/시작일과 프로젝트 이벤트, 그리고 개인 일정을 한 캘린더에 모아 봅니다. 빈 셀을 누르면 그 날짜에 개인 일정을 추가할 수 있어요.")}
      </p>
      {/* 네비 + 새 일정 */}
      <div className="flex items-center gap-2 mb-3">
        <Button
          variant="outline" size="sm"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-lg font-semibold tabular-nums">{monthLabel}</span>
        <Button
          variant="outline" size="sm"
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
            {t("me.calendar.newEvent", "새 일정")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[640px] rounded-xl" />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b border-border text-sm">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={"px-2 py-2.5 text-center font-medium " + (i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-muted-foreground")}
              >
                {w}
              </div>
            ))}
          </div>
          {/* 6주 셀 */}
          <div className="grid grid-cols-7" style={{ gridTemplateRows: "repeat(6, minmax(160px, 1fr))" }}>
            {gridDays.map((d) => {
              const dk = dateKey(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const items = itemsByDate.get(dk) ?? [];
              const isToday = dk === todayKey;
              return (
                <div
                  key={dk}
                  className={
                    "relative border-r border-b border-border last-of-type:border-r-0 p-2 cursor-pointer hover:bg-accent/30 transition-colors " +
                    (inMonth ? "bg-card" : "bg-muted/20")
                  }
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-item]")) return;
                    openNew(dk);
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={
                      "text-sm tabular-nums " +
                      (isToday ? "bg-primary text-primary-foreground rounded-full px-2 py-0.5 font-semibold" :
                        inMonth ? "text-foreground font-medium" : "text-muted-foreground/50")
                    }>
                      {d.getDate()}
                    </span>
                  </div>
                  <div className="space-y-1 overflow-hidden">
                    {items.slice(0, 5).map((it, idx) => {
                      const content = (
                        <span
                          data-item
                          className="flex items-center gap-1.5 text-xs truncate rounded px-1.5 py-1 cursor-pointer hover:opacity-80 font-medium"
                          style={{ backgroundColor: `${it.color}22`, color: it.color }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: it.color }} />
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
                            {content}
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
                            {content}
                          </Link>
                        );
                      }
                      return (
                        <Link
                          key={`${it.kind}-${it.id}-${idx}`}
                          to={it.href}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {content}
                        </Link>
                      );
                    })}
                    {items.length > 5 && (
                      <span className="text-2xs text-muted-foreground px-1.5">+{items.length - 5}{t("me.calendar.more", "개 더")}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <PersonalEventDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        event={editEvent}
        defaultDate={defaultDate}
      />
    </div>
  );
}
