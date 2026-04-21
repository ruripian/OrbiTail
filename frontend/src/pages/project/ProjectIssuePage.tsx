/**
 * 프로젝트 이슈 페이지 — 4가지 뷰를 하나의 페이지에서 전환
 *
 * URL 파라미터:
 *   ?view=table|board|calendar|timeline  — 현재 뷰 (기본: table)
 *   ?issue=<uuid>                         — 이슈 상세 패널 열기
 */

import { useCallback, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { List, LayoutGrid, Calendar, GanttChart, Zap, Layers, ChevronDown, CheckCircle2, Circle, BarChart3, Archive, Inbox, Share2 } from "lucide-react";
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
import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { IssueDetailPanel } from "./IssueDetailPanel";
import { TableView }    from "./views/TableView";
import { BoardView }    from "./views/BoardView";
import { CalendarView } from "./views/CalendarView";
import { TimelineView } from "./views/TimelineView";
import { GraphView }    from "./views/GraphView";
import { SprintView }      from "./views/SprintView";
import { AnalyticsView }  from "./views/AnalyticsView";
import { ArchiveView }    from "./views/ArchiveView";
import { TrashView }      from "./views/TrashView";
import { BacklogView }   from "./views/BacklogView";
import { useViewSettings } from "@/hooks/useViewSettings";
import { ViewTransition } from "@/components/motion";
import type { Category, Sprint } from "@/types";

type ViewId = "table" | "board" | "backlog" | "calendar" | "timeline" | "graph" | "sprints" | "analytics" | "archive" | "trash";

const VIEW_IDS: { id: ViewId; key: string; Icon: React.ElementType }[] = [
  { id: "table",     key: "views.tabs.table",     Icon: List        },
  { id: "board",     key: "views.tabs.board",      Icon: LayoutGrid  },
  { id: "backlog",   key: "views.tabs.backlog",    Icon: Inbox       },
  { id: "calendar",  key: "views.tabs.calendar",   Icon: Calendar    },
  { id: "timeline",  key: "views.tabs.timeline",   Icon: GanttChart  },
  { id: "graph",     key: "views.tabs.graph",      Icon: Share2      },
  { id: "sprints",    key: "views.tabs.cycles",     Icon: Zap   },
  { id: "analytics", key: "views.tabs.analytics",  Icon: BarChart3   },
  { id: "archive",   key: "views.tabs.archive",    Icon: Archive     },
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

  /* 카테고리/스프린트 컨텍스트 — 하위 뷰에 필터로 전달 */
  const issueFilter = {
    ...(categoryId ? { category: categoryId } : {}),
    ...(sprintId   ? { sprint: sprintId }     : {}),
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings, updateCalendar, updateTimeline } = useViewSettings();

  const currentView   = (searchParams.get("view") as ViewId | null) ?? "table";
  const selectedIssue = searchParams.get("issue");

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

  /* 스프린트 선택 시 URL 라우팅 */
  const selectSprint = useCallback((id: string | null) => {
    const base = `/${workspaceSlug}/projects/${projectId}`;
    const viewParam = currentView !== "table" ? `?view=${currentView}` : "";
    if (id) {
      navigate(`${base}/sprints/${id}/issues${viewParam}`);
    } else {
      if (categoryId) {
        navigate(`${base}/categories/${categoryId}/issues${viewParam}`);
      } else {
        navigate(`${base}/issues${viewParam}`);
      }
    }
  }, [workspaceSlug, projectId, categoryId, currentView, navigate]);

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
      {currentView !== "trash" && (
      <div className="flex items-center gap-2 px-3 sm:px-5 h-10 border-b border-border shrink-0 overflow-x-auto">
        <div className="flex items-center gap-0.5 bg-muted/40 rounded-lg p-0.5 border border-border shrink-0">
          {VIEW_IDS.map(({ id, key, Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 whitespace-nowrap",
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
                "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-all duration-150",
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

        {/* 스프린트 필터 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-all duration-150",
                sprintId
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "text-muted-foreground border-border hover:bg-muted/40"
              )}
            >
              <Zap className="h-3 w-3" />
              {activeSprint ? activeSprint.name : t("views.cycleFilter.label")}
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem
              className={cn("text-xs", !sprintId && "bg-muted/60")}
              onClick={() => selectSprint(null)}
            >
              {t("views.cycleFilter.all")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {sprints.length === 0 ? (
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                {t("cycles.empty")}
              </DropdownMenuItem>
            ) : (
              sprints.map((sprint: Sprint) => (
                <DropdownMenuItem
                  key={sprint.id}
                  className={cn("text-xs flex items-center gap-2", sprintId === sprint.id && "bg-muted/60")}
                  onClick={() => selectSprint(sprint.id)}
                >
                  <span className="flex-1 truncate">{sprint.name}</span>
                  <span className="text-2xs text-muted-foreground shrink-0">
                    {t("cycles.issueCount", { count: sprint.issue_count })}
                  </span>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs text-primary"
              onClick={() => navigate(`/${workspaceSlug}/projects/${projectId}/sprints`)}
            >
              {t("views.cycleFilter.manage")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

      </div>
      )}

      {activeSprint && sprintIssues.length > 0 && (() => {
        const total = sprintIssues.length;
        const completed = sprintIssues.filter((i: { state_detail?: { group?: string } }) =>
          i.state_detail?.group === "completed"
        ).length;
        const cancelled = sprintIssues.filter((i: { state_detail?: { group?: string } }) =>
          i.state_detail?.group === "cancelled"
        ).length;
        const inProgress = sprintIssues.filter((i: { state_detail?: { group?: string } }) =>
          i.state_detail?.group === "started"
        ).length;
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

            <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden min-w-[60px]">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            <span className="text-muted-foreground shrink-0 font-medium">{pct}%</span>
            <span className="flex items-center gap-1 text-green-600 shrink-0">
              <CheckCircle2 className="h-3 w-3" />
              {completed}
            </span>
            <span className="flex items-center gap-1 text-blue-600 shrink-0">
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
            onIssueClick={openIssue}
          />
        )}

        {currentView === "sprints" && (
          <SprintView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            onIssueClick={openIssue}
          />
        )}

        {currentView === "analytics" && (
          <AnalyticsView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
          />
        )}
        {currentView === "archive" && (
          <ArchiveView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            onIssueClick={openIssue}
            issueFilter={issueFilter}
          />
        )}
        {currentView === "trash" && (
          <TrashView
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
          />
        )}
      </ViewTransition>

      {selectedIssue && (
        <IssueDetailPanel issueId={selectedIssue} onClose={closeIssue} />
      )}

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
