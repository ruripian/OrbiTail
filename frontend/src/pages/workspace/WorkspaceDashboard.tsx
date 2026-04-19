/**
 * 워크스페이스 홈 — 내 할 일 대시보드
 *
 * 내가 배정된 이슈를 상태/프로젝트 기준으로 그룹핑.
 * 완료/취소 상태는 백엔드에서 제외하여 "해야 할 일"만 표시.
 * 필터: 프로젝트, 우선순위. 그룹: 상태별/프로젝트별 토글.
 */
import { useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { issuesApi } from "@/api/issues";
import { useAuthStore } from "@/stores/authStore";
import { Circle, ArrowRight, Calendar, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageTransition } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { OrbiTailOrbit } from "@/components/auth/OrbiTailOrbit";
import { PRIORITY_COLOR, PRIORITY_LIST, PRIORITY_LABEL_KEY } from "@/constants/priority";
import type { Issue, State } from "@/types";

/* ──────────────── 유틸 ──────────────── */

function getGreetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "dashboard.morning";
  if (hour < 18) return "dashboard.afternoon";
  return "dashboard.evening";
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/* ──────────────── 그룹 타입 ──────────────── */

type GroupBy = "state" | "project";

interface IssueGroup {
  key: string;
  label: string;
  color: string;
  issues: Issue[];
}

/* ──────────────── 이슈 행 ──────────────── */

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (d: string) => {
    const [, m, dd] = d.split("-");
    return `${parseInt(m)}/${parseInt(dd)}`;
  };
  if (start && end && start !== end) return `${fmt(start)} ~ ${fmt(end)}`;
  return fmt(start ?? end!);
}

function IssueRow({ issue, workspaceSlug }: { issue: Issue; workspaceSlug: string }) {
  const dateRange = formatDateRange(issue.start_date, issue.due_date);

  return (
    <Link
      to={`/${workspaceSlug}/projects/${issue.project}/issues?issue=${issue.id}`}
      className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-accent/50 transition-colors group"
    >
      <span className="text-2xs font-semibold text-muted-foreground shrink-0 bg-muted/60 px-2 py-0.5 rounded-md truncate max-w-[120px]">
        {issue.project_name ?? issue.project_identifier ?? ""}
      </span>
      <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">
        {issue.project_identifier ? `${issue.project_identifier}-${issue.sequence_id}` : `#${issue.sequence_id}`}
      </span>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_COLOR[issue.priority] ?? "#9ca3af" }} />
      <span className="flex-1 truncate text-sm text-foreground group-hover:text-primary transition-colors font-medium">
        {issue.title}
      </span>
      {dateRange && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 hidden sm:flex">
          <Calendar className="h-3 w-3" />
          {dateRange}
        </span>
      )}
    </Link>
  );
}

/* ──────────────── 그룹 섹션 ──────────────── */

function GroupSection({ g, workspaceSlug }: { g: IssueGroup; workspaceSlug: string }) {
  return (
    <div className="rounded-2xl border border-border glass overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
        <Circle className="h-4 w-4 shrink-0" style={{ color: g.color, fill: g.color }} />
        <h2 className="text-base font-semibold flex-1">{g.label}</h2>
        <span className="text-sm font-mono text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">
          {g.issues.length}
        </span>
      </div>
      <div className="divide-y divide-border">
        {g.issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} workspaceSlug={workspaceSlug} />
        ))}
      </div>
    </div>
  );
}

/* ──────────────── 로딩 스켈레톤 ──────────────── */

function HomeSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-5 w-48" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border p-5 space-y-3">
          <Skeleton className="h-6 w-40" />
          {Array.from({ length: 2 }).map((_, j) => (
            <Skeleton key={j} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ──────────────── 메인 컴포넌트 ──────────────── */

export function WorkspaceDashboard() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const user = useAuthStore((s) => s.user);

  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>("state");

  /* 내 할 일 (완료/취소 제외, 상태 순서대로) */
  const { data: myIssues = [], isLoading } = useQuery({
    queryKey: ["my-issues", workspaceSlug],
    queryFn: () => issuesApi.myIssues(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  /* 최근 이슈 */
  const { data: recentIssues = [] } = useQuery({
    queryKey: ["recent-issues", workspaceSlug],
    queryFn: () => issuesApi.recentByWorkspace(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  // 사용 가능한 프로젝트 목록
  const availableProjects = useMemo(() => {
    const m = new Map<string, string>();
    for (const issue of myIssues) {
      if (issue.project && !m.has(issue.project))
        m.set(issue.project, issue.project_name ?? issue.project_identifier ?? issue.project);
    }
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [myIssues]);

  // 필터 적용
  const filtered = useMemo(() => {
    return myIssues.filter((issue) => {
      if (projectFilter.size > 0 && !projectFilter.has(issue.project)) return false;
      if (priorityFilter.size > 0 && !priorityFilter.has(issue.priority)) return false;
      return true;
    });
  }, [myIssues, projectFilter, priorityFilter]);

  // 그룹핑
  const groups = useMemo((): IssueGroup[] => {
    const map = new Map<string, IssueGroup>();
    for (const issue of filtered) {
      let key: string, label: string, color: string;
      if (groupBy === "state") {
        const sd = issue.state_detail as State | null;
        key = sd?.id ?? "__none__";
        label = sd?.name ?? "Unassigned";
        color = sd?.color ?? "#9ca3af";
      } else {
        key = issue.project;
        label = issue.project_name ?? issue.project_identifier ?? issue.project;
        color = "#6366f1";
      }
      if (!map.has(key)) map.set(key, { key, label, color, issues: [] });
      map.get(key)!.issues.push(issue);
    }
    return Array.from(map.values());
  }, [filtered, groupBy]);

  const totalCount = myIssues.length;
  const hasFilters = projectFilter.size > 0 || priorityFilter.size > 0;

  const toggleSet = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  return (
    <PageTransition className="p-5 sm:p-8 overflow-y-auto h-full relative">
      <div className="absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        <OrbiTailOrbit size={1000} strokeW={4} offsetY={-60} position="absolute" idPrefix="home-orb" />
      </div>

      {/* 인사 섹션 */}
      <div className="mb-8 relative z-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
          {t(getGreetingKey())}, <span className="text-primary">{user?.display_name ?? t("dashboard.there")}</span>
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          {formatDate()} · {formatTime()}
          {!isLoading && totalCount > 0 && (
            <span className="ml-3 text-foreground font-medium">
              · {t("dashboard.assignedCount", { count: totalCount })}
            </span>
          )}
        </p>
      </div>

      {/* 필터 바 */}
      {!isLoading && totalCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5 relative z-10">
          {/* 우선순위 필터 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={priorityFilter.size > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs gap-1.5">
                <SlidersHorizontal className="h-3 w-3" />
                {t("dashboard.filterByPriority")}
                {priorityFilter.size > 0 && (
                  <span className="ml-0.5 bg-primary-foreground/20 text-primary-foreground px-1.5 py-0.5 rounded-full text-[10px]">
                    {priorityFilter.size}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              {PRIORITY_LIST.map((p) => (
                <DropdownMenuCheckboxItem
                  key={p}
                  checked={priorityFilter.has(p)}
                  onCheckedChange={() => setPriorityFilter(toggleSet(priorityFilter, p))}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_COLOR[p] }} />
                    {t(PRIORITY_LABEL_KEY[p])}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 프로젝트 필터 */}
          {availableProjects.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={projectFilter.size > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs">
                  {t("dashboard.filterByProject")}
                  {projectFilter.size > 0 && (
                    <span className="ml-0.5 bg-primary-foreground/20 text-primary-foreground px-1.5 py-0.5 rounded-full text-[10px]">
                      {projectFilter.size}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {availableProjects.map((p) => (
                  <DropdownMenuCheckboxItem
                    key={p.id}
                    checked={projectFilter.has(p.id)}
                    onCheckedChange={() => setProjectFilter(toggleSet(projectFilter, p.id))}
                  >
                    {p.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* 필터 초기화 */}
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { setProjectFilter(new Set()); setPriorityFilter(new Set()); }}>
              {t("dashboard.filterAll")}
            </Button>
          )}

          {/* 그룹 기준 토글 */}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant={groupBy === "state" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setGroupBy("state")}
            >
              {t("dashboard.groupByState")}
            </Button>
            <Button
              variant={groupBy === "project" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setGroupBy("project")}
            >
              {t("dashboard.groupByProject")}
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <HomeSkeleton />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-6 xl:items-start relative z-10">
          {/* 좌측: 내 할 일 */}
          <div className="space-y-5 min-w-0">
            {groups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-12 text-center">
                <p className="text-lg text-muted-foreground">
                  {hasFilters ? t("dashboard.noMatchingIssues") : t("dashboard.allClear")}
                </p>
                {!hasFilters && (
                  <p className="text-sm text-muted-foreground mt-2">{t("dashboard.allClearHint")}</p>
                )}
              </div>
            ) : (
              groups.map((g) => (
                <GroupSection key={g.key} g={g} workspaceSlug={workspaceSlug!} />
              ))
            )}
          </div>

          {/* 우측: 최근 이슈 */}
          {recentIssues.length > 0 && (
            <aside className="rounded-2xl border border-border glass overflow-hidden xl:sticky xl:top-4">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-base font-semibold">{t("dashboard.recentIssues")}</h2>
              </div>
              <div className="divide-y divide-border">
                {recentIssues.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} workspaceSlug={workspaceSlug!} />
                ))}
              </div>
              <div className="px-5 py-3 border-t border-border">
                <Link
                  to={`/${workspaceSlug}/discover`}
                  className="flex items-center justify-center gap-1 text-sm text-primary hover:underline"
                >
                  {t("dashboard.viewAll")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </aside>
          )}
        </div>
      )}

    </PageTransition>
  );
}
