import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Crown, Trash2, Mail, X as XIcon, Send } from "lucide-react";

import { workspacesApi } from "@/api/workspaces";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/utils/date-format";
import type { WorkspaceMember } from "@/types";

/**
 * 워크스페이스 멤버 관리 페이지 (JIRA 스타일 자유 권한 관리)
 *
 * 역할: Guest(10) / Member(15) / Admin(20) / Owner(25)
 *
 * 규칙:
 *  - Admin 이상만 편집 가능
 *  - Owner 승격(소유자 이전)은 Owner만 가능 — 기존 Owner는 Admin으로 자동 강등
 *  - 마지막 Owner는 강등/제거 불가
 *  - 본인은 본인을 제거할 수 없음
 */

const ROLES = [
  { value: 10, key: "guest" },
  { value: 15, key: "member" },
  { value: 20, key: "admin" },
  { value: 25, key: "owner" },
] as const;

export function WorkspaceMembersPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  const { data: invitations = [] } = useQuery({
    queryKey: ["workspace-invitations", workspaceSlug],
    queryFn: () => workspacesApi.invitations.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  /* 초대 폼 state */
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole]   = useState<number>(15); // 기본값: Member

  /* 현재 사용자의 워크스페이스 역할 확인 */
  const myMembership = members.find((m) => m.member.id === currentUser?.id);
  const myRole = myMembership?.role ?? 0;
  const canEdit = myRole >= 20; // Admin 이상
  const isOwner = myRole === 25;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["workspace-members", workspaceSlug] });
    qc.invalidateQueries({ queryKey: ["workspace", workspaceSlug] });
  };

  const invalidateInvitations = () => {
    qc.invalidateQueries({ queryKey: ["workspace-invitations", workspaceSlug] });
  };

  const inviteMutation = useMutation({
    mutationFn: () => workspacesApi.invitations.create(workspaceSlug!, { email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      invalidateInvitations();
      setInviteEmail("");
      setInviteRole(15);
      toast.success(t("settings.workspaceMembers.inviteSuccess"));
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || t("settings.workspaceMembers.inviteFailed"));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => workspacesApi.invitations.revoke(workspaceSlug!, invitationId),
    onSuccess: () => {
      invalidateInvitations();
      toast.success(t("settings.workspaceMembers.revokeSuccess"));
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || t("settings.workspaceMembers.revokeFailed"));
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: number }) =>
      workspacesApi.memberOps.updateRole(workspaceSlug!, memberId, role),
    onSuccess: () => {
      invalidate();
      toast.success(t("settings.workspaceMembers.roleUpdated"));
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || t("settings.workspaceMembers.roleUpdateFailed"));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => workspacesApi.memberOps.remove(workspaceSlug!, memberId),
    onSuccess: () => {
      invalidate();
      toast.success(t("settings.workspaceMembers.removed"));
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || t("settings.workspaceMembers.removeFailed"));
    },
  });

  const handleRemove = (wm: WorkspaceMember) => {
    if (!window.confirm(t("settings.workspaceMembers.confirmRemove", { name: wm.member.display_name }))) {
      return;
    }
    removeMutation.mutate(wm.id);
  };

  const ownerCount = members.filter((m) => m.role === 25).length;

  /* 권한 가드 — Admin(20) 미만은 개인 설정 페이지로 리다이렉트.
     모든 hooks 호출 이후 위치에 두어 순서 안정성 보장 */
  if (members.length > 0 && myRole < 20) {
    return <Navigate to={`/${workspaceSlug}/settings/profile`} replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{t("settings.workspaceMembers.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("settings.workspaceMembers.subtitle")}
        </p>
      </div>

      {!canEdit && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {t("settings.workspaceMembers.readOnlyNotice")}
        </div>
      )}

      {/* 멤버 초대 섹션 (Admin 이상) */}
      {canEdit && (
        <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary shrink-0">
              <Mail className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold">{t("settings.workspaceMembers.inviteTitle")}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{t("settings.workspaceMembers.inviteSubtitle")}</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!inviteEmail.trim()) return;
              inviteMutation.mutate();
            }}
            className="flex items-end gap-2 flex-wrap"
          >
            <div className="flex-1 min-w-[220px] space-y-1.5">
              <Label className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                {t("settings.workspaceMembers.inviteEmail")}
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t("settings.workspaceMembers.invitePlaceholder")}
                  required
                  className="h-10 pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                {t("settings.workspaceMembers.inviteRole")}
              </Label>
              <Select value={String(inviteRole)} onValueChange={(v) => setInviteRole(Number(v))}>
                <SelectTrigger className="w-32 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => r.value === 25 ? isOwner : true).map((r) => (
                    <SelectItem key={r.value} value={String(r.value)}>
                      {t(`settings.workspaceMembers.role.${r.key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              className="h-10 gap-1.5 font-semibold"
              disabled={inviteMutation.isPending || !inviteEmail.trim()}
            >
              <Send className="h-3.5 w-3.5" />
              {inviteMutation.isPending ? t("settings.workspaceMembers.inviteSending") : t("settings.workspaceMembers.inviteButton")}
            </Button>
          </form>
        </div>
      )}

      {/* 대기 중 초대 목록 */}
      {canEdit && invitations.filter((i) => i.status === "pending").length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t("settings.workspaceMembers.pendingTitle")}
            </p>
            <span className="inline-flex items-center justify-center text-2xs font-bold rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 h-4 min-w-[16px] px-1.5">
              {invitations.filter((i) => i.status === "pending").length}
            </span>
          </div>
          <div className="space-y-2">
            {invitations.filter((i) => i.status === "pending").map((inv) => {
              const roleKey = inv.role === 25 ? "owner" : inv.role === 20 ? "admin" : inv.role === 15 ? "member" : "guest";
              const roleColor =
                inv.role === 25 ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                inv.role === 20 ? "bg-violet-500/10 text-violet-500 border-violet-500/20" :
                inv.role === 15 ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                "bg-slate-500/10 text-slate-500 border-slate-500/20";
              return (
                <div key={inv.id} className="group flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 hover:bg-muted/30 hover:border-border/80 transition-colors p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium font-mono truncate">{inv.email}</p>
                      <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-md border ${roleColor} shrink-0`}>
                        {t(`settings.workspaceMembers.role.${roleKey}`)}
                      </span>
                    </div>
                    <p className="text-2xs text-muted-foreground mt-0.5">
                      {t("settings.workspaceMembers.expiresOn", { date: formatDate(inv.expires_at) })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t("settings.workspaceMembers.confirmRevoke", { email: inv.email }))) {
                        revokeMutation.mutate(inv.id);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive px-2 py-1 rounded-md hover:bg-destructive/10 transition-colors opacity-60 group-hover:opacity-100"
                    title={t("settings.workspaceMembers.revokeButton")}
                  >
                    <XIcon className="h-3 w-3" />
                    {t("settings.workspaceMembers.revokeButton")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 멤버 목록 섹션 헤더 */}
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 -mb-2">
        {t("settings.workspaceMembers.membersTitle")}
      </p>

      {/* 멤버 목록 */}
      <div className="space-y-2">
        {members.map((wm) => {
          const isTargetOwner = wm.role === 25;
          const isMe = wm.member.id === currentUser?.id;
          const isLastOwner = isTargetOwner && ownerCount <= 1;

          /* 역할 변경 가능 여부
             - Admin 이상만 편집 가능
             - Owner로 승격하거나 Owner를 강등하려면 Owner여야 함
             - 마지막 Owner는 변경 불가 */
          const canChangeRole = canEdit && !isLastOwner && (
            isTargetOwner ? isOwner : true
          );

          /* 제거 가능 여부
             - Admin 이상만 가능
             - 본인 제거 불가
             - Owner 제거는 Owner만 가능
             - 마지막 Owner 제거 불가 */
          const canRemove = canEdit && !isMe && !isLastOwner && (
            isTargetOwner ? isOwner : true
          );

          /* 드롭다운에서 선택 가능한 역할
             - Owner 승격은 Owner만 가능 */
          const availableRoles = ROLES.filter((r) => {
            if (r.value === 25 && !isOwner) return false;
            return true;
          });

          return (
            <div
              key={wm.id}
              className="flex items-center gap-3 rounded-lg border glass p-3"
            >
              {/* 아바타 */}
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary shrink-0">
                {wm.member.display_name[0]?.toUpperCase()}
              </span>

              {/* 이름/이메일 + Owner 배지 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium truncate">
                    {wm.member.display_name}
                    {isMe && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ({t("settings.workspaceMembers.you")})
                      </span>
                    )}
                  </p>
                  {isTargetOwner && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-2xs font-medium text-amber-600 dark:text-amber-400">
                      <Crown className="h-3 w-3" />
                      {t("settings.workspaceMembers.ownerBadge")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{wm.member.email}</p>
              </div>

              {/* 역할 드롭다운 */}
              <Select
                value={String(wm.role)}
                disabled={!canChangeRole}
                onValueChange={(v) => {
                  const newRole = Number(v);
                  if (newRole === 25 && wm.role !== 25) {
                    /* 소유자 이전 — 경고 확인 */
                    if (!window.confirm(
                      t("settings.workspaceMembers.confirmTransferOwner", { name: wm.member.display_name })
                    )) {
                      return;
                    }
                  }
                  roleMutation.mutate({ memberId: wm.id, role: newRole });
                }}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((r) => (
                    <SelectItem key={r.value} value={String(r.value)}>
                      {t(`settings.workspaceMembers.role.${r.key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* 제거 버튼 */}
              <button
                onClick={() => handleRemove(wm)}
                disabled={!canRemove}
                title={
                  isLastOwner
                    ? t("settings.workspaceMembers.cannotRemoveLastOwner")
                    : isMe
                      ? t("settings.workspaceMembers.cannotRemoveSelf")
                      : undefined
                }
                className="p-1.5 rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
