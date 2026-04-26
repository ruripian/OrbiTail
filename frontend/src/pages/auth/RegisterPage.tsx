import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { authApi } from "@/api/auth";
import { workspacesApi } from "@/api/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AuthCard, AuthCardHeader } from "@/components/auth/AuthCard";

/* 비밀번호 복잡도: 8자 이상 + 영문 + 숫자 + 특수문자 */
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;

const schema = z.object({
  email: z.string().email(),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  display_name: z.string().min(1, "Display name is required"),
  password: z.string().regex(PASSWORD_RE),
  confirm_password: z.string(),
  workspace_slug: z.string().optional(),
}).refine((d) => d.password === d.confirm_password, {
  path: ["confirm_password"],
  message: "passwordMismatch",
});

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);

  // 초대 토큰 + 이메일 고정 (초대 링크에서 넘어온 경우)
  const inviteToken = searchParams.get("invite");
  const inviteEmail = searchParams.get("email");

  const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: inviteEmail || "",
      workspace_slug: undefined,
    },
  });

  /* 셀프 가입 시 워크스페이스 셀렉터 — 초대 가입은 토큰에서 워크스페이스가 정해지므로 불필요 */
  const { data: publicWorkspaces = [] } = useQuery({
    queryKey: ["workspaces", "public"],
    queryFn: workspacesApi.publicList,
    enabled: !inviteToken,
  });
  const selectedWorkspaceSlug = watch("workspace_slug");

  /* 가입 직후 화면을 떠나지 않고 안내를 그대로 보여줌 — 사용자가 토스트를 놓쳐도
     "이메일 인증 필요" 사실이 명확히 전달되도록.
     successState 가 set 되면 폼 대신 안내 패널 렌더. */
  const [successState, setSuccessState] = useState<
    | null
    | { kind: "verify-email"; email: string }
    | { kind: "auto-activated"; redirectTo: string }
  >(null);

  const mutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (data: any, variables: any) => {
      /* 자동 활성화 — 초대 가입 또는 SMTP 미설정 시. 바로 로그인 가능 */
      if (data.auto_activated) {
        toast.success(t("auth.register.successAutoActivated"), { duration: 8000 });
        // 초대 가입은 이미 멤버가 만들어졌고 invitation 은 ACCEPTED 상태라
        // /invite/{token} 으로 다시 보내면 "만료된 초대" 에러가 난다.
        // workspace_slug 가 응답에 있으면 로그인 후 그 워크스페이스로 직진,
        // 없으면 셀렉트 페이지(/) 가 알아서 자동 진입 처리.
        const redirectTo = data.workspace_slug
          ? `/auth/login?redirect=/${data.workspace_slug}`
          : "/auth/login";
        setSuccessState({ kind: "auto-activated", redirectTo });
        setTimeout(() => navigate(redirectTo), 2000);
        return;
      }
      if (data.email_verification_required) {
        toast.success(t("auth.register.successWithEmail"), { duration: 10000 });
        // 페이지 이탈 X — 그대로 안내 패널 노출
        setSuccessState({ kind: "verify-email", email: variables?.email ?? "" });
        return;
      }
      navigate(inviteToken ? `/auth/login?redirect=/invite/${inviteToken}` : "/auth/login");
    },
    onError: () => {
      toast.error(t("auth.register.error"));
    },
  });

  return (
    <AuthCard className="">
      <AuthCardHeader subtitle={t("auth.register.subtitle")} />

      {/* 가입 성공 — 페이지 이탈 X. 사용자가 메일 인증을 끝낼 때까지 안내를 그대로 보여줌 */}
      {successState?.kind === "verify-email" && (
        <div className="space-y-4 py-6 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-amber-500/15 flex items-center justify-center">
            <ShieldCheck className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="space-y-1.5">
            <p className="text-base font-bold">
              {t("auth.register.verifyEmailTitle", "가입 신청이 접수되었습니다")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("auth.register.verifyEmailBody1", "{{email}} 으로 인증 메일을 보냈습니다.", { email: successState.email })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("auth.register.verifyEmailBody2", "메일을 열어 인증 링크를 클릭한 다음, 워크스페이스 관리자의 승인을 기다려 주세요.")}
            </p>
          </div>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300 text-left">
            <p className="font-semibold mb-1">
              {t("auth.register.verifyEmailHintTitle", "다음 단계")}
            </p>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>{t("auth.register.verifyEmailStep1", "메일함에서 OrbiTail 인증 메일을 확인하세요")}</li>
              <li>{t("auth.register.verifyEmailStep2", "인증 링크를 클릭하세요")}</li>
              <li>{t("auth.register.verifyEmailStep3", "워크스페이스 관리자가 가입을 승인할 때까지 기다리세요")}</li>
            </ol>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate("/auth/login")}
          >
            {t("auth.register.backToLogin", "로그인 화면으로")}
          </Button>
        </div>
      )}

      {successState?.kind === "auto-activated" && (
        <div className="space-y-4 py-8 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <ShieldCheck className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-base font-bold">{t("auth.register.successAutoActivated")}</p>
          <p className="text-xs text-muted-foreground">
            {t("auth.register.autoRedirecting", "잠시 후 로그인 화면으로 이동합니다...")}
          </p>
        </div>
      )}

      {!successState && inviteToken && inviteEmail && (
        <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs text-muted-foreground">
            {t("invite.registerHint", { email: inviteEmail })}
          </p>
        </div>
      )}

      {!successState && (
      <form
        onSubmit={handleSubmit(({ confirm_password: _cp, workspace_slug, ...d }) => {
          /* 초대 토큰 → 백엔드가 자동 활성화 (관리자 승인 우회).
             셀프 가입 → 선택한 워크스페이스로 가입 신청까지 한 번에. */
          if (inviteToken) {
            mutation.mutate({ ...d, invite_token: inviteToken });
          } else {
            mutation.mutate(workspace_slug ? { ...d, workspace_slug } : d);
          }
        })}
        className="space-y-4"
      >
        <div className="flex gap-4">
          <div className="space-y-1.5 flex-1">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("auth.register.lastName")}
            </Label>
            <Input
              placeholder={t("auth.register.lastNamePlaceholder")}
              {...register("last_name")}
            />
            {errors.last_name && (
              <p className="text-xs text-destructive">{errors.last_name.message}</p>
            )}
          </div>
          <div className="space-y-1.5 flex-1">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("auth.register.firstName")}
            </Label>
            <Input
              placeholder={t("auth.register.firstNamePlaceholder")}
              {...register("first_name")}
            />
            {errors.first_name && (
              <p className="text-xs text-destructive">{errors.first_name.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs tracking-wide text-muted-foreground uppercase">
            {t("auth.register.displayName")}
          </Label>
          <Input
            placeholder={t("auth.register.namePlaceholder")}
            {...register("display_name")}
          />
          {errors.display_name && (
            <p className="text-xs text-destructive">{errors.display_name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs tracking-wide text-muted-foreground uppercase">
            {t("auth.register.email")}
          </Label>
          <Input
            type="email"
            placeholder={t("auth.register.emailPlaceholder")}
            {...register("email")}
            readOnly={!!inviteEmail}
            className={inviteEmail ? "bg-muted cursor-not-allowed" : ""}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        {/* 워크스페이스 셀렉터 — 셀프 가입 시. 후보 0개면 숨김(가입은 가능, 로그인 후 셀렉트 페이지). */}
        {!inviteToken && publicWorkspaces.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("auth.register.workspace", "가입할 워크스페이스")}
            </Label>
            <Select
              value={selectedWorkspaceSlug ?? ""}
              onValueChange={(v) => setValue("workspace_slug", v || undefined, { shouldDirty: true })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("auth.register.workspacePlaceholder", "워크스페이스 선택 (선택 사항)")} />
              </SelectTrigger>
              <SelectContent>
                {publicWorkspaces.map((ws: any) => (
                  <SelectItem key={ws.id} value={ws.slug}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground/80">
              {t("auth.register.workspaceHint", "선택하면 가입 즉시 해당 워크스페이스 관리자에게 가입 신청이 전달됩니다.")}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs tracking-wide text-muted-foreground uppercase">
            {t("auth.register.password")}
          </Label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder={t("auth.register.passwordPlaceholder")}
              {...register("password")}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 top-0 h-full px-3 py-2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-2xs text-muted-foreground/70">{t("auth.register.passwordRule")}</p>
          {errors.password && (
            <p className="text-xs text-destructive">{t("auth.register.passwordRuleError")}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs tracking-wide text-muted-foreground uppercase">
            {t("auth.register.confirmPassword")}
          </Label>
          <div className="relative">
            <Input
              type={showConfirm ? "text" : "password"}
              placeholder={t("auth.register.confirmPasswordPlaceholder")}
              {...register("confirm_password")}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-0 top-0 h-full px-3 py-2 text-muted-foreground hover:text-foreground"
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.confirm_password && (
            <p className="text-xs text-destructive">{t("auth.register.passwordMismatch")}</p>
          )}
        </div>

        {mutation.isError && (
          <p className="text-xs text-destructive">{t("auth.register.error")}</p>
        )}

        <Button type="submit" className="w-full font-semibold tracking-widest" disabled={mutation.isPending}>
          {mutation.isPending ? t("auth.register.submitting") : t("auth.register.submit")}
        </Button>

        {/* 큰 안내 — 셀프 가입(초대 토큰 없음) 시. 가입자가 절대 놓치지 않도록 굵고 크게 */}
        {!inviteToken && (
          <div className="rounded-md border-2 border-amber-500/50 bg-amber-500/10 p-3 text-center">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-300">
              {t("auth.register.bigNoticeTitle", "⚠ 가입 후 워크스페이스 관리자가 승인해야 사용할 수 있습니다")}
            </p>
            <p className="text-2xs text-amber-700/80 dark:text-amber-300/80 mt-1">
              {t("auth.register.bigNoticeBody", "이메일 인증 → 관리자 승인 → 워크스페이스 입장 순서입니다.")}
            </p>
          </div>
        )}
      </form>
      )}

      {!successState && (
        <p className="mt-7 text-center text-xs text-muted-foreground">
          {t("auth.register.haveAccount")}{" "}
          <Link to="/auth/login" className="text-primary hover:text-primary/80 font-medium transition-colors">
            {t("auth.register.signInLink")}
          </Link>
        </p>
      )}
    </AuthCard>
  );
}
