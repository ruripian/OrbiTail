/**
 * 스프린트 — 목록(상태 훑기) → 상세(관리) 2단 구조.
 *
 * 목록: 스프린트마다 진척·기간·건수만. "지금 어떤 상태인가"를 한눈에 보는 자리.
 * 상세: 그 스프린트의 이슈 트리를 관리하고, 우측 백로그 패널에서 끌어오거나
 *       [이슈 가져오기] 팝업으로 담는다.
 *
 * 어떤 스프린트를 보는지는 URL(?sprint=)에 싣는다 — 뒤로가기가 목록으로 돌아가고 링크도 공유된다.
 * 번다운 등 통계는 리포트(AnalyticsView)가 맡는다.
 */

import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Zap, CheckCircle2, Play, Plus, ChevronRight, ChevronDown, Trash2, Inbox,
  MoreHorizontal, Pencil, Ban, ArrowLeft, ListPlus,
} from "lucide-react";
import { projectsApi } from "@/api/projects";
import { issuesApi } from "@/api/issues";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { PageTransition } from "@/components/motion";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PriorityGlyph } from "@/components/ui/priority-glyph";
/* 문서에서 이슈를 연결할 때 쓰는 팝업을 그대로 재사용한다 — 검색 + 프로젝트 이슈 트리가 이미 같은 요구다.
   (공용 성격이라 나중에 components/issues 로 옮길 여지가 있다) */
import { IssuePickerDialog } from "@/components/documents/IssuePickerDialog";
import { getStateIcon } from "@/constants/state-icons";
import { apiErrorMessage } from "@/lib/api-error";
import { formatDate } from "@/utils/date-format";
import { cn } from "@/lib/utils";
import type { Issue, Sprint, State } from "@/types";

interface Props {
  workspaceSlug: string;
  projectId: string;
  onIssueClick: (issueId: string) => void;
}

const fmt = (iso: string) => formatDate(iso);

/** 기간이 얼마나 지났는지(0~100) — 완료율과 나란히 두면 "일정 대비 진척"이 읽힌다 */
const timeProgress = (sprint: Sprint) => {
  const start = new Date(sprint.start_date).getTime();
  const end = new Date(sprint.end_date).getTime();
  if (end <= start) return 100;
  return Math.min(100, Math.max(0, Math.round(((Date.now() - start) / (end - start)) * 100)));
};

const daysLeft = (sprint: Sprint) =>
  Math.ceil((new Date(sprint.end_date).getTime() - Date.now()) / 86_400_000);

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: "진행 중", cls: "bg-blue-500/10 text-blue-600" },
  draft: { label: "예정", cls: "bg-muted text-muted-foreground" },
  completed: { label: "완료", cls: "bg-green-500/10 text-green-600" },
  cancelled: { label: "취소됨", cls: "bg-red-500/10 text-red-600" },
};

export function SprintView({ workspaceSlug, projectId, onIssueClick }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { perms } = useProjectPerms(workspaceSlug, projectId);
  const canEdit = !!perms.can_edit;

  const [searchParams, setSearchParams] = useSearchParams();
  const openSprintId = searchParams.get("sprint");
  const openSprint = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("sprint", id); else next.delete("sprint");
    setSearchParams(next);
  };

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [completeTarget, setCompleteTarget] = useState<Sprint | null>(null);
  const [moveTo, setMoveTo] = useState<string>("backlog");
  const [dropOnSprint, setDropOnSprint] = useState(false);
  const [dropOnBacklog, setDropOnBacklog] = useState(false);

  const [editTarget, setEditTarget] = useState<Sprint | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editStart, setEditStart] = useState<string | null>(null);
  const [editEnd, setEditEnd] = useState<string | null>(null);

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

  /* 이슈는 한 번에 받아 클라이언트에서 나눈다 — 섹션마다 요청하면 스프린트 수만큼 왕복이 생긴다. */
  const { data: allIssues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, "sprint-planning"],
    queryFn: () => issuesApi.list(workspaceSlug, projectId, { include_sub_issues: "true" }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sprints", workspaceSlug, projectId] });
    qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
  };

  /* 계획 화면에서 다루는 건 작업(Task)이다. 필드(Field)는 상태 없는 컨테이너라 제외. */
  const planIssues = useMemo(() => allIssues.filter((i: Issue) => !i.is_field), [allIssues]);
  const issuesOf = (sprintId: string | null) =>
    planIssues.filter((i: Issue) => (i.sprint ?? null) === sprintId);

  const doneCount = (issues: Issue[]) =>
    issues.filter((i) => stateMap.get(i.state ?? "")?.group === "completed").length;

  const current = sprints.find((s: Sprint) => s.id === openSprintId) ?? null;
  const draftSprints = sprints.filter((s: Sprint) => s.status === "draft");
  const backlog = issuesOf(null);

  /* 이슈는 트리다 — 부모 아래 자식을 들여쓴다.
     부모가 이 목록에 없으면(다른 스프린트/백로그) 그 자식은 최상위로 올린다. */
  const treeRows = (issues: Issue[]): { issue: Issue; depth: number; hasChildren: boolean }[] => {
    const ids = new Set(issues.map((i) => i.id));
    const childrenOf = new Map<string, Issue[]>();
    const roots: Issue[] = [];
    for (const issue of issues) {
      if (issue.parent && ids.has(issue.parent)) {
        childrenOf.set(issue.parent, [...(childrenOf.get(issue.parent) ?? []), issue]);
      } else {
        roots.push(issue);
      }
    }
    const out: { issue: Issue; depth: number; hasChildren: boolean }[] = [];
    const walk = (list: Issue[], depth: number) => {
      for (const issue of list) {
        const kids = childrenOf.get(issue.id) ?? [];
        out.push({ issue, depth, hasChildren: kids.length > 0 });
        if (kids.length > 0 && !collapsed.has(issue.id)) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  };

  /* ── 뮤테이션 ── */

  const assign = useMutation({
    mutationFn: ({ issueId, sprintId }: { issueId: string; sprintId: string | null }) =>
      issuesApi.update(workspaceSlug, projectId, issueId, { sprint: sprintId }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(apiErrorMessage(e, "배정 실패")),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      projectsApi.sprints.create(workspaceSlug, projectId, {
        name: formName, start_date: formStart!, end_date: formEnd!, status: "draft",
      }),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setFormName(""); setFormStart(null); setFormEnd(null);
    },
    onError: (e) => toast.error(apiErrorMessage(e, "생성 실패")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Sprint> }) =>
      projectsApi.sprints.update(workspaceSlug, projectId, id, data),
    onSuccess: () => { invalidate(); setEditTarget(null); toast.success("스프린트 수정됨"); },
    onError: (e) => toast.error(apiErrorMessage(e, "수정 실패")),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      projectsApi.sprints.update(workspaceSlug, projectId, id, { status: "cancelled" }),
    onSuccess: () => { invalidate(); toast.success("스프린트를 취소했습니다"); },
    onError: (e) => toast.error(apiErrorMessage(e, "취소 실패")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.sprints.delete(workspaceSlug, projectId, id),
    onSuccess: () => { invalidate(); openSprint(null); toast.success("스프린트 삭제됨"); },
    onError: (e) => toast.error(apiErrorMessage(e, "삭제 실패")),
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => projectsApi.sprints.start(workspaceSlug, projectId, id),
    onSuccess: () => { invalidate(); toast.success("스프린트를 시작했습니다"); },
    onError: (e) => toast.error(apiErrorMessage(e, "시작 실패")),
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: string }) =>
      projectsApi.sprints.complete(workspaceSlug, projectId, id, target),
    onSuccess: (r) => {
      invalidate();
      setCompleteTarget(null);
      toast.success(
        r.moved_issues > 0
          ? `스프린트 완료 — 미완료 ${r.moved_issues}건을 ${r.moved_to === "backlog" ? "백로그" : "다음 스프린트"}로 옮겼습니다`
          : "스프린트를 완료했습니다",
      );
    },
    onError: (e) => toast.error(apiErrorMessage(e, "완료 실패")),
  });

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  /* ── 공통 조각 ── */

  const IssueRow = ({
    issue, depth = 0, hasChildren = false, compact,
  }: { issue: Issue; depth?: number; hasChildren?: boolean; compact?: boolean }) => {
    const state = issue.state ? stateMap.get(issue.state) : null;
    const StateIcon = getStateIcon(state?.group);
    const isCollapsed = collapsed.has(issue.id);
    return (
      <div
        draggable={canEdit}
        onDragStart={(e) => {
          e.dataTransfer.setData("issue-id", issue.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => onIssueClick(issue.id)}
        style={{ paddingLeft: 10 + depth * 18 }}
        className={cn(
          "flex items-center gap-2 pr-2 py-1.5 rounded-lg hover:bg-accent/40 cursor-pointer",
          canEdit && "active:cursor-grabbing",
        )}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(issue.id); }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={isCollapsed ? "하위 이슈 펼치기" : "하위 이슈 접기"}
          >
            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : (
          !compact && <span className="w-3.5 shrink-0" />
        )}
        <StateIcon className="h-3.5 w-3.5 shrink-0" style={{ color: state?.color ?? "#9ca3af" }} />
        <PriorityGlyph priority={issue.priority} size={10} />
        <span className="flex-1 truncate text-sm">{issue.title}</span>
        {!compact && issue.assignee_details?.slice(0, 2).map((a) => (
          <AvatarInitials key={a.id} name={a.display_name || a.email} avatar={a.avatar} size="xs" />
        ))}
      </div>
    );
  };

  const SprintMenu = ({ sprint }: { sprint: Sprint }) => {
    if (!canEdit) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="shrink-0 p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="스프린트 관리"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            onClick={() => {
              setEditTarget(sprint);
              setEditName(sprint.name);
              setEditDesc(sprint.description ?? "");
              setEditStart(sprint.start_date);
              setEditEnd(sprint.end_date);
            }}
          >
            <Pencil className="h-3.5 w-3.5 mr-2" /> 수정
          </DropdownMenuItem>
          {sprint.status !== "cancelled" && (
            <DropdownMenuItem
              onClick={() => {
                if (window.confirm(`"${sprint.name}" 스프린트를 취소할까요? 담긴 이슈는 그대로 남습니다.`)) {
                  cancelMutation.mutate(sprint.id);
                }
              }}
            >
              <Ban className="h-3.5 w-3.5 mr-2" /> 취소
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              if (window.confirm(`"${sprint.name}" 스프린트를 삭제할까요? 담긴 이슈는 백로그로 돌아갑니다.`)) {
                deleteMutation.mutate(sprint.id);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" /> 삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  /** 목록·상세가 공유하는 다이얼로그 — 어느 화면에서든 같은 폼을 쓴다 */
  const Dialogs = () => (
    <>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cycles.create")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("cycles.name")}</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("cycles.startDate")}</Label>
                <DatePicker value={formStart} onChange={setFormStart} className="border border-border rounded-md bg-input/60" />
              </div>
              <div className="space-y-1">
                <Label>{t("cycles.endDate")}</Label>
                <DatePicker value={formEnd} onChange={setFormEnd} className="border border-border rounded-md bg-input/60" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
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

      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>스프린트 수정</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("cycles.name")}</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1">
              <Label>설명</Label>
              <textarea
                className="w-full min-h-[64px] rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="이번 스프린트의 목표"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("cycles.startDate")}</Label>
                <DatePicker value={editStart} onChange={setEditStart} className="border border-border rounded-md bg-input/60" />
              </div>
              <div className="space-y-1">
                <Label>{t("cycles.endDate")}</Label>
                <DatePicker value={editEnd} onChange={setEditEnd} className="border border-border rounded-md bg-input/60" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditTarget(null)}>{t("cycles.cancel")}</Button>
              <Button
                disabled={!editName.trim() || !editStart || !editEnd || updateMutation.isPending}
                onClick={() => editTarget && updateMutation.mutate({
                  id: editTarget.id,
                  data: {
                    name: editName.trim(),
                    description: editDesc.trim(),
                    start_date: editStart!,
                    end_date: editEnd!,
                  },
                })}
              >
                {updateMutation.isPending ? "저장 중..." : "저장"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!completeTarget} onOpenChange={(v) => !v && setCompleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>스프린트 완료</DialogTitle>
          </DialogHeader>
          {completeTarget && (() => {
            const remain = issuesOf(completeTarget.id).filter(
              (i) => !["completed", "cancelled"].includes(stateMap.get(i.state ?? "")?.group ?? ""),
            ).length;
            return (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  완료되지 않은 이슈 <span className="font-medium text-foreground">{remain}건</span>이 남아 있습니다. 어디로 옮길까요?
                </p>
                <div className="space-y-2">
                  {[
                    { value: "backlog", label: "백로그로", desc: "스프린트에서 떼어냅니다" },
                    ...draftSprints
                      .filter((s: Sprint) => s.id !== completeTarget.id)
                      .map((s: Sprint) => ({ value: s.id, label: s.name, desc: "예정 스프린트로 이관" })),
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setMoveTo(opt.value)}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left transition-colors",
                        moveTo === opt.value ? "border-primary bg-primary/5" : "hover:bg-accent/40",
                      )}
                    >
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setCompleteTarget(null)}>취소</Button>
                  <Button
                    disabled={completeMutation.isPending}
                    onClick={() => completeMutation.mutate({ id: completeTarget.id, target: moveTo })}
                  >
                    {completeMutation.isPending ? "완료 중..." : "완료"}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );

  /* ── 상세 ── */

  if (current) {
    const issues = issuesOf(current.id);
    const done = doneCount(issues);
    const badge = STATUS_BADGE[current.status];

    return (
      <PageTransition className="flex flex-col h-full overflow-hidden">
        <div className="shrink-0 border-b">
          <div className="flex items-center gap-3 px-4 py-3">
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={() => openSprint(null)}>
              <ArrowLeft className="h-3.5 w-3.5" />
              스프린트 목록
            </Button>
            <div className="w-px h-5 bg-border" />
            <h1 className="text-sm font-semibold truncate">{current.name}</h1>
            <Badge variant="secondary" className={cn("text-2xs px-1.5 py-0 shrink-0", badge.cls)}>{badge.label}</Badge>
            <span className="text-2xs text-muted-foreground shrink-0">
              {fmt(current.start_date)} ~ {fmt(current.end_date)}
            </span>

            <div className="ml-auto flex items-center gap-2">
              {canEdit && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setPickerOpen(true)}>
                  <ListPlus className="h-3.5 w-3.5" />
                  이슈 가져오기
                </Button>
              )}
              {canEdit && current.status === "draft" && (
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => startMutation.mutate(current.id)}>
                  <Play className="h-3.5 w-3.5" />
                  시작
                </Button>
              )}
              {canEdit && current.status === "active" && (
                <Button
                  size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                  onClick={() => { setMoveTo(draftSprints[0]?.id ?? "backlog"); setCompleteTarget(current); }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  완료
                </Button>
              )}
              <SprintMenu sprint={current} />
            </div>
          </div>

          {current.description && (
            <p className="px-4 pb-2 text-xs text-muted-foreground">{current.description}</p>
          )}

          {/* 진척 — 완료율 막대 위에 기간 경과 눈금. 둘의 간격이 곧 일정 대비 상태다. */}
          {issues.length > 0 && (
            <div className="px-4 pb-3">
              <div className="relative h-1.5 rounded-full bg-muted/50 overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((done / issues.length) * 100)}%` }} />
                {current.status === "active" && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-foreground/40"
                    style={{ left: `${timeProgress(current)}%` }}
                    title={`기간 경과 ${timeProgress(current)}%`}
                  />
                )}
              </div>
              <div className="flex items-center justify-between mt-1 text-2xs text-muted-foreground">
                <span>완료 {done} / {issues.length}</span>
                {current.status === "active" && (
                  <span>{daysLeft(current) >= 0 ? `${daysLeft(current)}일 남음` : `${Math.abs(daysLeft(current))}일 지남`}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 본문 — 좌: 스프린트 이슈 / 우: 백로그 */}
        <div className="flex flex-1 min-h-0">
          <div
            className={cn("flex-1 overflow-y-auto p-3 transition-colors", dropOnSprint && "bg-primary/5")}
            onDragOver={(e) => {
              if (!canEdit || !e.dataTransfer.types.includes("issue-id")) return;
              e.preventDefault();
              setDropOnSprint(true);
            }}
            onDragLeave={() => setDropOnSprint(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropOnSprint(false);
              const id = e.dataTransfer.getData("issue-id");
              if (id) assign.mutate({ issueId: id, sprintId: current.id });
            }}
          >
            {issues.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-16">
                <Zap className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">이 스프린트에 담긴 이슈가 없습니다.</p>
                <p className="text-xs text-muted-foreground/70">
                  오른쪽 백로그에서 끌어오거나 [이슈 가져오기]로 담으세요.
                </p>
              </div>
            ) : (
              treeRows(issues).map(({ issue, depth, hasChildren }) => (
                <IssueRow key={issue.id} issue={issue} depth={depth} hasChildren={hasChildren} />
              ))
            )}
          </div>

          {/* 백로그 패널 — 여기서 끌어다 왼쪽에 담고, 반대로 놓으면 스프린트에서 뺀다 */}
          <aside
            className={cn(
              "w-72 shrink-0 border-l flex flex-col transition-colors",
              dropOnBacklog && "bg-primary/5",
            )}
            onDragOver={(e) => {
              if (!canEdit || !e.dataTransfer.types.includes("issue-id")) return;
              e.preventDefault();
              setDropOnBacklog(true);
            }}
            onDragLeave={() => setDropOnBacklog(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropOnBacklog(false);
              const id = e.dataTransfer.getData("issue-id");
              if (id) assign.mutate({ issueId: id, sprintId: null });
            }}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0">
              <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold">백로그</span>
              <span className="text-2xs text-muted-foreground ml-auto">{backlog.length}건</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {backlog.length === 0 ? (
                <p className="px-2 py-6 text-xs text-muted-foreground/70 text-center">백로그가 비었습니다.</p>
              ) : (
                backlog.map((issue) => <IssueRow key={issue.id} issue={issue} compact />)
              )}
            </div>
          </aside>
        </div>

        {/* 가져오기 — 문서용 이슈 선택 팝업을 그대로 쓴다 */}
        <IssuePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          excludeIds={issues.map((i) => i.id)}
          onSelect={async (issue) => {
            await assign.mutateAsync({ issueId: issue.id, sprintId: current.id });
            toast.success(`"${issue.title}" 담김`);
          }}
        />

        <Dialogs />
      </PageTransition>
    );
  }

  /* ── 목록 ── */

  return (
    <PageTransition className="h-full overflow-y-auto">
      <div className="max-w-regular mx-auto p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold">스프린트</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              스프린트를 열어 이슈를 담고, 준비되면 시작합니다.
            </p>
          </div>
          {canEdit && (
            <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t("cycles.create")}
            </Button>
          )}
        </div>

        {sprints.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <Zap className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">아직 스프린트가 없습니다.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              스프린트를 만들고 백로그의 이슈를 담아 시작하세요.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sprints.map((s: Sprint) => {
              const list = issuesOf(s.id);
              const done = doneCount(list);
              const badge = STATUS_BADGE[s.status];
              const isActive = s.status === "active";
              return (
                <button
                  key={s.id}
                  onClick={() => openSprint(s.id)}
                  className={cn(
                    "w-full text-left rounded-xl border bg-card px-4 py-3 hover:bg-accent/30 transition-colors",
                    isActive && "border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{s.name}</span>
                    <Badge variant="secondary" className={cn("text-2xs px-1.5 py-0 shrink-0", badge.cls)}>{badge.label}</Badge>
                    <span className="text-2xs text-muted-foreground shrink-0">
                      {fmt(s.start_date)} ~ {fmt(s.end_date)}
                    </span>
                    <span className="text-2xs text-muted-foreground ml-auto shrink-0">
                      {list.length > 0 ? `${done} / ${list.length}` : "0건"}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </div>

                  {list.length > 0 && (
                    <div className="relative h-1 rounded-full bg-muted/50 overflow-hidden mt-2">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((done / list.length) * 100)}%` }} />
                      {isActive && (
                        <div className="absolute top-0 bottom-0 w-px bg-foreground/40" style={{ left: `${timeProgress(s)}%` }} />
                      )}
                    </div>
                  )}
                  {isActive && (
                    <p className="text-2xs text-muted-foreground mt-1">
                      {daysLeft(s) >= 0 ? `${daysLeft(s)}일 남음` : `${Math.abs(daysLeft(s))}일 지남`}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 백로그 — 목록에서도 얼마나 쌓였는지는 보이게 두되, 담는 건 상세에서 한다 */}
        <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-3 flex items-center gap-2">
          <Inbox className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm">백로그</span>
          <span className="text-2xs text-muted-foreground ml-auto">{backlog.length}건 대기</span>
        </div>
      </div>

      <Dialogs />
    </PageTransition>
  );
}
