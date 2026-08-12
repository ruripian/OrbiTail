import { useRef, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/api-error";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Shield, Mail, Quote, Crown } from "lucide-react";
import { workspacesApi } from "@/api/workspaces";
import { useAuthStore } from "@/stores/authStore";
import { AuthCard, AuthCardHeader } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/button";
import type { InvitationInfo } from "@/types";

/** 역할 값 → i18n 키 + 색상 매핑 */
const ROLE_KEYS: Record<number, string> = {
  10: "invite.role.guest",
  15: "invite.role.member",
  20: "invite.role.admin",
  25: "invite.role.owner",
};
const ROLE_COLORS: Record<number, string> = {
  10: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  15: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  20: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  25: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  // 초대 정보 조회
  const {
    data: invitation,
    isLoading,
    error,
  } = useQuery<InvitationInfo>({
    queryKey: ["invitation", token],
    queryFn: () => workspacesApi.invitations.getByToken(token!),
    enabled: !!token,
    retry: false,
  });

  // 초대 수락 mutation
  const acceptMutation = useMutation({
    mutationFn: () => workspacesApi.invitations.accept(token!),
    onSuccess: (data) => {
      toast.success(t("invite.acceptSuccess"));
      navigate(`/${data.workspace_slug}`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("invite.acceptError"))),
  });

  // 로그인 상태이고 이메일이 일치하는지 확인
  const isLoggedIn = !!accessToken && !!user;
  const emailMatch = isLoggedIn && user?.email === invitation?.email;
  const emailMismatch = isLoggedIn && invitation && user?.email !== invitation.email;

  /* 이미 로그인 + 이메일 일치 → 자동 수락 후 워크스페이스로 바로 이동
     (초대 토큰으로 가입한 경우 이미 멤버이므로 수락 화면을 건너뜀) */
  const autoAccepted = useRef(false);
  useEffect(() => {
    if (emailMatch && invitation && !autoAccepted.current && !acceptMutation.isPending) {
      autoAccepted.current = true;
      acceptMutation.mutate();
    }
    /* acceptMutation 은 매 렌더 새 객체라 deps 에 넣으면 effect 가 계속 돌아 재수락을 반복한다.
       중복 실행은 autoAccepted ref 로 이미 막고 있다. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailMatch, invitation]);

  if (isLoading) {
    return (
      <AuthCard>
        <AuthCardHeader subtitle={t("invite.loading")} />
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </AuthCard>
    );
  }

  if (error || !invitation) {
    return (
      <AuthCard>
        <AuthCardHeader subtitle={t("invite.title")} />
        <div className="text-center py-6 space-y-4">
          <p className="text-sm text-destructive">{t("invite.invalidOrExpired")}</p>
          <Link to="/auth/login">
            <Button variant="outline" className="w-full">
              {t("invite.goToLogin")}
            </Button>
          </Link>
        </div>
      </AuthCard>
    );
  }

  const wsInitial = invitation.workspace_name?.[0]?.toUpperCase() ?? "?";
  const inviterInitial = invitation.invited_by_name?.[0]?.toUpperCase() ?? "?";
  const roleKey = ROLE_KEYS[invitation.role] || "invite.role.member";
  const roleColor = ROLE_COLORS[invitation.role] || ROLE_COLORS[15];

  return (
    <AuthCard>
      <AuthCardHeader subtitle={t("invite.title")} />

      <div className="space-y-5">
        {/* Hero — 워크스페이스 아이콘 + 초대 문구 */}
        <div className="flex flex-col items-center text-center space-y-3 pb-4 border-b border-border">
          <div className="relative">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-2xl font-bold text-primary ring-2 ring-primary/20">
              {wsInitial}
            </span>
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-background border-2 border-primary/30">
              <Crown className="h-3 w-3 text-primary" />
            </span>
          </div>
          <div>
            <h2 className="text-lg font-semibold">{invitation.workspace_name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t("invite.title")}</p>
          </div>
        </div>

        {/* 메타 정보 — 초대자 + 이메일 + 역할 */}
        <div className="space-y-3">
          {/* 초대자 */}
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground/80">
              {inviterInitial}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-2xs uppercase tracking-wider text-muted-foreground/70 font-semibold">{t("invite.invitedBy")}</p>
              <p className="text-sm font-medium truncate">{invitation.invited_by_name}</p>
            </div>
          </div>

          {/* 수신 이메일 + 역할 */}
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 px-3 py-2.5 rounded-lg bg-muted/30 border border-border">
            <Mail className="h-3.5 w-3.5 text-muted-foreground/70 mt-0.5" />
            <div>
              <p className="text-2xs uppercase tracking-wider text-muted-foreground/70 font-semibold">{t("invite.invitedEmail")}</p>
              <p className="text-sm font-mono truncate">{invitation.email}</p>
            </div>
            <Shield className="h-3.5 w-3.5 text-muted-foreground/70 mt-0.5" />
            <div>
              <p className="text-2xs uppercase tracking-wider text-muted-foreground/70 font-semibold">{t("invite.assignedRole")}</p>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md border ${roleColor}`}>
                {t(roleKey)}
              </span>
            </div>
          </div>

          {/* 메시지 (있을 때만) */}
          {invitation.message && (
            <div className="relative rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
              <Quote className="absolute top-2 left-2 h-3.5 w-3.5 text-primary/40" />
              <p className="text-sm text-foreground/80 italic pl-5 leading-relaxed">{invitation.message}</p>
            </div>
          )}
        </div>

        {/* 이메일 불일치 경고 */}
        {emailMismatch && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-2">
            <p className="text-sm text-destructive">
              {t("invite.emailMismatch", {
                invitedEmail: invitation.email,
                currentEmail: user?.email,
              })}
            </p>
            <button
              type="button"
              onClick={() => {
                useAuthStore.getState().clearAuth();
                window.location.reload();
              }}
              className="text-xs text-destructive underline hover:no-underline"
            >
              {t("invite.logoutAndTryAgain")}
            </button>
          </div>
        )}

        {/* 비로그인 상태 안내 + 이미 계정 있으면 로그인 링크 */}
        {!isLoggedIn && (
          <p className="text-xs text-muted-foreground text-center">
            {t("invite.acceptHint")}{" "}
            <Link
              to={`/auth/login?redirect=/invite/${token}`}
              className="text-primary hover:underline"
            >
              {t("invite.signIn")}
            </Link>
          </p>
        )}

        {/* 액션 버튼 페어 — 거절 / 수락 */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => navigate("/auth/login")}
            disabled={acceptMutation.isPending}
          >
            {t("invite.declineButton")}
          </Button>
          <Button
            className="flex-1 font-semibold"
            disabled={acceptMutation.isPending || emailMismatch}
            onClick={() => {
              /* 상태별 수락 분기:
                 1) 비로그인 → 회원가입 페이지 (email 고정 + invite 토큰 전달)
                 2) 로그인 + 이메일 일치 → accept API 호출 → 워크스페이스 진입
                 3) 로그인 + 이메일 불일치 → 위 경고 표시 (버튼 disabled) */
              if (!isLoggedIn) {
                navigate(
                  `/auth/register?invite=${token}&email=${encodeURIComponent(invitation.email)}`,
                );
                return;
              }
              if (emailMatch) {
                acceptMutation.mutate();
              }
            }}
          >
            {acceptMutation.isPending ? t("invite.accepting") : t("invite.acceptButton")}
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}
