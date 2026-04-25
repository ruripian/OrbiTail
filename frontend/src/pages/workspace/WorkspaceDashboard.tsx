/**
 * 워크스페이스 홈 — 내 할 일 대시보드
 *
 * 내가 배정된 이슈를 상태/프로젝트 기준으로 그룹핑.
 * 완료/취소 상태는 백엔드에서 제외하여 "해야 할 일"만 표시.
 * 필터: 프로젝트, 우선순위. 그룹: 상태별/프로젝트별 토글.
 */
import { useState, useMemo, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { issuesApi } from "@/api/issues";
import { useAuthStore } from "@/stores/authStore";
import { Circle, ArrowRight, Calendar, SlidersHorizontal, X } from "lucide-react";
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
import { SprintProgressOrbit } from "@/components/ui/orbit-glyph";
import { PriorityGlyph } from "@/components/ui/priority-glyph";
import { useRecentChangesStore } from "@/stores/recentChangesStore";
import { PRIORITY_LIST, PRIORITY_LABEL_KEY } from "@/constants/priority";
import type { Issue, State } from "@/types";

/* ──────────────── 대시보드 필터 영속화 ──────────────── */
type StateGroup = "backlog" | "unstarted" | "started";
const STATE_GROUPS: StateGroup[] = ["backlog", "unstarted", "started"];
const STATE_GROUP_LABEL: Record<StateGroup, string> = {
  backlog: "Backlog",
  unstarted: "To do",
  started: "In progress",
};
const STATE_GROUP_COLOR: Record<StateGroup, string> = {
  backlog: "#94a3b8",
  unstarted: "#64748b",
  started: "#3b82f6",
};

const LS_KEY = "orbitail_dashboard_filters";
interface PersistedFilters {
  priority: string[];
  project: string[];
  stateGroup: StateGroup[];
  groupBy: "state" | "project";
}
function loadFilters(): Partial<PersistedFilters> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveFilters(v: PersistedFilters) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(v));
  } catch {
    /* 저장 실패 무시 */
  }
}

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
  // Phase 3.4 — 5초 동안 strip 표시. selector로 구독해서 만료 시 자동 리렌더.
  const isRecent = useRecentChangesStore((s) => !!s.recent[issue.id]);
  const recentColor = useRecentChangesStore((s) => s.recent[issue.id]?.color);

  return (
    <Link
      to={`/${workspaceSlug}/projects/${issue.project}/issues?issue=${issue.id}`}
      data-recently-changed={isRecent ? "true" : undefined}
      style={isRecent && recentColor ? ({ ["--recent-color" as never]: recentColor } as React.CSSProperties) : undefined}
      className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-accent/50 transition-colors group"
    >
      <span className="text-2xs font-semibold text-muted-foreground shrink-0 bg-muted/60 px-2 py-0.5 rounded-md truncate max-w-[120px]">
        {issue.project_name ?? issue.project_identifier ?? ""}
      </span>
      <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">
        {issue.project_identifier ? `${issue.project_identifier}-${issue.sequence_id}` : `#${issue.sequence_id}`}
      </span>
      <PriorityGlyph priority={issue.priority} size={10} className="shrink-0" />
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
    // 반투명(30% 투과) — 뒤의 궤도 dot 이 비쳐 보이되 blur 없음(blur 걸면 dot 이 흐려져 "뒤로 밀린 느낌" 을 줌)
    <div className="rounded-2xl border border-border bg-card/70 overflow-hidden shadow-sm">
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

  // 세션 간 영속되는 필터 — localStorage
  const [projectFilter, setProjectFilter] = useState<Set<string>>(() => {
    const f = loadFilters();
    return new Set(Array.isArray(f.project) ? f.project : []);
  });
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(() => {
    const f = loadFilters();
    return new Set(Array.isArray(f.priority) ? f.priority : []);
  });
  const [stateGroupFilter, setStateGroupFilter] = useState<Set<StateGroup>>(() => {
    const f = loadFilters();
    return new Set(Array.isArray(f.stateGroup) ? f.stateGroup : []);
  });
  const [groupBy, setGroupBy] = useState<GroupBy>(() => {
    const f = loadFilters();
    return f.groupBy === "project" ? "project" : "state";
  });

  // 필터 변경 시 즉시 저장
  useEffect(() => {
    saveFilters({
      priority: Array.from(priorityFilter),
      project: Array.from(projectFilter),
      stateGroup: Array.from(stateGroupFilter),
      groupBy,
    });
  }, [priorityFilter, projectFilter, stateGroupFilter, groupBy]);

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

  // 필터 적용 — 필드(Field) 이슈는 "내 할 일" 성격이 아니므로 대시보드에서 제외.
  const filtered = useMemo(() => {
    return myIssues.filter((issue) => {
      if (issue.is_field) return false;
      if (projectFilter.size > 0 && !projectFilter.has(issue.project)) return false;
      if (priorityFilter.size > 0 && !priorityFilter.has(issue.priority)) return false;
      if (stateGroupFilter.size > 0) {
        const g = issue.state_detail?.group as StateGroup | undefined;
        if (!g || !stateGroupFilter.has(g)) return false;
      }
      return true;
    });
  }, [myIssues, projectFilter, priorityFilter, stateGroupFilter]);

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
  const hasFilters = projectFilter.size > 0 || priorityFilter.size > 0 || stateGroupFilter.size > 0;

  const toggleSet = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  return (
    <PageTransition className="p-5 sm:p-8 overflow-y-auto h-full relative">
      {/* 궤도 배경 — 모든 콘텐츠 아래.
          size 는 로고 본체 크기(원래 1000). canvasMultiplier 로 SVG 캔버스만 2 배 키워서
          사각형 경계가 viewport 바깥으로 밀려나도록 — 로고 크기는 그대로 유지됨. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
        <OrbiTailOrbit size={1000} strokeW={4} offsetY={-60} position="absolute" idPrefix="home-orb" canvasMultiplier={2.2} />
      </div>

      {/* 인사 섹션 — Phase 3.2 display serif + 3.1 SprintProgressOrbit */}
      <div className="mb-8 relative z-10 flex items-start justify-between gap-6">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-foreground tracking-tight">
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
        {/* 진행 중 비율 시각화 — started / totalCount */}
        {!isLoading && totalCount > 0 && (() => {
          const started = myIssues.filter((i) => (i.state_detail as State | null)?.group === "started").length;
          const ratio = started / totalCount;
          return (
            <div className="hidden sm:flex flex-col items-center text-primary">
              <SprintProgressOrbit ratio={ratio} size={88} label={t("dashboard.assignedCount", { count: totalCount })} />
              <span className="text-2xs uppercase tracking-widest text-muted-foreground mt-1">
                {Math.round(ratio * 100)}% in progress
              </span>
            </div>
          );
        })()}
      </div>

      {/* 필터 바 */}
      {!isLoading && totalCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5 relative z-10">
          {/* 상태 그룹 필터 (backlog/unstarted/started) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={stateGroupFilter.size > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs gap-1.5">
                <SlidersHorizontal className="h-3 w-3" />
                {t("dashboard.filterByState", "상태")}
                {stateGroupFilter.size > 0 && (
                  <span className="ml-0.5 bg-primary-foreground/20 text-primary-foreground px-1.5 py-0.5 rounded-full text-[10px]">
                    {stateGroupFilter.size}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {STATE_GROUPS.map((g) => (
                <DropdownMenuCheckboxItem
                  key={g}
                  checked={stateGroupFilter.has(g)}
                  // 선택 시 드롭다운 유지 — 여러 개 빠르게 토글할 수 있도록
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => setStateGroupFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(g)) next.delete(g); else next.add(g);
                    return next;
                  })}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATE_GROUP_COLOR[g] }} />
                    {STATE_GROUP_LABEL[g]}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              {/* 선택 해제 — 드롭다운 맨 아래에 배치해 아이템 위치가 바뀌지 않도록 */}
              {stateGroupFilter.size > 0 && (
                <>
                  <div className="h-px bg-border/50 my-1" />
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setStateGroupFilter(new Set()); }}
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-2xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-md transition-colors"
                  >
                    <X className="h-3 w-3" />
                    <span>선택 해제 ({stateGroupFilter.size})</span>
                  </button>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

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
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => setPriorityFilter(toggleSet(priorityFilter, p))}
                >
                  <span className="flex items-center gap-2">
                    <PriorityGlyph priority={p} size={10} />
                    {t(PRIORITY_LABEL_KEY[p])}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              {priorityFilter.size > 0 && (
                <>
                  <div className="h-px bg-border/50 my-1" />
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setPriorityFilter(new Set()); }}
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-2xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-md transition-colors"
                  >
                    <X className="h-3 w-3" />
                    <span>선택 해제 ({priorityFilter.size})</span>
                  </button>
                </>
              )}
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
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => setProjectFilter(toggleSet(projectFilter, p.id))}
                  >
                    {p.name}
                  </DropdownMenuCheckboxItem>
                ))}
                {projectFilter.size > 0 && (
                  <>
                    <div className="h-px bg-border/50 my-1" />
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setProjectFilter(new Set()); }}
                      className="w-full flex items-center gap-1.5 px-2 py-1 text-2xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-md transition-colors"
                    >
                      <X className="h-3 w-3" />
                      <span>선택 해제 ({projectFilter.size})</span>
                    </button>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* 필터 초기화 */}
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { setProjectFilter(new Set()); setPriorityFilter(new Set()); setStateGroupFilter(new Set()); }}>
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
              <div className="rounded-2xl border border-dashed border-border bg-card/70 p-12 text-center">
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
            <aside className="rounded-2xl border border-border bg-card/70 shadow-sm overflow-hidden xl:sticky xl:top-4">
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
