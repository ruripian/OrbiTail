/**
 * 프로젝트 이슈 페이지 — 4가지 뷰를 하나의 페이지에서 전환
 *
 * URL 파라미터:
 *   ?view=table|board|calendar|timeline  — 현재 뷰 (기본: table)
 *   ?issue=<uuid>                         — 이슈 상세 패널 열기
 */

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { List, LayoutGrid, Calendar, GanttChart, Zap, Layers, ChevronDown, CheckCircle2, Circle, BarChart3, Inbox, Share2 } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnimatePresence } from "framer-motion";
import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { IssueDetailPanel } from "./IssueDetailPanel";
import { TableView }    from "./views/TableView";
import { BoardView }    from "./views/BoardView";
import { CalendarView } from "./views/CalendarView";
import { ReportsView }   from "./views/ReportsView";
import { BacklogView }   from "./views/BacklogView";

/* PASS7-2 — heavy view 는 lazy. 사용자가 해당 뷰를 처음 열 때만 로드. */
const TimelineView = lazy(() => import("./views/TimelineView").then((m) => ({ default: m.TimelineView })));
const GraphView    = lazy(() => import("./views/GraphView").then((m) => ({ default: m.GraphView })));
import { useViewSettings } from "@/hooks/useViewSettings";
import { useProjectFeatures } from "@/hooks/useProjectFeatures";
import { ViewTransition } from "@/components/motion";
import { usePresenceScope } from "@/hooks/usePresenceScope";
import { PresenceStack } from "@/components/layout/PresenceStack";
import type { Category, Sprint } from "@/types";

/* PASS4-2/4: sprints+analytics → reports, archive/trash → 사이드바 */
type ViewId = "table" | "board" | "backlog" | "calendar" | "timeline" | "graph" | "reports";

const VIEW_IDS: { id: ViewId; key: string; Icon: React.ElementType }[] = [
  { id: "table",    key: "views.tabs.table",    Icon: List       },
  { id: "board",    key: "views.tabs.board",    Icon: LayoutGrid },
  { id: "backlog",  key: "views.tabs.backlog",  Icon: Inbox      },
  { id: "calendar", key: "views.tabs.calendar", Icon: Calendar   },
  { id: "timeline", key: "views.tabs.timeline", Icon: GanttChart },
  { id: "graph",    key: "views.tabs.graph",    Icon: Share2     },
  { id: "reports",  key: "views.tabs.reports",  Icon: BarChart3  },
];

export function ProjectIssuePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceSlug, projectId, categoryId, sprintId } = useParams<{
    workspaceSlug: string;
    projectId:     string;
    categoryId?:   string;
    sprintId?:     string;
  }>();

  /* 이 프로젝트를 보고 있다는 신호를 서버에 전달 — 다른 멤버에게 presence stack 으로 보임 */
  usePresenceScope(projectId ? `project:${projectId}` : null);

  /* 카테고리/스프린트 컨텍스트 — 하위 뷰에 필터로 전달 */
  const issueFilter = {
    ...(categoryId ? { category: categoryId } : {}),
    ...(sprintId   ? { sprint: sprintId }     : {}),
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings, updateCalendar, updateTimeline } = useViewSettings();
  const { isEnabled } = useProjectFeatures();

  /* 기능 on/off 에 따른 뷰 탭 필터 — core(table) 항상 표시. archive/trash 는 사이드바로 이동(PASS4-4). */
  const visibleViews = VIEW_IDS.filter((v) => {
    if (v.id === "table") return true;
    return isEnabled(v.id as Parameters<typeof isEnabled>[0]);
  });

  const currentView   = (searchParams.get("view") as ViewId | null) ?? "table";
  const selectedIssue = searchParams.get("issue");

  /* PASS4: legacy ?view= 4종 redirect — 외부 링크/북마크 보존 */
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "sprints" || v === "analytics") {
      const next = new URLSearchParams(searchParams);
      next.set("view", "reports");
      setSearchParams(next, { replace: true });
    } else if (v === "archive") {
      navigate(`/${workspaceSlug}/projects/${projectId}/archive`, { replace: true });
    } else if (v === "trash") {
      navigate(`/${workspaceSlug}/projects/${projectId}/trash`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [createOpen, setCreateOpen] = useState(false);

  /* 프로젝트 정보 — 읽기 전용 여부 판별 */
  const { data: project } = useQuery({
    queryKey: ["project", workspaceSlug, projectId],
    queryFn:  () => projectsApi.get(workspaceSlug!, projectId!),
  });
  const readOnly = project ? !project.is_member : false;

  /* 이슈 목록 페이지용 state 데이터 (CreateDialog에 필요) */
  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn:  () => projectsApi.states.list(workspaceSlug!, projectId!),
  });

  /* 카테고리 목록 — 카테고리 셀렉터용 */
  const { data: categories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, projectId],
    queryFn:  () => projectsApi.categories.list(workspaceSlug!, projectId!),
  });

  /* 스프린트 목록 — 스프린트 셀렉터용 */
  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn:  () => projectsApi.sprints.list(workspaceSlug!, projectId!),
  });

  /* 현재 선택된 카테고리/스프린트 객체 */
  const activeCategory = categoryId ? categories.find((c: Category) => c.id === categoryId) : null;
  const activeSprint = sprintId ? sprints.find((c: Sprint) => c.id === sprintId) : null;

  /* 스프린트 이슈 통계 — 스프린트 선택 시에만 fetch */
  const { data: sprintIssues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, { sprint: sprintId }],
    queryFn:  () => issuesApi.list(workspaceSlug!, projectId!, { sprint: sprintId! }),
    enabled:  !!sprintId,
  });

  /* 카테고리 선택 시 URL 라우팅 */
  const selectCategory = useCallback((id: string | null) => {
    const base = `/${workspaceSlug}/projects/${projectId}`;
    const viewParam = currentView !== "table" ? `?view=${currentView}` : "";
    if (id) {
      navigate(`${base}/categories/${id}/issues${viewParam}`);
    } else {
      if (sprintId) {
        navigate(`${base}/sprints/${sprintId}/issues${viewParam}`);
      } else {
        navigate(`${base}/issues${viewParam}`);
      }
    }
  }, [workspaceSlug, projectId, sprintId, currentView, navigate]);

  /* 스프린트 선택은 사이드바의 스프린트 메뉴에서만 — 본 헤더 필터 제거됨 */

  /* 뷰 전환 */
  const setView = useCallback((v: ViewId) => {
    setSearchParams((p) => { p.set("view", v); p.delete("issue"); return p; });
  }, [setSearchParams]);

  /* 이슈 패널 열기 */
  const openIssue = useCallback((issueId: string) => {
    setSearchParams((p) => { p.set("issue", issueId); return p; });
  }, [setSearchParams]);

  /* 이슈 패널 닫기 */
  const closeIssue = useCallback(() => {
    setSearchParams((p) => { p.delete("issue"); return p; });
  }, [setSearchParams]);

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* PASS4: trash 는 별도 페이지로 이동했으므로 항상 view 탭 표시 */}
      <div className="flex items-center gap-2 px-3 sm:px-5 h-10 border-b border-border shrink-0 overflow-x-auto">
        <div className="flex items-center gap-0.5 bg-muted/40 rounded-lg p-0.5 border border-border shrink-0">
          {visibleViews.map(({ id, key, Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-fast whitespace-nowrap",
                currentView === id
                  ? "bg-background text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t(key)}</span>
            </button>
          ))}
        </div>

        {/* 카테고리 필터 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-all duration-fast",
                categoryId
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "text-muted-foreground border-border hover:bg-muted/40"
              )}
            >
              <Layers className="h-3 w-3" />
              {activeCategory ? activeCategory.name : t("views.categoryFilter.label")}
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem
              className={cn("text-xs", !categoryId && "bg-muted/60")}
              onClick={() => selectCategory(null)}
            >
              {t("views.categoryFilter.all")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {categories.length === 0 ? (
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                {t("modules.empty")}
              </DropdownMenuItem>
            ) : (
              categories.map((cat: Category) => (
                <DropdownMenuItem
                  key={cat.id}
                  className={cn("text-xs flex items-center gap-2", categoryId === cat.id && "bg-muted/60")}
                  onClick={() => selectCategory(cat.id)}
                >
                  <span className="flex-1 truncate">{cat.name}</span>
                  <span className="text-2xs text-muted-foreground shrink-0">
                    {t("modules.issueCount", { count: cat.issue_count })}
                  </span>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs text-primary"
              onClick={() => navigate(`/${workspaceSlug}/projects/${projectId}/categories`)}
            >
              {t("views.categoryFilter.manage")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 스프린트 필터는 제거됨 — 스프린트 컨텍스트는 사이드바의 스프린트 메뉴 / Reports 뷰에서 다룸 */}

        <div className="flex-1" />

        {/* 이 프로젝트를 보고 있는 다른 멤버 — 본인 제외 */}
        {projectId && <PresenceStack scope={`project:${projectId}`} />}

      </div>

      {activeSprint && sprintIssues.length > 0 && (() => {
        // 필드(Field) 는 상태 없는 컨테이너 → 스프린트 집계에서 제외.
        const countable = (sprintIssues as Array<{ is_field?: boolean; state_detail?: { group?: string } }>).filter((i) => !i.is_field);
        const total = countable.length;
        const completed = countable.filter((i) => i.state_detail?.group === "completed").length;
        const cancelled = countable.filter((i) => i.state_detail?.group === "cancelled").length;
        const inProgress = countable.filter((i) => i.state_detail?.group === "started").length;
        const pct = Math.round((completed / total) * 100);

        /* 스프린트 기간 계산 */
        const startDate = new Date(activeSprint.start_date);
        const endDate = new Date(activeSprint.end_date);
        const now = new Date();
        const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000));
        const elapsed = Math.max(0, Math.min(totalDays, Math.ceil((now.getTime() - startDate.getTime()) / 86400000)));
        const daysLeft = Math.max(0, totalDays - elapsed);

        return (
          <div className="px-5 py-1.5 border-b border-border bg-muted/10 shrink-0 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 shrink-0">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-semibold">{activeSprint.name}</span>
            </div>
            <span className="text-muted-foreground shrink-0 hidden lg:inline">
              {startDate.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
              {" ~ "}
              {endDate.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
            </span>

            {/* PASS2-1 — 진행 띠/카운트 색을 state-{group} 토큰으로. 토큰값이 OKLCH 라 var() 직접 사용. */}
            <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden min-w-[60px]">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${pct}%`,
                  background: "var(--state-completed-fill)",
                  transitionDuration: "var(--motion-slow)",
                }}
              />
            </div>

            <span className="text-muted-foreground shrink-0 font-medium">{pct}%</span>
            <span className="flex items-center gap-1 shrink-0" style={{ color: "var(--state-completed-text)" }}>
              <CheckCircle2 className="h-3 w-3" />
              {completed}
            </span>
            <span className="flex items-center gap-1 shrink-0" style={{ color: "var(--state-started-text)" }}>
              <Circle className="h-3 w-3" />
              {inProgress}
            </span>
            {cancelled > 0 && (
              <span className="text-muted-foreground shrink-0 hidden xl:inline">
                {t("cycles.burndown.cancelled", { count: cancelled })}
              </span>
            )}
            <span className="text-muted-foreground shrink-0">
              {t("cycles.burndown.daysLeft", { count: daysLeft })}
            </span>
          </div>
        );
      })()}

      <ViewTransition viewKey={currentView} className="flex-1 overflow-hidden">
        <Suspense fallback={<div className="flex items-center justify-center h-full text-xs text-muted-foreground">Loading view…</div>}>
        {currentView === "table" && (
          <TableView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            onIssueClick={openIssue}
            issueFilter={issueFilter}
            readOnly={readOnly}
          />
        )}

        {currentView === "board" && (
          <BoardView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            onIssueClick={openIssue}
            issueFilter={issueFilter}
            readOnly={readOnly}
          />
        )}

        {currentView === "backlog" && (
          <BacklogView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            onIssueClick={openIssue}
            issueFilter={issueFilter}
            readOnly={readOnly}
          />
        )}

        {currentView === "calendar" && (
          <CalendarView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            onIssueClick={openIssue}
            issueFilter={issueFilter}
            settings={settings.calendar}
            onSettingsChange={updateCalendar}
          />
        )}

        {currentView === "timeline" && (
          <TimelineView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            onIssueClick={openIssue}
            issueFilter={issueFilter}
            settings={settings.timeline}
            onSettingsChange={updateTimeline}
          />
        )}

        {currentView === "graph" && (
          <GraphView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            categoryId={categoryId ?? null}
            onIssueClick={openIssue}
          />
        )}

        {currentView === "reports" && (
          <ReportsView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            onIssueClick={openIssue}
          />
        )}
        {/* PASS4-4: archive/trash 는 사이드바 nav 의 standalone 페이지로 이동 */}
        </Suspense>
      </ViewTransition>

      {/* Phase 3.3 — AnimatePresence로 모달 enter/exit 시 framer-motion이 layoutId 매칭 트윈 */}
      <AnimatePresence>
        {selectedIssue && (
          <IssueDetailPanel key={selectedIssue} issueId={selectedIssue} onClose={closeIssue} />
        )}
      </AnimatePresence>

      <IssueCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        states={states}
        defaultStateId={states.find((s) => s.group === "unstarted")?.id ?? states.find((s) => s.default)?.id ?? states[0]?.id}
        workspaceSlug={workspaceSlug!}
        projectId={projectId!}
        defaultCategoryId={categoryId}
        defaultSprintId={sprintId}
      />
    </div>
  );
}
