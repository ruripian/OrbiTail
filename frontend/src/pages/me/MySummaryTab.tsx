/** 마이 페이지 종합 탭 — 카드 4개 + 우선순위/프로젝트 분포 + 다가오는 일정 5개.
 * ws-scoped — 현재 워크스페이스 한정. */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Calendar, AlertTriangle, ListTodo, CalendarRange } from "lucide-react";
import { meApi } from "@/api/me";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityGlyph } from "@/components/ui/priority-glyph";
import { PRIORITY_LABEL_KEY } from "@/constants/priority";
import { formatLongDate } from "@/utils/date-format";
import type { Priority } from "@/types";

function StatCard({ icon: Icon, label, value, accent }: {
  icon: typeof Calendar;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4" style={{ color: accent }} />
      </div>
      <span className="font-display text-3xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function MySummaryTab() {
  const { t } = useTranslation();
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();

  /* 글로벌 staleTime(60s) 우회 — 마운트마다 강제 refetch 로 항상 최신 데이터 표시 */
  const { data: summary, isLoading } = useQuery({
    queryKey: ["me", "summary", workspaceSlug],
    queryFn: () => meApi.summary(workspaceSlug),
    enabled: !!workspaceSlug,
    refetchOnMount: "always",
  });

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const { data: upcomingEvents = [] } = useQuery({
    queryKey: ["me", "events", "upcoming", workspaceSlug, today, weekEnd],
    queryFn: () => meApi.projectEvents(workspaceSlug, { from: today, to: weekEnd }),
    enabled: !!workspaceSlug,
    refetchOnMount: "always",
  });
  const { data: upcomingPersonal = [] } = useQuery({
    queryKey: ["me", "personal-events", "upcoming", workspaceSlug, today, weekEnd],
    queryFn: () => meApi.personalEvents.list(workspaceSlug, { from: today, to: weekEnd }),
    enabled: !!workspaceSlug,
    refetchOnMount: "always",
  });

  if (isLoading || !summary) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    );
  }

  const upcomingMerged = [
    ...upcomingPersonal.map((e) => ({
      kind: "personal" as const, id: e.id, title: e.title, date: e.date,
      color: e.color, label: t("me.summary.personal", "개인 일정"),
    })),
    ...upcomingEvents.map((e) => ({
      kind: "project" as const, id: e.id, title: e.title, date: e.date,
      color: e.color, label: t(`events.types.${e.event_type}`, e.event_type),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  const totalByPriority = summary.by_priority.reduce((s, r) => s + r.count, 0) || 1;

  return (
    <div className="space-y-6">
      {/* 4 stat 카드 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={ListTodo}      label={t("me.summary.active",     "활성 이슈")}       value={summary.active_count}  accent="#3b82f6" />
        <StatCard icon={Calendar}      label={t("me.summary.dueToday",   "오늘 마감")}       value={summary.due_today}     accent="#f59e0b" />
        <StatCard icon={CalendarRange} label={t("me.summary.dueThisWeek","이번 주 마감")}    value={summary.due_this_week} accent="#8b5cf6" />
        <StatCard icon={AlertTriangle} label={t("me.summary.overdue",    "지연")}           value={summary.overdue}       accent="#ef4444" />
      </div>

      {/* 분포 + 다가오는 일정 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 우선순위 분포 */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-3">{t("me.summary.priorityDist", "우선순위 분포")}</h2>
          {summary.by_priority.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("me.summary.empty", "활성 이슈 없음")}</p>
          ) : (
            <div className="space-y-2.5">
              {summary.by_priority.map((row) => {
                const pct = (row.count / totalByPriority) * 100;
                return (
                  <div key={row.priority} className="flex items-center gap-3">
                    <span className="inline-flex shrink-0 w-20 items-center gap-1.5">
                      <PriorityGlyph priority={row.priority as Priority} size={10} />
                      <span className="text-xs">{t(PRIORITY_LABEL_KEY[row.priority as Priority] ?? row.priority)}</span>
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="shrink-0 text-xs font-mono tabular-nums w-8 text-right">{row.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 프로젝트별 분포 */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-3">{t("me.summary.projectDist", "프로젝트 분포")}</h2>
          {summary.by_project.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("me.summary.empty", "활성 이슈 없음")}</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {summary.by_project.map((row) => (
                <Link
                  key={row.project_id ?? "none"}
                  to={row.workspace_slug && row.project_id
                    ? `/${row.workspace_slug}/projects/${row.project_id}/issues`
                    : "#"}
                  className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent/50 transition-colors"
                >
                  <span className="text-2xs font-semibold text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md font-mono">
                    {row.project_identifier ?? "—"}
                  </span>
                  <span className="flex-1 text-xs truncate">{row.project_name ?? t("common.unknown", "이름 없음")}</span>
                  <span className="text-xs font-mono tabular-nums">{row.count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 다가오는 일정 */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">{t("me.summary.upcoming", "다가오는 일정 (7일)")}</h2>
        {upcomingMerged.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("me.summary.upcomingEmpty", "예정된 일정이 없습니다")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {upcomingMerged.map((e) => (
              <li key={`${e.kind}-${e.id}`} className="flex items-center gap-3 py-2.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
                <span className="text-xs text-muted-foreground shrink-0 w-28">{formatLongDate(e.date)}</span>
                <span className="flex-1 text-sm truncate">{e.title}</span>
                <span className="text-2xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md shrink-0">
                  {e.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
