/**
 * Backlog 뷰 — 백로그 상태 그룹의 이슈를 우선순위별로 그룹핑하여 표시
 *
 * "backlog" state group에 속한 이슈들을 한눈에 보고,
 * 드래그 없이 인라인으로 상태/우선순위/담당자를 빠르게 변경할 수 있는 뷰.
 */

import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Inbox, Circle, Calendar } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { useIssueRefresh } from "@/hooks/useIssueMutations";
import { useUndoStore } from "@/stores/undoStore";
import { StatePicker } from "@/components/issues/state-picker";
import { PriorityPicker } from "@/components/issues/priority-picker";
import { AssigneePicker } from "@/components/issues/assignee-picker";
import { SprintPicker } from "@/components/issues/sprint-picker";
import { PRIORITY_COLOR } from "@/constants/priority";
import type { Issue, State } from "@/types";

interface Props {
  workspaceSlug: string;
  projectId: string;
  onIssueClick: (issueId: string) => void;
  issueFilter?: Record<string, string>;
  readOnly?: boolean;
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (d: string) => {
    const [, m, dd] = d.split("-");
    return `${parseInt(m)}/${parseInt(dd)}`;
  };
  if (start && end && start !== end) return `${fmt(start)} ~ ${fmt(end)}`;
  return fmt(start ?? end!);
}

export function BacklogView({ workspaceSlug, projectId, onIssueClick, issueFilter, readOnly }: Props) {
  const { t } = useTranslation();
  const { refresh, refreshIssue } = useIssueRefresh(workspaceSlug, projectId);
  const pushUndo = useUndoStore((s) => s.push);

  const { data: allIssues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, issueFilter],
    queryFn: () => issuesApi.list(workspaceSlug, projectId, issueFilter),
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn: () => projectsApi.states.list(workspaceSlug, projectId),
  });

  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug, projectId),
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn: () => projectsApi.sprints.list(workspaceSlug, projectId),
  });

  // 백로그 상태 ID 집합
  const backlogStateIds = useMemo(
    () => new Set(states.filter((s) => s.group === "backlog").map((s) => s.id)),
    [states],
  );

  // 백로그 이슈만 필터 + state가 null인 이슈도 포함
  const backlogIssues = useMemo(
    () => allIssues.filter((i) => !i.state || backlogStateIds.has(i.state)),
    [allIssues, backlogStateIds],
  );

  // 상태별 그룹핑
  const groups = useMemo(() => {
    const map = new Map<string, { state: State | null; issues: Issue[] }>();

    for (const issue of backlogIssues) {
      const sd = issue.state_detail as State | null;
      const key = sd?.id ?? "__none__";
      if (!map.has(key)) map.set(key, { state: sd, issues: [] });
      map.get(key)!.issues.push(issue);
    }

    // 우선순위 높은 순으로 각 그룹 내 이슈 정렬
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
    for (const g of map.values()) {
      g.issues.sort((a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4));
    }

    return Array.from(map.values());
  }, [backlogIssues]);

  // 인라인 수정
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Issue> }) =>
      issuesApi.update(workspaceSlug, projectId, id, data),
    onMutate: ({ id, data }) => {
      const issue = backlogIssues.find((i) => i.id === id);
      if (!issue) return;
      const prev: Partial<Issue> = {};
      for (const key of Object.keys(data) as (keyof Issue)[]) {
        (prev as any)[key] = (issue as any)[key];
      }
      return { id, prev };
    },
    onSuccess: (_r, variables, context) => {
      refresh();
      refreshIssue(variables.id);
      if (context?.prev) {
        pushUndo({
          label: `Backlog: ${Object.keys(variables.data).join(", ")}`,
          undo: async () => {
            await issuesApi.update(workspaceSlug, projectId, context.id, context.prev);
            refresh();
            refreshIssue(context.id);
          },
        });
      }
    },
  });

  const totalCount = backlogIssues.length;

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-5">
        <Inbox className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{t("views.backlog.title")}</h2>
        <span className="text-sm font-mono text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">
          {totalCount}
        </span>
      </div>

      {totalCount === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-base text-muted-foreground">{t("views.backlog.empty")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("views.backlog.emptyHint")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const state = g.state;
            return (
              <div key={state?.id ?? "__none__"} className="rounded-xl border overflow-hidden">
                {/* 그룹 헤더 */}
                <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/20">
                  <Circle
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: state?.color ?? "#9ca3af", fill: state?.color ?? "#9ca3af" }}
                  />
                  <span className="text-sm font-semibold flex-1">{state?.name ?? "Unassigned"}</span>
                  <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {g.issues.length}
                  </span>
                </div>

                {/* 이슈 목록 */}
                <div className="divide-y divide-border">
                  {g.issues.map((issue) => {
                    const dateRange = formatDateRange(issue.start_date, issue.due_date);
                    return (
                      <div
                        key={issue.id}
                        className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/40 transition-colors group cursor-pointer"
                        onClick={() => onIssueClick(issue.id)}
                      >
                        {/* 우선순위 인라인 변경 */}
                        {!readOnly ? (
                          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                            <PriorityPicker
                              currentPriority={issue.priority}
                              onChange={(p) => updateMutation.mutate({ id: issue.id, data: { priority: p } })}
                            />
                          </div>
                        ) : (
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: PRIORITY_COLOR[issue.priority] ?? "#9ca3af" }}
                          />
                        )}

                        {/* ID */}
                        <span className="text-xs text-muted-foreground/60 font-mono shrink-0 w-16 truncate">
                          {issue.project_identifier ? `${issue.project_identifier}-${issue.sequence_id}` : `#${issue.sequence_id}`}
                        </span>

                        {/* 제목 */}
                        <span className="flex-1 text-sm truncate group-hover:text-primary transition-colors">
                          {issue.title}
                        </span>

                        {/* 날짜 */}
                        {dateRange && (
                          <span className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                            <Calendar className="h-3 w-3" />
                            {dateRange}
                          </span>
                        )}

                        {/* 스프린트 인라인 배정 */}
                        {!readOnly && (
                          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                            <SprintPicker
                              sprints={sprints}
                              currentId={issue.sprint}
                              onChange={(id) => updateMutation.mutate({ id: issue.id, data: { sprint: id } })}
                            />
                          </div>
                        )}

                        {/* 상태 인라인 변경 */}
                        {!readOnly && (
                          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                            <StatePicker
                              states={states}
                              currentStateId={issue.state}
                              onChange={(id) => updateMutation.mutate({ id: issue.id, data: { state: id } })}
                            />
                          </div>
                        )}

                        {/* 담당자 */}
                        {!readOnly && (
                          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                            <AssigneePicker
                              members={members as any}
                              currentIds={issue.assignees ?? []}
                              currentDetails={issue.assignee_details}
                              onChange={(ids) => updateMutation.mutate({ id: issue.id, data: { assignees: ids } })}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
