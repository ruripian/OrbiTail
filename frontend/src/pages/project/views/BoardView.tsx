/**
 * Board 뷰 — 상태별 칸반 보드 + 드래그앤드롭
 * BoardPage의 로직을 패널 연동 방식으로 리팩토링
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, CalendarRange } from "lucide-react";
import { formatDate } from "@/utils/date-format";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { useIssueRefresh } from "@/hooks/useIssueMutations";
import { Button } from "@/components/ui/button";
import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { cn } from "@/lib/utils";
import { HoverLift, StaggerList, StaggerItem } from "@/components/motion";
import { motion } from "framer-motion";
import { useMotion, EASE_ORBIT } from "@/lib/motion-provider";
import { useRecentChangesStore } from "@/stores/recentChangesStore";
import type { Issue, State } from "@/types";

interface Props {
  workspaceSlug: string;
  projectId:     string;
  onIssueClick:  (issueId: string) => void;
  issueFilter?: Record<string, string>;
  readOnly?:    boolean;
}

export function BoardView({ workspaceSlug, projectId, onIssueClick, issueFilter, readOnly }: Props) {
  const { t } = useTranslation();
  const { isRich } = useMotion();
  // Phase 3.4 — 카드별 recently-changed strip. dict 통째로 구독하고 row마다 lookup.
  const recentChanges = useRecentChangesStore((s) => s.recent);
  const { refresh } = useIssueRefresh(workspaceSlug, projectId);
  const [createOpen, setCreateOpen]       = useState(false);
  const [selectedState, setSelectedState] = useState<State | null>(null);
  const [inlineStateId, setInlineStateId] = useState<string | null>(null);
  const [inlineTitle, setInlineTitle]     = useState("");

  const inlineCreateMutation = useMutation({
    mutationFn: ({ title, stateId }: { title: string; stateId: string }) =>
      issuesApi.create(workspaceSlug, projectId, {
        title,
        state: stateId,
        priority: "medium",
        project: projectId,
        ...(issueFilter?.category ? { category: issueFilter.category } : {}),
        ...(issueFilter?.sprint  ? { sprint:  issueFilter.sprint }  : {}),
      } as Partial<Issue>),
    onSuccess: () => {
      refresh();
      setInlineTitle("");
      setInlineStateId(null);
    },
  });

  /* 드래그 상태 */
  const [draggedIssueId, setDraggedIssueId] = useState<string | null>(null);
  const [dragOverStateId, setDragOverStateId] = useState<string | null>(null);

  const { data: issues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, issueFilter],
    queryFn:  () => issuesApi.list(workspaceSlug, projectId, issueFilter),
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn:  () => projectsApi.states.list(workspaceSlug, projectId),
  });

  const updateIssue = useMutation({
    mutationFn: ({ issueId, stateId }: { issueId: string; stateId: string }) =>
      issuesApi.update(workspaceSlug, projectId, issueId, { state: stateId }),
    onSuccess: () => {
      refresh();
    },
  });

  // 필드(Field) 이슈는 상태가 없는 상위 컨테이너 → 보드에서 제외.
  const taskIssues = issues.filter((i) => !i.is_field);
  const issuesByState = states.reduce<Record<string, Issue[]>>((acc, state) => {
    acc[state.id] = taskIssues.filter((i) => i.state === state.id);
    return acc;
  }, {});

  return (
    <div className="p-2 sm:p-4 h-full flex flex-col overflow-hidden">
      {/* 칸반 컬럼 — min-w로 최소 너비 보장, flex-1로 균등 분배, 모바일 터치 스크롤 */}
      <div className="flex gap-2 sm:gap-3 overflow-x-auto flex-1 pb-4 snap-x snap-mandatory sm:snap-none">
        {states.map((state) => (
          <div
            key={state.id}
            className={cn(
              "group flex flex-col min-w-[260px] sm:min-w-[220px] flex-1 flex-shrink-0 rounded-2xl p-2 transition-colors duration-base border-2 snap-start",
              dragOverStateId === state.id 
                ? "bg-secondary/20 border-primary/30" 
                : "bg-transparent border-transparent"
            )}
            onDragEnter={() => setDragOverStateId(state.id)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStateId(state.id);
            }}
            onDragLeave={(e) => {
              // Ignore leave events if dragging child elements inside the column
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                if (dragOverStateId === state.id) setDragOverStateId(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverStateId(null);
              const issueId = e.dataTransfer.getData("issueId");
              if (issueId) updateIssue.mutate({ issueId, stateId: state.id });
              setDraggedIssueId(null);
            }}
          >
            {/* Phase 2.2 — count 배지에 state-{group}-fill / -text 토큰 적용.
                헤더 border / dot 색은 사용자 커스텀(state.color)을 그대로 사용. */}
            <div className="flex items-center gap-2.5 mb-3 px-2 pb-3" style={{ borderBottom: `2px solid ${state.color}20` }}>
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ background: state.color }}
              />
              <span className="text-sm font-semibold">{state.name}</span>
              <span
                className="text-xs px-1.5 py-0.5 rounded-full ml-auto font-medium"
                style={{
                  background: `var(--state-${state.group}-fill)`,
                  color: `var(--state-${state.group}-text)`,
                }}
              >
                {issuesByState[state.id]?.length ?? 0}
              </span>
              {!readOnly && (
                <Button
                  variant="ghost" size="icon" className="h-5 w-5"
                  onClick={() => { setSelectedState(state); setCreateOpen(true); }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            <StaggerList className="space-y-2 flex-1 px-1">
              {(issuesByState[state.id] ?? []).map((issue) => {
                const isDraggingThis = draggedIssueId === issue.id;
                const recent = recentChanges[issue.id];
                const recentColor = recent?.color;
                return (
                  <StaggerItem key={issue.id}>
                  {/* Phase 2.8 — FLIP: 같은 layoutId 카드가 컬럼을 옮길 때 위치 트윈.
                      rich 모드만 활성화. minimal/reduced-motion에서는 즉시 점프. */}
                  <motion.div
                    layout={isRich}
                    layoutId={isRich ? `board-card-${issue.id}` : undefined}
                    transition={{ duration: 0.22, ease: EASE_ORBIT }}
                  >
                  <HoverLift>
                  <div
                    draggable={!readOnly}
                    data-recently-changed={recent ? "true" : undefined}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("issueId", issue.id);
                      setTimeout(() => setDraggedIssueId(issue.id), 0);
                    }}
                    onDragEnd={() => {
                      setDraggedIssueId(null);
                      setDragOverStateId(null);
                    }}
                    onClick={() => onIssueClick(issue.id)}
                    style={recent && recentColor ? ({ ["--recent-color" as never]: recentColor } as React.CSSProperties) : undefined}
                    className={cn(
                      "rounded-xl border glass p-3 text-sm cursor-pointer transition-all duration-base",
                      isDraggingThis
                        ? "opacity-40 border-dashed border-primary/50 shadow-none scale-95"
                        : "border-border hover:shadow-lg hover:border-border active:cursor-grabbing"
                    )}
                  >
                    <p
                      className={cn(
                        "font-medium mb-2 line-clamp-2 text-sm",
                        state.group === "cancelled" && "line-through text-muted-foreground",
                      )}
                    >
                      {issue.title}
                    </p>

                    {/* 2행: 시작일 → 마감일 (기한 색상 차별) */}
                    {(issue.start_date || issue.due_date) && (() => {
                      const stateGroup = state.group;
                      const isActiveState = stateGroup === "started" || stateGroup === "unstarted";
                      const today = new Date(); today.setHours(0, 0, 0, 0);
                      const due   = issue.due_date ? new Date(issue.due_date) : null;
                      if (due) due.setHours(0, 0, 0, 0);
                      const diff  = due ? Math.ceil((due.getTime() - today.getTime()) / 86_400_000) : null;
                      const dueClass =
                        (!isActiveState || diff === null) ? "text-muted-foreground" :
                        diff < 0      ? "text-red-500 font-medium" :
                        diff <= 3     ? "text-orange-400 font-medium" :
                        "text-muted-foreground";
                      return (
                        <div className="flex items-center gap-1.5 mb-2 text-2xs">
                          <CalendarRange className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                          <span className="text-muted-foreground">
                            {issue.start_date ? formatDate(issue.start_date) : "—"}
                          </span>
                          <span className="text-muted-foreground/40">→</span>
                          <span className={dueClass}>
                            {issue.due_date ? formatDate(issue.due_date) : "—"}
                          </span>
                        </div>
                      );
                    })()}

                    <div className="flex items-center justify-between min-h-[20px]">
                      {issue.assignee_details.length > 0 ? (
                        <div className="flex -space-x-1">
                          {issue.assignee_details.slice(0, 3).map((a) => (
                            <AvatarInitials key={a.id} name={a.display_name} avatar={a.avatar} size="xs" ring title={a.display_name} />
                          ))}
                          {issue.assignee_details.length > 3 && (
                            <span className="h-5 w-5 rounded-full bg-muted text-3xs flex items-center justify-center border-2 border-background text-muted-foreground">
                              +{issue.assignee_details.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-2xs text-muted-foreground/50">{t("issues.picker.none")}</span>
                      )}
                      {/* Phase 3.3 — IssueDetailPage의 issueRef와 같은 layoutId. 모달 열림 시 시각적으로 이어짐. */}
                      <motion.span
                        layoutId={`issue-ref-${issue.id}`}
                        className="text-2xs text-muted-foreground/60 font-mono"
                      >
                        {issue.sequence_id}
                      </motion.span>
                    </div>
                  </div>
                  </HoverLift>
                  </motion.div>
                  </StaggerItem>
                );
              })}

              {/* 드래그 오버 시 카드 이동 플레이스홀더 */}
              {dragOverStateId === state.id && draggedIssueId && !issuesByState[state.id]?.some(i => i.id === draggedIssueId) && (
                <div className="h-24 mt-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 flex items-center justify-center animate-in fade-in zoom-in-95 duration-base cursor-default">
                  <span className="text-primary/60 text-xs font-medium flex items-center gap-2">
                    {t("views.board.moveHere")}
                  </span>
                </div>
              )}

              {/* 컬럼 하단 인라인 이슈 추가 */}
              {readOnly ? null : inlineStateId === state.id ? (
                <div className="mt-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-2.5">
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
                    className="w-full bg-transparent outline-none text-xs text-foreground placeholder:text-muted-foreground/50"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setInlineStateId(state.id); setInlineTitle(""); }}
                  className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs font-medium text-muted-foreground/70 opacity-0 group-hover:opacity-100 hover:border-primary/50 hover:bg-primary/5 hover:text-primary transition-all duration-fast"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("views.addIssue")}
                </button>
              )}
            </StaggerList>
          </div>
        ))}
      </div>

      <IssueCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        states={states}
        defaultStateId={selectedState?.id}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        defaultCategoryId={issueFilter?.category}
        defaultSprintId={issueFilter?.sprint}
      />
    </div>
  );
}
