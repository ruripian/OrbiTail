import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Circle } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import type { Issue, State } from "@/types";

// 상태 그룹 → CSS 변수 (WorkspaceDashboard와 동일한 토큰 사용)
const STATE_GROUP_VAR: Record<string, string> = {
  backlog:   "var(--state-backlog)",
  unstarted: "var(--state-unstarted)",
  started:   "var(--state-started)",
  completed: "var(--state-completed)",
  cancelled: "var(--state-cancelled)",
};

// 우선순위 → CSS 변수
const PRIORITY_VAR: Record<string, string> = {
  urgent: "var(--priority-urgent)",
  high:   "var(--priority-high)",
  medium: "var(--priority-medium)",
  low:    "var(--priority-low)",
  none:   "var(--priority-none)",
};

export function IssueListPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { workspaceSlug, projectId, categoryId, sprintId } = useParams<{
    workspaceSlug: string;
    projectId: string;
    categoryId?: string;
    sprintId?: string;
  }>();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedState, setSelectedState] = useState<State | null>(null);
  const [inlineStateId, setInlineStateId] = useState<string | null>(null);
  const [inlineTitle, setInlineTitle] = useState("");

  const inlineCreateMutation = useMutation({
    mutationFn: ({ title, stateId }: { title: string; stateId: string }) =>
      issuesApi.create(workspaceSlug!, projectId!, {
        title,
        state: stateId,
        priority: "medium",
        project: projectId!,
        ...(categoryId ? { category: categoryId } : {}),
        ...(sprintId   ? { sprint:  sprintId }   : {}),
      } as Partial<Issue>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
      qc.invalidateQueries({ queryKey: ["my-issues", workspaceSlug] });
      setInlineTitle("");
      // 인라인 유지 — 연속 생성 가능
    },
  });

  const { data: issues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId],
    queryFn: () => issuesApi.list(workspaceSlug!, projectId!),
    enabled: !!workspaceSlug && !!projectId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", workspaceSlug, projectId],
    queryFn: () => projectsApi.states.list(workspaceSlug!, projectId!),
    enabled: !!workspaceSlug && !!projectId,
  });

  const issuesByState = states.reduce<Record<string, Issue[]>>((acc, state) => {
    acc[state.id] = issues.filter((i) => i.state === state.id);
    return acc;
  }, {});

  return (
    <div className="p-8 max-w-5xl">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-foreground">{t("sidebar.issues")}</h1>
        <Button
          size="sm"
          onClick={() => {
            setSelectedState(states[0] ?? null);
            setCreateOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {t("views.addIssue")}
        </Button>
      </div>

      {/* 상태별 이슈 그룹 */}
      <div className="space-y-6">
        {states.map((state) => {
          // 상태 그룹 CSS 변수 우선, 없으면 state.color 폴백
          const stateColor = STATE_GROUP_VAR[state.group] ?? state.color;
          const stateIssues = issuesByState[state.id] ?? [];

          return (
            <div key={state.id}>
              {/* 상태 헤더 */}
              <div className="flex items-center gap-2 mb-1.5 px-1">
                <Circle
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: stateColor, fill: stateColor }}
                />
                <span className="text-sm font-medium text-foreground">{state.name}</span>
                <span className="text-xs text-muted-foreground">
                  {stateIssues.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 ml-auto text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setSelectedState(state);
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* 이슈 목록 */}
              <div className="rounded-xl border glass divide-y divide-border overflow-hidden">
                {stateIssues.length === 0 && inlineStateId !== state.id ? (
                  <p className="px-4 py-3 text-xs text-muted-foreground">{t("issues.table.empty")}</p>
                ) : (
                  <>
                  {stateIssues.map((issue) => (
                    <Link
                      key={issue.id}
                      to={`/${workspaceSlug}/projects/${projectId}/issues/${issue.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors group"
                    >
                      {/* 상태 원 */}
                      <Circle
                        className="h-3 w-3 shrink-0"
                        style={{ color: stateColor, fill: stateColor }}
                      />

                      {/* 우선순위 점 */}
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: PRIORITY_VAR[issue.priority] ?? PRIORITY_VAR.none }}
                      />

                      {/* 이슈 ID */}
                      <span className="text-xs text-muted-foreground shrink-0 w-20 truncate">
                        {issue.sequence_id}
                      </span>

                      {/* 제목 */}
                      <span className="flex-1 truncate text-foreground group-hover:text-primary transition-colors">
                        {issue.title}
                      </span>

                      {/* 담당자 아바타 */}
                      {issue.assignee_details.length > 0 && (
                        <div className="flex -space-x-1 shrink-0">
                          {issue.assignee_details.slice(0, 3).map((a) => (
                            <AvatarInitials key={a.id} name={a.display_name} avatar={a.avatar} size="xs" ring title={a.display_name} />
                          ))}
                        </div>
                      )}
                    </Link>
                  ))}
                  </>
                )}
              </div>

              {/* 인라인 이슈 추가 */}
              {inlineStateId === state.id ? (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 mt-1.5">
                  <Circle
                    className="h-3 w-3 shrink-0"
                    style={{ color: stateColor, fill: stateColor }}
                  />
                  <input
                    ref={(el) => { if (el) el.focus({ preventScroll: true }); }}
                    type="text"
                    value={inlineTitle}
                    onChange={(e) => setInlineTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && inlineTitle.trim()) {
                        e.preventDefault();
                        inlineCreateMutation.mutate({ title: inlineTitle.trim(), stateId: state.id });
                      }
                      if (e.key === "Escape") {
                        setInlineStateId(null);
                        setInlineTitle("");
                      }
                    }}
                    onBlur={() => {
                      if (inlineTitle.trim()) {
                        inlineCreateMutation.mutate({ title: inlineTitle.trim(), stateId: state.id });
                      } else {
                        setInlineStateId(null);
                        setInlineTitle("");
                      }
                    }}
                    placeholder={t("issues.table.quickAddPlaceholder")}
                    autoComplete="off"
                    className="flex-1 min-w-0 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground/50"
                  />
                  <span className="text-xs text-muted-foreground/60 shrink-0">
                    {t("issues.table.pressEnterToAdd")}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setInlineStateId(state.id); setInlineTitle(""); }}
                  className="w-full flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2 text-xs font-medium text-muted-foreground/50 hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all duration-150 mt-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("views.addIssue")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <IssueCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        states={states}
        defaultStateId={selectedState?.id}
        workspaceSlug={workspaceSlug!}
        projectId={projectId!}
        defaultCategoryId={categoryId}
        defaultSprintId={sprintId}
      />
    </div>
  );
}
