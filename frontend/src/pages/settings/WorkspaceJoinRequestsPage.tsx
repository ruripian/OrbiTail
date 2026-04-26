import { useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, X as XIcon, Inbox } from "lucide-react";

import { workspacesApi } from "@/api/workspaces";
import { useAuthStore } from "@/stores/authStore";
import { formatDate } from "@/utils/date-format";

/**
 * 워크스페이스 가입 신청 관리 페이지.
 * Admin(role≥20) 이상만 접근. 관리자가 사용자별로 승인/거절.
 * 탭: 대기(pending) / 전체(all)
 */
export function WorkspaceJoinRequestsPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const [filter, setFilter] = useState<"pending" | "all">("pending");

  /* 관리자 권한 체크 — 본인 멤버십 role ≥ 20 */
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const myRole = members.find((m) => m.member.id === currentUser?.id)?.role ?? 0;
  const canEdit = myRole >= 20 || currentUser?.is_staff;

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["workspace-join-requests", workspaceSlug, filter],
    queryFn: () => workspacesApi.joinRequestsAdmin.list(workspaceSlug!, filter),
    enabled: !!workspaceSlug && !!canEdit,
  });

  const decideJoinRequest = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      workspacesApi.joinRequestsAdmin.decide(workspaceSlug!, id, action),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["workspace-join-requests", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["workspace-members", workspaceSlug] });
      toast.success(
        vars.action === "approve"
          ? t("settings.workspaceJoinRequests.approved", "가입을 승인했습니다.")
          : t("settings.workspaceJoinRequests.rejected", "가입 신청을 거절했습니다."),
      );
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail ?? t("common.error", "처리에 실패했습니다."));
    },
  });

  if (!membersLoading && !canEdit) {
    return <Navigate to={`/${workspaceSlug}/workspace-settings/members`} replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">
          {t("settings.workspaceJoinRequests.title", "가입 승인")}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          {t("settings.workspaceJoinRequests.subtitle", "워크스페이스 가입을 신청한 사용자를 승인하거나 거절합니다.")}
        </p>
      </div>

      {/* 필터 탭 */}
      <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-xs">
        {(["pending", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? "px-3 py-1.5 rounded-[5px] bg-background font-medium shadow-sm"
                : "px-3 py-1.5 rounded-[5px] text-muted-foreground hover:text-foreground"
            }
          >
            {f === "pending"
              ? t("settings.workspaceJoinRequests.tabPending", "대기")
              : t("settings.workspaceJoinRequests.tabAll", "전체")}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {t("common.loading", "로딩 중...")}
        </p>
      ) : (requests as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-2">
          <Inbox className="h-8 w-8 opacity-50" />
          <p className="text-sm">
            {filter === "pending"
              ? t("settings.workspaceJoinRequests.emptyPending", "대기 중인 가입 신청이 없습니다.")
              : t("settings.workspaceJoinRequests.emptyAll", "가입 신청 내역이 없습니다.")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {(requests as any[]).map((jr) => {
            const isPending = jr.status === "pending";
            const statusBadge =
              jr.status === "pending" ? "bg-amber-500/10 text-amber-500 border-amber-500/30" :
              jr.status === "approved" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" :
              jr.status === "rejected" ? "bg-destructive/10 text-destructive border-destructive/30" :
              "bg-muted text-muted-foreground border-border";
            const statusLabel =
              jr.status === "pending" ? t("settings.workspaceJoinRequests.statusPending", "대기") :
              jr.status === "approved" ? t("settings.workspaceJoinRequests.statusApproved", "승인됨") :
              jr.status === "rejected" ? t("settings.workspaceJoinRequests.statusRejected", "거절됨") :
              t("settings.workspaceJoinRequests.statusCanceled", "취소됨");

            return (
              <div
                key={jr.id}
                className="flex items-center gap-3 rounded-lg border bg-background p-3"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0 overflow-hidden">
                  {jr.user?.avatar ? (
                    <img src={jr.user.avatar} alt="" className="h-9 w-9 object-cover" />
                  ) : (
                    <span className="text-sm font-semibold">
                      {jr.user?.display_name?.[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{jr.user?.display_name}</p>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-md border ${statusBadge} shrink-0`}>
                      {statusLabel}
                    </span>
                  </div>
                  <p className="text-2xs text-muted-foreground font-mono truncate">{jr.user?.email}</p>
                  {jr.message && (
                    <p className="text-2xs italic text-muted-foreground/90 mt-0.5 truncate">"{jr.message}"</p>
                  )}
                  <p className="text-2xs text-muted-foreground/70 mt-0.5">
                    {t("settings.workspaceJoinRequests.requestedOn", "신청일")}: {formatDate(jr.created_at)}
                    {jr.decided_at && (
                      <>
                        {" · "}
                        {t("settings.workspaceJoinRequests.decidedOn", "처리일")}: {formatDate(jr.decided_at)}
                        {jr.decided_by && ` (${jr.decided_by.display_name})`}
                      </>
                    )}
                  </p>
                </div>
                {isPending && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => decideJoinRequest.mutate({ id: jr.id, action: "reject" })}
                      disabled={decideJoinRequest.isPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                      {t("settings.workspaceJoinRequests.reject", "거절")}
                    </button>
                    <button
                      type="button"
                      onClick={() => decideJoinRequest.mutate({ id: jr.id, action: "approve" })}
                      disabled={decideJoinRequest.isPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition-colors disabled:opacity-40"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t("settings.workspaceJoinRequests.approve", "승인")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
