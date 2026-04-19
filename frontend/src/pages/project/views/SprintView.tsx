/**
 * Sprint View -- sprint management + table-style issue list (hierarchy support)
 *
 * Left: sprint list (add/delete)
 * Right: selected sprint's issue table + progress
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatDate } from "@/utils/date-format";
import {
  Zap, CheckCircle2, Circle, Clock, Plus, ChevronRight, ChevronDown, Trash2,
} from "lucide-react";
import { projectsApi } from "@/api/projects";
import { issuesApi } from "@/api/issues";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { PageTransition, StaggerList, StaggerItem, HoverLift } from "@/components/motion";
import { SprintBurndown } from "@/components/charts/SprintBurndown";
import type { Sprint, SprintStatus, Issue, State } from "@/types";

const STATUS_STYLE: Record<SprintStatus, { bg: string; icon: React.ElementType }> = {
  active:    { bg: "bg-blue-500/10 text-blue-600",   icon: Circle },
  draft:     { bg: "bg-muted text-muted-foreground",  icon: Clock },
  completed: { bg: "bg-green-500/10 text-green-600",  icon: CheckCircle2 },
  cancelled: { bg: "bg-red-500/10 text-red-600",      icon: Circle },
};

const PRIORITY_STYLE: Record<string, string> = {
  urgent: "text-red-500", high: "text-orange-500", medium: "text-yellow-500",
  low: "text-blue-500", none: "text-muted-foreground",
};

const fmtDate = formatDate;

function calcProgress(sprint: Sprint): number {
  const start = new Date(sprint.start_date).getTime();
  const end = new Date(sprint.end_date).getTime();
  const now = Date.now();
  if (now >= end) return 100;
  if (now <= start) return 0;
  return Math.round(((now - start) / (end - start)) * 100);
}

interface Props {
  workspaceSlug: string;
  projectId: string;
  onIssueClick: (issueId: string) => void;
}

export function SprintView({ workspaceSlug, projectId, onIssueClick }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const [formName, setFormName] = useState("");
  const [formStart, setFormStart] = useState<string | null>(null);
  const [formEnd, setFormEnd] = useState<string | null>(null);

  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn: () => projectsApi.sprints.list(workspaceSlug, projectId),
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn: () => projectsApi.states.list(workspaceSlug, projectId),
  });
  const stateMap = useMemo(() => new Map(states.map((s: State) => [s.id, s])), [states]);

  const groupOrder: SprintStatus[] = ["active", "draft", "completed", "cancelled"];
  const grouped = groupOrder.reduce<Record<string, Sprint[]>>((acc, status) => {
    acc[status] = sprints.filter((c: Sprint) => c.status === status);
    return acc;
  }, {});

  const activeSprintId = selectedSprintId ?? grouped.active?.[0]?.id ?? sprints[0]?.id ?? null;
  const selectedSprint = sprints.find((c: Sprint) => c.id === activeSprintId) ?? null;

  /* 이슈 목록 — 하위 이슈 포함 */
  const { data: sprintIssues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, { sprint: activeSprintId }, "with-sub"],
    queryFn: () => issuesApi.list(workspaceSlug, projectId, { sprint: activeSprintId!, include_sub_issues: "true" }),
    enabled: !!activeSprintId,
  });

  /* 계층 구조 — 부모-자식 매핑 */
  const { rootIssues, childrenMap } = useMemo(() => {
    const cMap = new Map<string, Issue[]>();
    const roots: Issue[] = [];
    for (const issue of sprintIssues) {
      if (issue.parent && sprintIssues.some((i) => i.id === issue.parent)) {
        if (!cMap.has(issue.parent)) cMap.set(issue.parent, []);
        cMap.get(issue.parent)!.push(issue);
      } else {
        roots.push(issue);
      }
    }
    return { rootIssues: roots, childrenMap: cMap };
  }, [sprintIssues]);

  /* 트리 행 생성 */
  const rows = useMemo(() => {
    const result: { issue: Issue; depth: number }[] = [];
    function walk(issues: Issue[], depth: number) {
      for (const issue of issues) {
        result.push({ issue, depth });
        const children = childrenMap.get(issue.id);
        if (children && !collapsedIds.has(issue.id)) {
          walk(children, depth + 1);
        }
      }
    }
    walk(rootIssues, 0);
    return result;
  }, [rootIssues, childrenMap, collapsedIds]);

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const total = sprintIssues.length;
  const completed = sprintIssues.filter((i: Issue) => i.state_detail?.group === "completed").length;
  const inProgress = sprintIssues.filter((i: Issue) => i.state_detail?.group === "started").length;
  const cancelled = sprintIssues.filter((i: Issue) => i.state_detail?.group === "cancelled").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const daysLeft = selectedSprint ? Math.max(0, Math.ceil((new Date(selectedSprint.end_date).getTime() - Date.now()) / 86400000)) : 0;

  const createMutation = useMutation({
    mutationFn: () =>
      projectsApi.sprints.create(workspaceSlug, projectId, {
        name: formName,
        start_date: formStart!,
        end_date: formEnd!,
        status: "draft",
      }),
    onSuccess: (newSprint) => {
      qc.invalidateQueries({ queryKey: ["sprints", workspaceSlug, projectId] });
      setSelectedSprintId(newSprint.id);
      setCreateOpen(false);
      setFormName(""); setFormStart(null); setFormEnd(null);
      toast.success(t("cycles.created"));
    },
    onError: () => toast.error(t("cycles.createFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.sprints.delete(workspaceSlug, projectId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprints", workspaceSlug, projectId] });
      setSelectedSprintId(null);
      toast.success(t("cycles.deleted"));
    },
    onError: () => toast.error(t("cycles.deleteFailed")),
  });

  return (
    <PageTransition className="flex h-full overflow-hidden">
      <div className="w-72 shrink-0 border-r overflow-y-auto p-3 space-y-4">
        <Button size="sm" onClick={() => setCreateOpen(true)} className="w-full gap-1.5 rounded-xl">
          <Plus className="h-3.5 w-3.5" />
          {t("cycles.create")}
        </Button>

        {groupOrder.map((status) => {
          const list = grouped[status];
          if (!list || list.length === 0) return null;
          const StatusIcon = STATUS_STYLE[status].icon;

          return (
            <div key={status}>
              <div className="flex items-center gap-2 px-2 mb-2">
                <StatusIcon className="h-3 w-3 text-muted-foreground" />
                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(`cycles.status.${status}`)}
                </span>
                <span className="text-2xs text-muted-foreground/60 ml-auto">{list.length}</span>
              </div>

              <StaggerList className="space-y-1">
                {list.map((sprint: Sprint) => {
                  const isSelected = sprint.id === activeSprintId;
                  const timePct = calcProgress(sprint);

                  return (
                    <StaggerItem key={sprint.id}>
                      <div
                        className={cn(
                          "group w-full text-left rounded-xl px-3 py-2.5 transition-all duration-150 relative",
                          isSelected
                            ? "bg-primary/10 border border-primary/30 shadow-sm"
                            : "hover:bg-muted/50 border border-transparent"
                        )}
                      >
                        <button onClick={() => setSelectedSprintId(sprint.id)} className="w-full text-left">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={cn("text-xs font-medium truncate flex-1", isSelected && "text-primary")}>
                              {sprint.name}
                            </span>
                            <Badge variant="secondary" className={cn("text-2xs px-1.5 py-0", STATUS_STYLE[status].bg)}>
                              {t(`cycles.status.${status}`)}
                            </Badge>
                          </div>
                          <div className="text-2xs text-muted-foreground mb-1.5">
                            {fmtDate(sprint.start_date)} ~ {fmtDate(sprint.end_date)}
                          </div>
                          <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all", status === "completed" ? "bg-green-500" : "bg-primary")}
                              style={{ width: `${status === "completed" ? 100 : timePct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-2xs text-muted-foreground">
                              {t("cycles.issueCount", { count: sprint.issue_count })}
                            </span>
                          </div>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(t("cycles.deleteConfirm"))) deleteMutation.mutate(sprint.id);
                          }}
                          className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </StaggerItem>
                  );
                })}
              </StaggerList>
            </div>
          );
        })}

        {sprints.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Zap className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-xs">{t("cycles.empty")}</p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedSprint ? (
          <div className="p-5 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">{selectedSprint.name}</h2>
                <Badge variant="secondary" className={STATUS_STYLE[selectedSprint.status].bg}>
                  {t(`cycles.status.${selectedSprint.status}`)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {fmtDate(selectedSprint.start_date)} ~ {fmtDate(selectedSprint.end_date)}
                {selectedSprint.description && ` · ${selectedSprint.description}`}
              </p>
            </div>

            {total > 0 && (
              <div className="space-y-2">
                <div className="h-2.5 rounded-full bg-muted/40 overflow-hidden">
                  <div className="h-full rounded-full bg-green-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center gap-4 text-xs flex-wrap">
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-3 w-3" /> {t("cycles.burndown.completed", { count: completed })}
                  </span>
                  <span className="flex items-center gap-1 text-blue-600">
                    <Circle className="h-3 w-3" /> {t("cycles.burndown.inProgress", { count: inProgress })}
                  </span>
                  {cancelled > 0 && (
                    <span className="flex items-center gap-1 text-red-500">
                      {t("cycles.burndown.cancelled", { count: cancelled })}
                    </span>
                  )}
                  <span className="text-muted-foreground">{t("cycles.burndown.daysLeft", { count: daysLeft })}</span>
                  <span className="text-muted-foreground ml-auto">{pct}% {t("cycles.burndown.complete")}</span>
                </div>
              </div>
            )}

            {/* 번다운 차트 */}
            {selectedSprint && selectedSprint.start_date && selectedSprint.end_date && total > 0 && (
              <SprintBurndown sprint={selectedSprint} issues={sprintIssues} states={states} />
            )}

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t("sidebar.issues")} ({total})
              </h3>
              {total === 0 ? (
                <p className="text-xs text-muted-foreground py-4">{t("cycles.noIssues")}</p>
              ) : (
                <div className="rounded-xl border overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20 text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <span className="w-6" />
                    <span className="w-16">{t("issues.table.cols.id")}</span>
                    <span className="flex-1">{t("issues.table.cols.title")}</span>
                    <span className="w-20 text-center">{t("issues.detail.meta.state")}</span>
                    <span className="w-20 text-center">{t("issues.detail.meta.priority")}</span>
                    <span className="w-24 text-center">{t("issues.detail.meta.assignee")}</span>
                    <span className="w-24 text-center">{t("issues.detail.meta.dueDate")}</span>
                  </div>

                  {rows.map(({ issue, depth }) => {
                    const stateObj = stateMap.get(issue.state);
                    const hasChildren = childrenMap.has(issue.id);
                    const isCollapsed = collapsedIds.has(issue.id);

                    return (
                      <div
                        key={issue.id}
                        className="flex items-center gap-2 px-3 py-2 border-b last:border-0 hover:bg-muted/10 transition-colors text-sm"
                      >
                        <div className="w-6 flex items-center" style={{ paddingLeft: depth * 16 }}>
                          {hasChildren ? (
                            <button
                              onClick={() => toggleCollapse(issue.id)}
                              className="p-0.5 rounded hover:bg-muted transition-colors"
                            >
                              {isCollapsed
                                ? <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              }
                            </button>
                          ) : (
                            <span className="w-4" />
                          )}
                        </div>

                        <span className="w-16 text-2xs font-mono text-muted-foreground shrink-0">
                          {issue.sequence_id}
                        </span>

                        <span
                          className="flex-1 truncate cursor-pointer hover:text-primary transition-colors"
                          onClick={() => onIssueClick(issue.id)}
                        >
                          {issue.title}
                        </span>

                        <div className="w-20 flex items-center justify-center">
                          <span
                            className="inline-flex items-center gap-1 text-2xs font-medium px-1.5 py-0.5 rounded-md"
                            style={{ backgroundColor: `${stateObj?.color ?? "#888"}20`, color: stateObj?.color ?? "#888" }}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stateObj?.color ?? "#888" }} />
                            {stateObj?.name ?? "—"}
                          </span>
                        </div>

                        <span className={cn("w-20 text-center text-xs capitalize", PRIORITY_STYLE[issue.priority] ?? "text-muted-foreground")}>
                          {issue.priority === "none" ? "—" : issue.priority}
                        </span>

                        <div className="w-24 flex items-center justify-center">
                          {issue.assignee_details.length > 0 ? (
                            <div className="flex -space-x-1">
                              {issue.assignee_details.slice(0, 3).map((a) => (
                                <div key={a.id} className="h-5 w-5 rounded-full bg-primary/10 text-2xs flex items-center justify-center border border-background font-medium" title={a.display_name}>
                                  {a.display_name[0].toUpperCase()}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-2xs text-muted-foreground">—</span>
                          )}
                        </div>

                        <span className={cn(
                          "w-24 text-center text-2xs",
                          issue.due_date && new Date(issue.due_date) < new Date() ? "text-destructive font-medium" : "text-muted-foreground"
                        )}>
                          {issue.due_date ? fmtDate(issue.due_date) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">{t("cycles.selectCycle")}</p>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cycles.create")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>{t("cycles.name")}</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t("cycles.namePlaceholder")} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("cycles.startDate")}</Label>
                <DatePicker
                  value={formStart}
                  onChange={setFormStart}
                  placeholder={t("cycles.startDate")}
                  className="border border-border rounded-md bg-input/60"
                />
              </div>
              <div className="space-y-1">
                <Label>{t("cycles.endDate")}</Label>
                <DatePicker
                  value={formEnd}
                  onChange={setFormEnd}
                  placeholder={t("cycles.endDate")}
                  className="border border-border rounded-md bg-input/60"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("cycles.cancel")}</Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!formName.trim() || !formStart || !formEnd || createMutation.isPending}
              >
                {createMutation.isPending ? t("cycles.creating") : t("cycles.create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
