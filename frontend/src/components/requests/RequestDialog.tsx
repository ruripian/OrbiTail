/**
 * 전역 요청(IssueRequest) 상세 다이얼로그.
 *
 * 진입점:
 *   useRequestDialogStore.openRequest(req, { workspaceSlug, projectId })
 *
 * 구조:
 *   - 헤더: KindBadge + StatusBadge + 비공개 배지 + 승인된 이슈 링크 + 제목
 *   - 본문 좌측: 풀 description_html (line-clamp 제거, prose 풀 렌더) + bug meta(severity/environment) + 거절 사유
 *   - 본문 우측: 제출자/시각/처리자/처리 시각 메타
 *   - 푸터: 본인+pending=삭제 / 권한+pending=거절·승인 / 항상 닫기
 *
 * 액션:
 *   - [승인] 클릭 시 같은 파일 내 ApproveForm 다이얼로그 nested 로 띄움 (상태/카테고리/스프린트/담당자 지정)
 *   - [거절] 클릭 시 RejectForm 다이얼로그 nested
 *   - [이슈 #N] 클릭 시 useIssueDialogStore.openIssue 위임 (같은 글로벌 패턴)
 *
 * useProjectPerms / project 쿼리는 호출자(라우트) 의 useParams 기반이므로 다이얼로그가
 * /projects/:projectId/request 컨텍스트 안에서 호출돼야 권한이 정확하게 잡힌다.
 * (C1 단계에서는 RequestSubmitPage 안에서만 진입하므로 충족됨)
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bug, Sparkles, EyeOff, ExternalLink, Check, X, Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { StatePicker } from "@/components/issues/state-picker";
import { CategoryPicker } from "@/components/issues/category-picker";
import { SprintPicker } from "@/components/issues/sprint-picker";
import { AssigneePicker } from "@/components/issues/assignee-picker";

import { useRequestDialogStore } from "@/stores/requestDialogStore";
import { useIssueDialogStore } from "@/stores/issueDialogStore";
import { useAuthStore } from "@/stores/authStore";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { projectsApi } from "@/api/projects";
import { requestsApi } from "@/api/requests";
import { cn } from "@/lib/utils";
import type { IssueRequest } from "@/types";

/* ────────────── 배지 ────────────── */
function KindBadge({ kind }: { kind: IssueRequest["kind"] }) {
  if (kind === "bug") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-2xs font-semibold">
        <Bug className="h-2.5 w-2.5" /> 버그
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-2xs font-semibold">
      <Sparkles className="h-2.5 w-2.5" /> 기능
    </span>
  );
}

function StatusBadge({ status }: { status: IssueRequest["status"] }) {
  const cfg: Record<IssueRequest["status"], { label: string; cls: string }> = {
    pending:  { label: "대기",   cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    approved: { label: "승인됨", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    rejected: { label: "거절됨", cls: "bg-muted text-muted-foreground" },
  };
  const c = cfg[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold", c.cls)}>
      {c.label}
    </span>
  );
}

/* ────────────── 메타 사이드 블록 ────────────── */
function MetaBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-muted-foreground/70 mb-1">{label}</div>
      <div className="text-xs">{children}</div>
    </div>
  );
}

/* ────────────── 본체 ────────────── */
export function RequestDialog() {
  const current = useRequestDialogStore((s) => s.current);
  const context = useRequestDialogStore((s) => s.context);
  const storeClose = useRequestDialogStore((s) => s.close);
  const openIssue = useIssueDialogStore((s) => s.openIssue);

  const currentUser = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const { perms } = useProjectPerms();
  const [searchParams, setSearchParams] = useSearchParams();

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  /* 닫기 — store close 와 동시에 URL 의 ?req 제거.
   * (useEffect 양방향 동기화는 race 일으켜 폐기 — 행 클릭/close 핸들러에서 명시 호출) */
  const close = () => {
    if (searchParams.get("req")) {
      const next = new URLSearchParams(searchParams);
      next.delete("req");
      setSearchParams(next, { replace: true });
    }
    storeClose();
  };

  /* 프로젝트 정책(승인 권한 결정) — 같은 페이지에서 이미 캐시됐을 확률 높음. */
  const { data: project } = useQuery({
    queryKey: ["project", context?.workspaceSlug, context?.projectId],
    queryFn: () => projectsApi.get(context!.workspaceSlug, context!.projectId),
    enabled: !!context,
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      requestsApi.delete(context!.workspaceSlug, context!.projectId, current!.id),
    onSuccess: () => {
      toast.success("요청이 삭제되었습니다");
      qc.invalidateQueries({ queryKey: ["requests", context!.workspaceSlug, context!.projectId] });
      close();
    },
  });

  if (!current || !context) return null;

  /* 승인 권한: "admin" 정책이면 can_edit 만, "all" 정책이면 멤버 누구나 */
  const canReview = (() => {
    if (!project) return false;
    if (project.request_review_policy === "admin") return !!perms?.can_edit;
    return true;
  })();
  const isOwner = !!currentUser && current.submitted_by === currentUser.id;
  const canDelete = isOwner && current.status === "pending";

  /* meta 는 unknown record — 타입 가드 후 사용 */
  const meta = (current.meta ?? {}) as { severity?: string; environment?: string };

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2 flex-wrap">
              <KindBadge kind={current.kind} />
              <StatusBadge status={current.status} />
              {current.visibility === "private" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-2xs">
                  <EyeOff className="h-2.5 w-2.5" /> 비공개
                </span>
              )}
              {current.approved_issue && current.approved_issue_sequence_id != null && (
                <button
                  type="button"
                  onClick={() => {
                    const issueId = current.approved_issue;
                    if (!issueId) return;
                    openIssue(context.workspaceSlug, context.projectId, issueId);
                    close();
                  }}
                  className="inline-flex items-center gap-1 text-2xs font-mono text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  → 이슈 #{current.approved_issue_sequence_id}
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
            <DialogTitle className="mt-2 text-left">{current.title}</DialogTitle>
          </DialogHeader>

          {/* 본문 — 2칼럼 (왼쪽 컨텐츠, 오른쪽 메타) */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-5">
            <div className="space-y-4 min-w-0">
              {current.description_html ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none break-words"
                  dangerouslySetInnerHTML={{ __html: current.description_html }}
                />
              ) : (
                <p className="text-sm text-muted-foreground italic">설명 없음</p>
              )}

              {/* bug 의 구조화 meta — description_html 안에도 들어있지만 노출 강조용 별도 카드 */}
              {current.kind === "bug" && (meta.severity || meta.environment) && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 space-y-1.5">
                  {meta.severity && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-16">심각도</span>
                      <span className="font-medium text-destructive">{meta.severity}</span>
                    </div>
                  )}
                  {meta.environment && (
                    <div className="flex items-start gap-2 text-xs">
                      <span className="text-muted-foreground w-16 shrink-0">환경</span>
                      <span className="font-mono text-2xs break-all">{meta.environment}</span>
                    </div>
                  )}
                </div>
              )}

              {current.status === "rejected" && current.rejected_reason && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <div className="text-2xs uppercase tracking-wide text-destructive font-semibold mb-1">거절 사유</div>
                  <p className="text-sm whitespace-pre-wrap">{current.rejected_reason}</p>
                </div>
              )}
            </div>

            <aside className="space-y-3 md:border-l md:pl-4 border-border">
              <MetaBlock label="제출자">
                {current.submitted_by_detail ? (
                  <span className="inline-flex items-center gap-1.5">
                    <AvatarInitials
                      name={current.submitted_by_detail.display_name}
                      avatar={current.submitted_by_detail.avatar}
                      size="xs"
                    />
                    {current.submitted_by_detail.display_name}
                  </span>
                ) : "—"}
              </MetaBlock>
              <MetaBlock label="제출 시각">
                <span className="text-muted-foreground">{new Date(current.created_at).toLocaleString()}</span>
              </MetaBlock>
              {current.reviewer_detail && (
                <MetaBlock label="처리자">
                  <span className="inline-flex items-center gap-1.5">
                    <AvatarInitials
                      name={current.reviewer_detail.display_name}
                      avatar={current.reviewer_detail.avatar}
                      size="xs"
                    />
                    {current.reviewer_detail.display_name}
                  </span>
                </MetaBlock>
              )}
              {current.reviewed_at && (
                <MetaBlock label="처리 시각">
                  <span className="text-muted-foreground">{new Date(current.reviewed_at).toLocaleString()}</span>
                </MetaBlock>
              )}
              <MetaBlock label="공개 범위">
                <span className="text-muted-foreground">
                  {current.visibility === "public" ? "공개 (멤버 누구나)" : "비공개 (제출자 + 관리자)"}
                </span>
              </MetaBlock>
            </aside>
          </div>

          {/* 푸터 */}
          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border">
            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-destructive hover:text-destructive"
                onClick={() => {
                  if (window.confirm("이 요청을 삭제하시겠습니까?")) deleteMutation.mutate();
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" /> 삭제
              </Button>
            )}
            <div className="flex-1" />
            {current.status === "pending" && canReview && (
              <>
                <Button variant="outline" onClick={() => setRejectOpen(true)}>
                  <X className="h-4 w-4 mr-1 text-destructive" /> 거절
                </Button>
                <Button onClick={() => setApproveOpen(true)}>
                  <Check className="h-4 w-4 mr-1" /> 승인
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={close}>닫기</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* nested — 승인 폼 */}
      {approveOpen && (
        <ApproveForm
          req={current}
          workspaceSlug={context.workspaceSlug}
          projectId={context.projectId}
          onClose={() => setApproveOpen(false)}
          onApproved={() => {
            qc.invalidateQueries({ queryKey: ["requests", context.workspaceSlug, context.projectId] });
            qc.invalidateQueries({ queryKey: ["issues", context.workspaceSlug, context.projectId] });
            setApproveOpen(false);
            close();
          }}
        />
      )}

      {/* nested — 거절 폼 */}
      {rejectOpen && (
        <RejectForm
          req={current}
          workspaceSlug={context.workspaceSlug}
          projectId={context.projectId}
          onClose={() => setRejectOpen(false)}
          onRejected={() => {
            qc.invalidateQueries({ queryKey: ["requests", context.workspaceSlug, context.projectId] });
            setRejectOpen(false);
            close();
          }}
        />
      )}
    </>
  );
}

/* ────────────── 승인 폼 (RequestSubmitPage 에서 이관, 함수명만 변경) ────────────── */
function ApproveForm({
  req, workspaceSlug, projectId, onClose, onApproved,
}: {
  req: IssueRequest;
  workspaceSlug: string;
  projectId: string;
  onClose: () => void;
  onApproved: () => void;
}) {
  const [stateId, setStateId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sprintId, setSprintId] = useState<string | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn: () => projectsApi.states.list(workspaceSlug, projectId),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, projectId],
    queryFn: () => projectsApi.categories.list(workspaceSlug, projectId),
  });
  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn: () => projectsApi.sprints.list(workspaceSlug, projectId),
  });
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug, projectId),
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      requestsApi.approve(workspaceSlug, projectId, req.id, {
        state: stateId ?? undefined,
        category: categoryId ?? undefined,
        sprint: sprintId ?? undefined,
        assignees: assigneeIds.length ? assigneeIds : undefined,
      }),
    onSuccess: () => {
      toast.success("요청이 승인되어 이슈로 편입되었습니다");
      onApproved();
    },
    onError: () => toast.error("승인 처리 실패"),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>요청 승인 → 이슈 편입</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <KindBadge kind={req.kind} />
              <p className="text-sm font-medium truncate">{req.title}</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">상태</label>
            <StatePicker states={states} currentStateId={stateId} onChange={(id) => setStateId(id)} />
            <p className="text-2xs text-muted-foreground/70 mt-1">미지정 시 프로젝트 기본 상태로 생성됩니다.</p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">카테고리</label>
            <CategoryPicker categories={categories} currentId={categoryId} onChange={(id) => setCategoryId(id)} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">스프린트</label>
            <SprintPicker sprints={sprints} currentId={sprintId} onChange={(id) => setSprintId(id)} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">담당자</label>
            <AssigneePicker members={members} currentIds={assigneeIds} onChange={setAssigneeIds} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
            <Check className="h-4 w-4 mr-1" />
            {approveMutation.isPending ? "승인 중..." : "승인 + 이슈 생성"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────── 거절 폼 ────────────── */
function RejectForm({
  req, workspaceSlug, projectId, onClose, onRejected,
}: {
  req: IssueRequest;
  workspaceSlug: string;
  projectId: string;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [reason, setReason] = useState("");
  const rejectMutation = useMutation({
    mutationFn: () => requestsApi.reject(workspaceSlug, projectId, req.id, reason.trim()),
    onSuccess: () => {
      toast.success("요청이 거절되었습니다");
      onRejected();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>요청 거절</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            "<span className="font-medium text-foreground">{req.title}</span>" 요청을 거절합니다.
          </p>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">사유 (선택)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="거절하는 이유를 적어두면 제출자가 확인할 수 있습니다"
              rows={3}
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 resize-y"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button variant="destructive" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending}>
            <X className="h-4 w-4 mr-1" />
            거절
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
