/** 마이 일정 탭 — 본인 이슈 due/시작 + ProjectEvent + PersonalEvent 통합 시간순 리스트. */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Calendar, ListTodo } from "lucide-react";
import { meApi } from "@/api/me";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityGlyph } from "@/components/ui/priority-glyph";
import { formatLongDate } from "@/utils/date-format";
import { useOpenIssue } from "@/hooks/useOpenIssue";
import type { Issue, ProjectEvent, PersonalEvent, Priority } from "@/types";
import { PersonalEventDialog } from "./PersonalEventDialog";

interface UnifiedRow {
  kind: "issue" | "project_event" | "personal";
  id: string;
  date: string;
  title: string;
  color: string;
  priority?: Priority;
  badge?: string;
  href?: string;
  /** 이슈일 때 팝업 오픈에 필요한 컨텍스트 */
  issueContext?: { workspaceSlug: string; projectId: string };
  /** PersonalEvent 클릭 시 편집 다이얼로그 오픈용 원본 데이터 */
  personal?: PersonalEvent;
}

export function MyScheduleTab() {
  const { t } = useTranslation();
  const openIssue = useOpenIssue();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<PersonalEvent | null>(null);

  // 향후 30일 기본 — 시간순 정렬되어 가까운 일정 위에 보이도록.
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

  const { data: issues = [], isLoading: loadingIssues } = useQuery({
    queryKey: ["me", "issues", "schedule"],
    queryFn: () => meApi.issues({}),
  });
  const { data: projEvents = [], isLoading: loadingProj } = useQuery({
    queryKey: ["me", "events", "schedule", today, horizon],
    queryFn: () => meApi.projectEvents({ from: today, to: horizon }),
  });
  const { data: personalEvents = [], isLoading: loadingPersonal } = useQuery({
    queryKey: ["me", "personal-events", "schedule", today, horizon],
    queryFn: () => meApi.personalEvents.list({ from: today, to: horizon }),
  });

  const rows = useMemo<UnifiedRow[]>(() => {
    const out: UnifiedRow[] = [];
    for (const issue of issues as Issue[]) {
      const date = issue.due_date ?? issue.start_date;
      if (!date) continue;
      const ws = issue.workspace_slug;
      out.push({
        kind: "issue",
        id: issue.id,
        date,
        title: issue.title,
        color: issue.state_detail?.color ?? "#9ca3af",
        priority: issue.priority,
        badge: issue.project_identifier
          ? `${issue.project_identifier}-${issue.sequence_id}`
          : undefined,
        href: ws ? `/${ws}/projects/${issue.project}/issues?issue=${issue.id}` : "#",
        issueContext: ws ? { workspaceSlug: ws, projectId: issue.project } : undefined,
      });
    }
    for (const ev of projEvents as ProjectEvent[]) {
      out.push({
        kind: "project_event",
        id: ev.id,
        date: ev.date,
        title: ev.title,
        color: ev.color,
        badge: t(`events.types.${ev.event_type}`, ev.event_type),
        href: ev.project_workspace_slug
          ? `/${ev.project_workspace_slug}/projects/${ev.project}/issues?view=calendar`
          : "#",
      });
    }
    for (const ev of personalEvents) {
      out.push({
        kind: "personal",
        id: ev.id,
        date: ev.date,
        title: ev.title,
        color: ev.color,
        badge: t("me.summary.personal", "개인 일정"),
        personal: ev,
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [issues, projEvents, personalEvents, t]);

  const isLoading = loadingIssues || loadingProj || loadingPersonal;

  // 날짜별 그룹핑
  const byDate = useMemo(() => {
    const m = new Map<string, UnifiedRow[]>();
    for (const r of rows) {
      if (!m.has(r.date)) m.set(r.date, []);
      m.get(r.date)!.push(r);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{t("me.schedule.note", "오늘부터 60일 안의 일정")}</p>
        <Button size="sm" onClick={() => { setEditEvent(null); setDialogOpen(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t("me.calendar.newEvent", "새 일정")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : byDate.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">{t("me.schedule.empty", "예정된 일정이 없습니다.")}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {byDate.map(([date, items]) => (
            <section key={date} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/20">
                <span className="text-sm font-semibold">{formatLongDate(date)}</span>
                <span className="ml-2 text-xs text-muted-foreground">({items.length})</span>
              </div>
              <ul className="divide-y divide-border">
                {items.map((r) => {
                  const inner = (
                    <>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                      {r.kind === "issue"
                        ? <ListTodo className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        : <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      {r.priority && <PriorityGlyph priority={r.priority} size={10} />}
                      <span className="flex-1 text-sm truncate">{r.title}</span>
                      {r.badge && (
                        <span className="text-2xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md font-mono shrink-0">
                          {r.badge}
                        </span>
                      )}
                    </>
                  );
                  if (r.kind === "personal" && r.personal) {
                    return (
                      <li key={`${r.kind}-${r.id}`}>
                        <button
                          type="button"
                          onClick={() => { setEditEvent(r.personal!); setDialogOpen(true); }}
                          className="w-full flex items-center gap-2.5 px-5 py-3 hover:bg-accent/40 transition-colors text-left"
                        >
                          {inner}
                        </button>
                      </li>
                    );
                  }
                  return (
                    <li key={`${r.kind}-${r.id}`}>
                      <Link
                        to={r.href ?? "#"}
                        onClick={(e) => {
                          if (r.kind === "issue" && r.issueContext) {
                            openIssue(e, r.issueContext.workspaceSlug, r.issueContext.projectId, r.id);
                          }
                        }}
                        className="flex items-center gap-2.5 px-5 py-3 hover:bg-accent/40 transition-colors"
                      >
                        {inner}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <PersonalEventDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        event={editEvent}
      />
    </div>
  );
}
