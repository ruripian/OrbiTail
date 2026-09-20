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
import { useTranslation, Trans } from "react-i18next";
import { toast } from "sonner";
import {
  Zap, CheckCircle2, Play, Plus, ChevronRight, ChevronDown, Trash2, Inbox,
  MoreHorizontal, Pencil, Ban, ArrowLeft, ListPlus, CalendarClock, AlertTriangle, BarChart3,
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
import type { Issue, ProjectEvent, Sprint, State, User } from "@/types";
import { SprintBurndown } from "@/components/charts/SprintBurndown";
import {
  sprintMetrics, groupOf, formatCount,
  GROUP_ORDER, GROUP_LABEL_KEY, GROUP_COLOR,
  type SprintMetrics,
} from "./sprint-metrics";
import { useDialogs } from "@/lib/dialogs";

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

const STATUS_BADGE: Record<string, { labelKey: string; cls: string }> = {
  active: { labelKey: "sprints.status.active", cls: "bg-blue-500/10 text-blue-600" },
  draft: { labelKey: "sprints.status.draft", cls: "bg-muted text-muted-foreground" },
  completed: { labelKey: "sprints.status.completed", cls: "bg-green-500/10 text-green-600" },
  cancelled: { labelKey: "sprints.status.cancelled", cls: "bg-red-500/10 text-red-600" },
};

export function SprintView({ workspaceSlug, projectId, onIssueClick }: Props) {
  const { t } = useTranslation();
  const { confirm, confirmDelete } = useDialogs();
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
  /* 작업 / 리포트 — 번다운은 회고용이라 작업 목록에 섞으면 양쪽 다 손해다.
     담당자 부하는 지금 재배정하게 만드는 정보라 헤더에 경고 한 줄만 남긴다. */
  const [detailTab, setDetailTab] = useState<"work" | "report">("work");
  const [dropOnSprint, setDropOnSprint] = useState(false);
  const [dropOnBacklog, setDropOnBacklog] = useState(false);

  const [editTarget, setEditTarget] = useState<Sprint | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editStart, setEditStart] = useState<string | null>(null);
  const [editEnd, setEditEnd] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
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
    /* include_all_sprints — 없으면 완료·취소된 스프린트의 이슈가 응답에서 빠져
       그 스프린트가 항상 "0건" 으로 보인다(이슈를 옮겨 넣어도 변화가 없음). */
    queryFn: () => issuesApi.list(workspaceSlug, projectId, {
      include_sub_issues: "true", include_all_sprints: "true",
    }),
  });

  /* 담당자별 부하의 "일정 N일" 계산용 — 스프린트 기간과 겹치는 프로젝트 일정 */
  const { data: projectEvents = [] } = useQuery({
    queryKey: ["project-events", workspaceSlug, projectId],
    queryFn: () => projectsApi.events.list(workspaceSlug, projectId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sprints", workspaceSlug, projectId] });
    qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
  };

  /* 계획 화면에서 다루는 건 작업(Task)이다. 필드(Field)는 상태 없는 컨테이너라 제외. */
  const planIssues = useMemo(() => allIssues.filter((i: Issue) => !i.is_field), [allIssues]);
  const issuesOf = (sprintId: string | null) =>
    planIssues.filter((i: Issue) => (i.sprint ?? null) === sprintId);

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
    onError: (e) => toast.error(apiErrorMessage(e, t("sprints.assignFailed"))),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      projectsApi.sprints.create(workspaceSlug, projectId, {
        name: formName, description: formDesc.trim(), start_date: formStart!, end_date: formEnd!, status: "draft",
      }),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setFormName(""); setFormDesc(""); setFormStart(null); setFormEnd(null);
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("sprints.createFailed"))),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Sprint> }) =>
      projectsApi.sprints.update(workspaceSlug, projectId, id, data),
    onSuccess: () => { invalidate(); setEditTarget(null); toast.success(t("sprints.updated")); },
    onError: (e) => toast.error(apiErrorMessage(e, t("sprints.updateFailed"))),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      projectsApi.sprints.update(workspaceSlug, projectId, id, { status: "cancelled" }),
    onSuccess: () => { invalidate(); toast.success(t("sprints.cancelled")); },
    onError: (e) => toast.error(apiErrorMessage(e, t("sprints.cancelFailed"))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.sprints.delete(workspaceSlug, projectId, id),
    onSuccess: () => { invalidate(); openSprint(null); toast.success(t("sprints.deleted")); },
    onError: (e) => toast.error(apiErrorMessage(e, t("sprints.deleteFailed"))),
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => projectsApi.sprints.start(workspaceSlug, projectId, id),
    onSuccess: () => { invalidate(); toast.success(t("sprints.started")); },
    onError: (e) => toast.error(apiErrorMessage(e, t("sprints.startFailed"))),
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: string }) =>
      projectsApi.sprints.complete(workspaceSlug, projectId, id, target),
    onSuccess: (r) => {
      invalidate();
      setCompleteTarget(null);
      toast.success(
        r.moved_issues > 0
          ? t("sprints.completedMoved", { count: r.moved_issues, target: r.moved_to === "backlog" ? t("sprints.toBacklog") : t("sprints.toNextSprint") })
          : t("sprints.completedPlain"),
      );
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("sprints.completeFailed"))),
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
        className={cn(
          "relative flex min-h-[34px] items-center gap-2 rounded-lg py-1.5 pr-2 hover:bg-accent/40 cursor-pointer",
          canEdit && "active:cursor-grabbing",
        )}
        style={{ paddingLeft: 10 + depth * 20 }}
      >
        {/* 들여쓰기 안내선 — 여백만으로는 어느 이슈의 하위인지 눈으로 못 따라간다 */}
        {depth > 0 && Array.from({ length: depth }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
            style={{ left: 16 + i * 20 }}
          />
        ))}
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(issue.id); }}
            className="shrink-0 rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={isCollapsed ? t("sprints.expandSubIssues") : t("sprints.collapseSubIssues")}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        ) : (
          !compact && <span className="w-4 shrink-0" />
        )}
        <StateIcon className="h-4 w-4 shrink-0" style={{ color: state?.color ?? "#9ca3af" }} />
        <PriorityGlyph priority={issue.priority} size={12} />
        <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
        {/* 담당자 자리는 비어 있어도 유지 — 있고 없고에 따라 행 끝이 흔들리지 않게 */}
        {!compact && (
          <span className="flex w-11 shrink-0 justify-end gap-0.5">
            {issue.assignee_details?.slice(0, 2).map((a) => (
              <AvatarInitials key={a.id} name={a.display_name || a.email} avatar={a.avatar} size="xs" />
            ))}
          </span>
        )}
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
            title={t("sprints.manage")}
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
            <Pencil className="h-3.5 w-3.5 mr-2" /> {t("sprints.edit")}
          </DropdownMenuItem>
          {sprint.status !== "cancelled" && (
            <DropdownMenuItem
              onClick={async () => {
                if (await confirm(t("sprints.cancelConfirm", { name: sprint.name }))) {
                  cancelMutation.mutate(sprint.id);
                }
              }}
            >
              <Ban className="h-3.5 w-3.5 mr-2" /> {t("common.cancel")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={async () => {
              if (await confirmDelete(t("sprints.deleteConfirm", { name: sprint.name }))) {
                deleteMutation.mutate(sprint.id);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" /> {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  /** 목록·상세가 공유하는 다이얼로그 — 어느 화면에서든 같은 폼을 쓴다.
   *  `<Dialogs />` 로 쓰지 말고 `{Dialogs()}` 로 부른다. 렌더 안에서 만든 함수라 컴포넌트로 쓰면
   *  렌더마다 새 타입이 되어 통째로 다시 마운트되고, 글자를 칠 때마다 입력 포커스가 날아간다. */
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
            {/* 수정 창과 같은 칸 — 만들 때부터 목표를 적어 두면 목록·상세 헤더에 바로 보인다 */}
            <div className="space-y-1">
              <Label>{t("sprints.description")}</Label>
              <textarea
                className="w-full min-h-[64px] rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder={t("sprints.goalPlaceholder")}
              />
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
            <DialogTitle>{t("sprints.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("cycles.name")}</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1">
              <Label>{t("sprints.description")}</Label>
              <textarea
                className="w-full min-h-[64px] rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder={t("sprints.goalPlaceholder")}
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
                {updateMutation.isPending ? t("documents.templates.saving") : t("documents.templates.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!completeTarget} onOpenChange={(v) => !v && setCompleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sprints.completeTitle")}</DialogTitle>
          </DialogHeader>
          {completeTarget && (() => {
            const remain = issuesOf(completeTarget.id).filter(
              (i) => !["completed", "cancelled"].includes(stateMap.get(i.state ?? "")?.group ?? ""),
            ).length;
            return (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  <Trans i18nKey="sprints.completeBody" values={{ count: remain }} components={{ b: <span className="font-medium text-foreground" /> }} />
                </p>
                <div className="space-y-2">
                  {[
                    { value: "backlog", label: t("sprints.toBacklogOpt"), desc: t("sprints.toBacklogDesc") },
                    ...draftSprints
                      .filter((s: Sprint) => s.id !== completeTarget.id)
                      .map((s: Sprint) => ({ value: s.id, label: s.name, desc: t("sprints.toPlannedDesc") })),
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
                  <Button variant="outline" onClick={() => setCompleteTarget(null)}>{t("common.cancel")}</Button>
                  <Button
                    disabled={completeMutation.isPending}
                    onClick={() => completeMutation.mutate({ id: completeTarget.id, target: moveTo })}
                  >
                    {completeMutation.isPending ? t("sprints.completing") : t("sprints.complete")}
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
    const badge = STATUS_BADGE[current.status];
    const metrics = sprintMetrics(issues, stateMap);
    const loads = buildLoads(issues, stateMap, projectEvents, current);
    const avgLoad = loads.length ? loads.reduce((n, l) => n + l.value, 0) / loads.length : 0;
    const overloaded = loads.length > 1 ? loads.filter((l) => l.value > avgLoad * 1.5) : [];

    return (
      <PageTransition className="flex flex-col h-full overflow-hidden">
        {/* 헤더는 두 줄로 끝낸다 — 제목/조작, 그리고 진척 한 줄.
            설명·범례·경고를 각각 한 단씩 쌓으면 본문 전에 화면 위쪽 절반이 메타데이터가 된다. */}
        <div className="shrink-0 border-b">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={() => openSprint(null)}>
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("sprints.list")}
            </Button>
            <h1 className="shrink-0 text-sm font-semibold truncate">{current.name}</h1>
            <Badge variant="secondary" className={cn("shrink-0 px-1.5 py-0 text-2xs", badge.cls)}>{t(badge.labelKey)}</Badge>
            {/* 스프린트 목표는 제목 옆에 붙인다 — 한 단을 차지할 만큼 긴 정보가 아니다 */}
            {current.description && (
              <span className="hidden min-w-0 truncate text-xs text-muted-foreground lg:inline" title={current.description}>
                {current.description}
              </span>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {canEdit && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setPickerOpen(true)}>
                  <ListPlus className="h-3.5 w-3.5" />
                  {t("sprints.importIssues")}
                </Button>
              )}
              {canEdit && current.status === "draft" && (
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => startMutation.mutate(current.id)}>
                  <Play className="h-3.5 w-3.5" />
                  {t("sprints.start")}
                </Button>
              )}
              {canEdit && current.status === "active" && (
                <Button
                  size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                  onClick={() => { setMoveTo(draftSprints[0]?.id ?? "backlog"); setCompleteTarget(current); }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("sprints.complete")}
                </Button>
              )}
              <SprintMenu sprint={current} />
            </div>
          </div>

          {/* 진척 한 줄 — 숫자 / 분포 막대(기간 눈금) / 기간·남은 일수.
              그룹별 건수는 아래 작업 탭의 섹션 헤더가 이미 말하고 있으므로 여기선 뺀다. */}
          {issues.length > 0 && (
            <div className="flex items-center gap-3 px-4 pb-2.5">
              <span className="shrink-0 text-xs tabular-nums">
                <span className="font-semibold">{formatCount(metrics.done, t)}</span>
                <span className="text-muted-foreground"> / {formatCount(metrics.total, t)} · {metrics.percent}%</span>
              </span>
              <div className="relative min-w-0 flex-1">
                <DistributionBar metrics={metrics} height={6} />
                {current.status === "active" && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-foreground/50"
                    style={{ left: `${timeProgress(current)}%` }}
                    title={t("sprints.timeElapsed", { percent: timeProgress(current) })}
                  />
                )}
              </div>
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                <span className="hidden sm:inline">{fmt(current.start_date)} ~ {fmt(current.end_date)}</span>
                {current.status === "active" && (
                  <span className="sm:before:content-['_·_']">
                    {daysLeft(current) >= 0 ? t("sprints.daysLeft", { count: daysLeft(current) }) : t("sprints.daysOver", { count: Math.abs(daysLeft(current)) })}
                  </span>
                )}
              </span>
            </div>
          )}

          {/* 탭 — 기존 이슈 상세와 같은 WAI-ARIA tablist 패턴 */}
          <div
            role="tablist"
            aria-label={t("sprints.detailTabs")}
            className="flex gap-0.5 px-3"
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                setDetailTab((v) => (v === "work" ? "report" : "work"));
                e.preventDefault();
              }
            }}
          >
            {([
              { id: "work" as const, label: t("sprints.tabWork"), icon: ListPlus },
              { id: "report" as const, label: t("sprints.tabReport"), icon: BarChart3 },
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                id={`sprint-tab-${id}`}
                aria-selected={detailTab === id}
                aria-controls={`sprint-tabpanel-${id}`}
                tabIndex={detailTab === id ? 0 : -1}
                onClick={() => setDetailTab(id)}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                  detailTab === id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {/* 과부하 경고는 배너 한 단을 잡아먹을 일이 아니라 "리포트에 볼 게 있다" 는 신호다 */}
                {id === "report" && overloaded.length > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-px text-2xs font-medium text-amber-700 dark:text-amber-400"
                    title={t("sprints.overloaded", { names: overloaded.map((l) => l.user.display_name || l.user.email).join(", ") })}
                  >
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {overloaded.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 리포트 탭 — 번다운·부하는 회고/스탠드업용이라 작업 목록에서 뺐다 */}
        {detailTab === "report" ? (
          <div
            role="tabpanel"
            id="sprint-tabpanel-report"
            aria-labelledby="sprint-tab-report"
            className="flex-1 overflow-y-auto"
          >
            <div className="mx-auto max-w-regular space-y-4 p-4">
              {issues.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  {t("sprints.noMetrics")}
                </p>
              ) : (
                <>
                  <SprintBurndown sprint={current} issues={issues} states={states} />
                  {loads.length > 0 && (
                    <div className="rounded-xl border p-4">
                      <LoadPanel loads={loads} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
        /* 작업 탭 — 좌: 스프린트 이슈 / 우: 백로그 */
        <div
          role="tabpanel"
          id="sprint-tabpanel-work"
          aria-labelledby="sprint-tab-work"
          className="flex flex-1 min-h-0"
        >
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
            <div className="mx-auto max-w-regular">
            {issues.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-16">
                <Zap className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">{t("sprints.emptySprint")}</p>
                <p className="text-xs text-muted-foreground/70">
                  {t("sprints.emptySprintHint")}
                </p>
              </div>
            ) : (
              <>
                {/* 상태 그룹으로 묶는다 — 평면 나열은 20건만 넘어도 뭐가 막혔는지 안 보인다.
                    하위 이슈는 부모 아래 그대로 두고, 그룹은 최상위 이슈 기준으로 나눈다. */}
                {GROUP_ORDER.map((g) => {
                  /* 최상위 이슈의 그룹으로 나누고, 그 아래 자손은 부모를 따라간다.
                     깊이만 보고 거르면 부모가 빠진 자식이 엉뚱한 부모에 붙는다. */
                  const rows: ReturnType<typeof treeRows> = [];
                  let inGroup = false;
                  for (const row of treeRows(issues)) {
                    if (row.depth === 0) inGroup = groupOf(row.issue, stateMap) === g;
                    if (inGroup) rows.push(row);
                  }
                  const roots = rows.filter(({ depth }) => depth === 0);
                  if (roots.length === 0) return null;
                  return (
                    <section key={g} className="mb-2">
                      {/* 색은 라벨 자체가 들고 간다 — 점 + 굵은 제목 + 숫자 두 개는 행보다 무거웠다 */}
                      <div className="mb-1 mt-3 flex items-center gap-2 px-2.5">
                        <span
                          className="text-2xs font-semibold uppercase tracking-widest"
                          style={{ color: GROUP_COLOR[g] }}
                        >
                          {t(GROUP_LABEL_KEY[g])}
                        </span>
                        <span className="text-2xs tabular-nums text-muted-foreground">
                          {formatCount(roots.length, t)}
                        </span>
                        <span className="ml-1 h-px flex-1 bg-border/60" />
                      </div>
                      {rows.map(({ issue, depth, hasChildren }) => (
                        <IssueRow key={issue.id} issue={issue} depth={depth} hasChildren={hasChildren} />
                      ))}
                    </section>
                  );
                })}

              </>
            )}
            </div>
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
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
              <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground">{t("sprints.backlog")}</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{backlog.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {backlog.length === 0 ? (
                <p className="px-2 py-6 text-xs text-muted-foreground/70 text-center">{t("sprints.backlogEmpty")}</p>
              ) : (
                backlog.map((issue) => <IssueRow key={issue.id} issue={issue} compact />)
              )}
            </div>
          </aside>
        </div>
        )}

        {/* 가져오기 — 문서용 이슈 선택 팝업을 그대로 쓴다 */}
        <IssuePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          excludeIds={issues.map((i) => i.id)}
          onSelect={async (issue) => {
            await assign.mutateAsync({ issueId: issue.id, sprintId: current.id });
            toast.success(t("sprints.addedIssue", { title: issue.title }));
          }}
        />

        {Dialogs()}
      </PageTransition>
    );
  }

  /* ── 목록 ── */

  /* 상태로 묶는다 — 지금 돌아가는 스프린트 하나가 지난 열 개보다 중요한데,
     전부 같은 크기 카드로 깔면 그게 안 보인다. 진행 중만 펼치고 나머지는 한 줄. */
  const activeSprints = sprints.filter((s: Sprint) => s.status === "active");
  const pastSprints = sprints.filter(
    (s: Sprint) => s.status === "completed" || s.status === "cancelled",
  );

  return (
    <PageTransition className="h-full overflow-y-auto">
      <div className="max-w-regular mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-semibold">{t("sprints.title")}</h1>
          {canEdit && (
            <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t("cycles.create")}
            </Button>
          )}
        </div>

        {sprints.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed p-10 text-center">
            <Zap className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t("sprints.none")}</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {t("sprints.noneHint")}
            </p>
          </div>
        ) : (
          <>
            {activeSprints.length > 0 && (
              <>
                <SectionLabel>{t("sprints.status.active")}</SectionLabel>
                <div className="space-y-2">
                  {activeSprints.map((s: Sprint) => (
                    <ActiveSprintCard key={s.id} sprint={s} m={sprintMetrics(issuesOf(s.id), stateMap)} onOpen={() => openSprint(s.id)} />
                  ))}
                </div>
              </>
            )}
            {draftSprints.length > 0 && (
              <>
                <SectionLabel>{t("sprints.status.draft")}</SectionLabel>
                {draftSprints.map((s: Sprint) => (
                  <SprintRow key={s.id} sprint={s} m={sprintMetrics(issuesOf(s.id), stateMap)} onOpen={() => openSprint(s.id)} />
                ))}
              </>
            )}
            {pastSprints.length > 0 && (
              <>
                <SectionLabel>{t("sprints.past")}</SectionLabel>
                {pastSprints.map((s: Sprint) => (
                  <SprintRow key={s.id} sprint={s} m={sprintMetrics(issuesOf(s.id), stateMap)} onOpen={() => openSprint(s.id)} />
                ))}
              </>
            )}
          </>
        )}

        {/* 백로그 — 목록에서도 얼마나 쌓였는지는 보이게 두되, 담는 건 상세에서 한다 */}
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2">
          <Inbox className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-sm text-muted-foreground">{t("sprints.backlog")}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{t("sprints.backlogWaiting", { count: backlog.length })}</span>
        </div>
      </div>

      {Dialogs()}
    </PageTransition>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pt-3 pb-1 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

/** 진행 중 — 이 화면에서 유일하게 펼쳐 보여주는 카드 */
function ActiveSprintCard({ sprint, m, onOpen }: { sprint: Sprint; m: SprintMetrics; onOpen: () => void }) {
  const { t } = useTranslation();
  const elapsed = timeProgress(sprint);
  const left = daysLeft(sprint);
  /* 기간은 60% 지났는데 완료가 30% 면 30포인트 뒤진 것 */
  const behind = elapsed - m.percent;
  return (
    <button
      onClick={onOpen}
      className="w-full rounded-xl border border-primary/40 bg-card p-4 text-left transition-colors hover:bg-accent/20"
    >
      <div className="flex items-baseline gap-2">
        <span className="truncate text-base font-semibold">{sprint.name}</span>
        {sprint.description && (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {sprint.description}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs tabular-nums">
          <span className="hidden text-muted-foreground sm:inline">
            {fmt(sprint.start_date)} ~ {fmt(sprint.end_date)} ·{" "}
          </span>
          <span className={cn(left < 0 ? "font-medium text-amber-600" : "text-muted-foreground")}>
            {left >= 0 ? t("sprints.daysLeft", { count: left }) : t("sprints.daysOver", { count: Math.abs(left) })}
          </span>
        </span>
      </div>

      {m.total === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("sprints.cardEmpty")}
        </p>
      ) : (
        <>
          <div className="mt-2.5 flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg font-semibold leading-none">
              {formatCount(m.done, t)}
            </span>
            <span className="text-xs text-muted-foreground">
              / {formatCount(m.total, t)} · {m.percent}%
            </span>
          </div>
          <div className="relative mt-2">
            <DistributionBar metrics={m} height={8} />
            <div
              className="absolute top-0 bottom-0 w-px bg-foreground/50"
              style={{ left: `${elapsed}%` }}
              title={t("sprints.timeElapsed", { percent: elapsed })}
            />
          </div>
          {/* 색 점 범례는 이 카드에만 둔다 — 목록 전체에 반복하면 그게 소음이 된다 */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
            {GROUP_ORDER.filter((g) => m.byGroup[g] > 0).map((g) => (
              <span key={g} className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: GROUP_COLOR[g] }} />
                {t(GROUP_LABEL_KEY[g])} {m.byGroup[g]}
              </span>
            ))}
            {behind >= 15 && (
              <span className="ml-auto font-medium text-amber-600">{t("sprints.behind", { percent: behind })}</span>
            )}
          </div>
        </>
      )}
    </button>
  );
}

/** 예정·지난 — 이름/기간/양만. 자세한 건 열어서 본다. */
function SprintRow({ sprint, m, onOpen }: { sprint: Sprint; m: SprintMetrics; onOpen: () => void }) {
  const { t } = useTranslation();
  const isPast = sprint.status === "completed" || sprint.status === "cancelled";
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/40"
    >
      <span className="flex-1 truncate text-sm">{sprint.name}</span>
      {sprint.status === "cancelled" && (
        <Badge variant="secondary" className={cn("shrink-0 px-1.5 py-0 text-2xs", STATUS_BADGE.cancelled.cls)}>
          {t(STATUS_BADGE.cancelled.labelKey)}
        </Badge>
      )}
      <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
        {fmt(sprint.start_date)} ~ {fmt(sprint.end_date)}
      </span>
      {/* 예정은 "얼마나 담겼나", 지난 건 "얼마나 끝냈나" 가 궁금하다 */}
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {isPast ? `${m.percent}%` : formatCount(m.total, t)}
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

/* ── 상태 분포 막대 — 완료율 하나보다 "어디에 몰려 있는지" 를 보여준다 ── */
function DistributionBar({
  metrics, height = 6,
}: { metrics: ReturnType<typeof sprintMetrics>; height?: number }) {
  const { t } = useTranslation();
  if (metrics.total === 0) return null;
  return (
    <div className="flex h-full w-full overflow-hidden rounded-full bg-muted/50" style={{ height }}>
      {GROUP_ORDER.map((g) => {
        const v = metrics.byGroup[g];
        if (v <= 0) return null;
        return (
          <div
            key={g}
            style={{ width: `${(v / metrics.total) * 100}%`, backgroundColor: GROUP_COLOR[g] }}
            title={`${t(GROUP_LABEL_KEY[g])} ${formatCount(v, t)}`}
          />
        );
      })}
    </div>
  );
}

/* ── 담당자별 부하 ──
 * OrbiTail 의 차별점. 다른 도구는 팀원이 언제 자리에 없는지 몰라 가용량을 손으로 받는데,
 * 우리는 프로젝트 캘린더를 이미 갖고 있어서 스프린트 기간과 겹치는 일정을 직접 셀 수 있다.
 * 그래서 "이슈 8건을 든 사람이 그 기간에 일정 3일로 막혀 있다" 까지 말할 수 있다. */
interface Load {
  user: User;
  value: number;
  done: number;
  busyDays: number;
}

function buildLoads(
  issues: Issue[],
  stateMap: Map<string, State>,
  events: ProjectEvent[],
  sprint: Sprint,
): Load[] {
  const map = new Map<string, Load>();
  for (const issue of issues) {
    const isDone = groupOf(issue, stateMap) === "completed";
    for (const a of issue.assignee_details ?? []) {
      const cur = map.get(a.id) ?? { user: a, value: 0, done: 0, busyDays: 0 };
      cur.value += 1;
      if (isDone) cur.done += 1;
      map.set(a.id, cur);
    }
  }

  /* 스프린트 기간과 겹치는 날짜만 센다. 기간 이벤트는 겹치는 일수만큼. */
  for (const ev of events) {
    const from = ev.date > sprint.start_date ? ev.date : sprint.start_date;
    const to = (ev.end_date ?? ev.date) < sprint.end_date ? (ev.end_date ?? ev.date) : sprint.end_date;
    if (from > to) continue;
    const days = Math.floor(
      (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000,
    ) + 1;
    for (const uid of ev.participants ?? []) {
      const cur = map.get(uid);
      if (cur) cur.busyDays += days;
    }
  }

  return [...map.values()].sort((a, b) => b.value - a.value);
}

function LoadPanel({ loads }: { loads: Load[] }) {
  const { t } = useTranslation();
  if (loads.length === 0) return null;
  const max = Math.max(...loads.map((l) => l.value), 1);
  /* 평균의 1.5배를 넘으면 과부하로 본다 — 절대 기준을 두면 팀마다 안 맞는다 */
  const avg = loads.reduce((s, l) => s + l.value, 0) / loads.length;
  const heavy = (v: number) => loads.length > 1 && v > avg * 1.5;

  return (
    <div className="px-4 pb-3">
      <p className="mb-1.5 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t("sprints.loadByAssignee")}
      </p>
      <ul className="space-y-1">
        {loads.map((l) => (
          <li key={l.user.id} className="flex items-center gap-2">
            <AvatarInitials name={l.user.display_name || l.user.email} avatar={l.user.avatar} size="xs" />
            <span className="w-20 shrink-0 truncate text-2xs">{l.user.display_name || l.user.email}</span>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
              <div
                className={cn("h-full rounded-full", heavy(l.value) ? "bg-amber-500" : "bg-primary/60")}
                style={{ width: `${(l.value / max) * 100}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/70"
                style={{ width: `${(l.done / max) * 100}%` }}
                title={t("sprints.doneCount", { count: l.done })}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
              {formatCount(l.value, t)}
            </span>
            {l.busyDays > 0 && (
              <span
                className="flex shrink-0 items-center gap-0.5 text-2xs text-amber-600"
                title={t("sprints.busyDays", { count: l.busyDays })}
              >
                <CalendarClock className="h-3 w-3" />
                {t("sprints.days", { count: l.busyDays })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
