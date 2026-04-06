/**
 * 워크스페이스 홈 — 내 할 일 대시보드
 *
 * 내가 배정된 이슈를 **프로젝트 설정의 실제 상태(state)** 기준으로 그룹핑.
 * 완료/취소 상태는 백엔드에서 제외하여 "해야 할 일"만 표시.
 * 상태 색상은 프로젝트 설정에서 지정한 색상 그대로 사용.
 */
import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { issuesApi } from "@/api/issues";
import { useAuthStore } from "@/stores/authStore";
import { Circle, ArrowRight, Calendar } from "lucide-react";
import { PageTransition } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { OrbiTailOrbit } from "@/components/auth/OrbiTailOrbit";
import type { Issue, State } from "@/types";

/* ──────────────── 유틸 ──────────────── */

function getGreetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "dashboard.morning";
  if (hour < 18) return "dashboard.afternoon";
  return "dashboard.evening";
}

/* 날짜 유틸 — 공용 유틸 래핑 (현재 시각 표시용 얇은 wrapper) */
function formatDate(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/* ──────────────── 상태별 그룹 타입 ──────────────── */

interface StateGroup {
  stateId: string;
  stateName: string;
  stateColor: string;
  group: string;
  issues: Issue[];
}

/* ──────────────── 이슈 행 ──────────────── */

/** 날짜 범위를 간결하게 포맷 — "3/15 ~ 4/2" 또는 단일 날짜 "3/15" */
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
      {/* 프로젝트 이름 배지 */}
      <span className="text-2xs font-semibold text-muted-foreground shrink-0 bg-muted/60 px-2 py-0.5 rounded-md truncate max-w-[120px]">
        {issue.project_name ?? issue.project_identifier ?? ""}
      </span>

      {/* 이슈 ID */}
      <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">
        {issue.project_identifier ? `${issue.project_identifier}-${issue.sequence_id}` : `#${issue.sequence_id}`}
      </span>

      {/* 제목 */}
      <span className="flex-1 truncate text-sm text-foreground group-hover:text-primary transition-colors font-medium">
        {issue.title}
      </span>

      {/* 시작일 ~ 마감일 */}
      {dateRange && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 hidden sm:flex">
          <Calendar className="h-3 w-3" />
          {dateRange}
        </span>
      )}
    </Link>
  );
}

/* ──────────────── 상태 섹션 ──────────────── */

function StateSection({ sg, workspaceSlug }: { sg: StateGroup; workspaceSlug: string }) {
  return (
    <div className="rounded-2xl border border-border glass overflow-hidden">
      {/* 헤더 — 프로젝트 설정 색상 사용 */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
        <Circle className="h-4 w-4 shrink-0" style={{ color: sg.stateColor, fill: sg.stateColor }} />
        <h2 className="text-base font-semibold flex-1">{sg.stateName}</h2>
        <span className="text-sm font-mono text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">
          {sg.issues.length}
        </span>
      </div>
      {/* 이슈 목록 */}
      <div className="divide-y divide-border">
        {sg.issues.map((issue) => (
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

  /* state_detail 기준 그룹핑 — 프로젝트 설정의 실제 상태/색상 사용 */
  const stateGroups = useMemo(() => {
    const map = new Map<string, StateGroup>();

    for (const issue of myIssues) {
      const sd = issue.state_detail as State | null;
      const key = sd ? sd.id : "__none__";

      if (!map.has(key)) {
        map.set(key, {
          stateId: sd?.id ?? "__none__",
          stateName: sd?.name ?? "Unassigned",
          stateColor: sd?.color ?? "#9ca3af",
          group: sd?.group ?? "backlog",
          issues: [],
        });
      }
      map.get(key)!.issues.push(issue);
    }

    return Array.from(map.values());
  }, [myIssues]);

  const totalCount = myIssues.length;

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

      {isLoading ? (
        <HomeSkeleton />
      ) : (
        /* 2열 레이아웃 — xl 이상에선 좌: 내 할 일, 우: 최근 이슈 사이드바.
           xl 이하에선 세로 순차 배치. */
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-6 xl:items-start relative z-10">
          {/* 좌측: 내 할 일 (또는 빈 상태) */}
          <div className="space-y-5 min-w-0">
            {totalCount === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-12 text-center">
                <p className="text-lg text-muted-foreground">{t("dashboard.allClear")}</p>
                <p className="text-sm text-muted-foreground mt-2">{t("dashboard.allClearHint")}</p>
              </div>
            ) : (
              stateGroups.map((sg) => (
                <StateSection key={sg.stateId} sg={sg} workspaceSlug={workspaceSlug!} />
              ))
            )}
          </div>

          {/* 우측: 최근 이슈 — xl 이상에선 sticky 사이드바 */}
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
              {/* 모두 보기 — 하단 고정 */}
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
