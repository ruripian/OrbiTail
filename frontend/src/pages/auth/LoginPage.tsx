import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, Link, Navigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";
import { getRemember } from "@/lib/token-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthCard, AuthCardHeader } from "@/components/auth/AuthCard";
import { OrbiTailOrbit } from "@/components/auth/OrbiTailOrbit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const accessToken = useAuthStore((s) => s.accessToken);
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  /* 직전에 고른 값으로 시작 — 기본값은 유지(true) */
  const [remember, setRemember] = useState(() => getRemember());
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const notice = searchParams.get("notice"); // verify-email | approval-pending

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setAuth(data.user, data.access, data.refresh, remember);
      // 초대 등에서 redirect 파라미터가 있으면 해당 경로로 이동
      navigate(redirectTo || "/");
    },
    onError: () => {
      toast.error(t("auth.login.error"));
    },
  });

  /* 이미 세션이 있으면 폼을 건너뛰고 바로 들어간다 — /auth/login 을 북마크해 둔 경우
     로그인 상태인데도 매번 로그인 화면을 보게 되는 것을 막는다.
     토큰 만료 여부는 여기서 따지지 않는다. access 가 만료됐으면 첫 API 401 에서 axios 가
     refresh 로 살리고, refresh 마저 죽었으면 clearAuth 후 이 페이지로 되돌아와 폼이 뜬다.
     단 가입 직후 안내(notice)가 붙어 온 경우는 그 안내를 보여줘야 하므로 예외. */
  if (accessToken && !notice) {
    return <Navigate to={redirectTo || "/"} replace />;
  }

  return (
    <>
      <OrbiTailOrbit size={1200} strokeW={5} offsetY={-40} forceRich />
      <AuthCard>
        <AuthCardHeader subtitle={t("auth.login.subtitle")} />

        {/* 가입 직후 안내 — 토스트는 짧게 사라지므로 페이지에 고정 배너로 추가 노출 */}
        {notice === "verify-email" && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
            <p className="font-semibold mb-0.5">
              {t("auth.login.verifyEmailNoticeTitle", "이메일 인증이 필요합니다")}
            </p>
            <p className="opacity-90">
              {t("auth.login.verifyEmailNoticeBody", "가입한 이메일 주소로 인증 링크를 보냈습니다. 메일을 확인한 뒤 로그인해 주세요.")}
            </p>
          </div>
        )}
        {notice === "approval-pending" && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
            <p className="font-semibold mb-0.5">
              {t("auth.login.approvalNoticeTitle", "관리자 승인이 필요합니다")}
            </p>
            <p className="opacity-90">
              {t("auth.login.approvalNoticeBody", "가입은 완료됐습니다. 관리자가 승인하면 로그인할 수 있습니다.")}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("auth.login.email")}
            </Label>
            <Input
              type="email"
              placeholder={t("auth.login.emailPlaceholder")}
              tabIndex={1}
              /* 브라우저 비밀번호 관리자가 저장·자동완성을 인식하려면 username/current-password 쌍이 필요 */
              autoComplete="username"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("auth.login.password")}
            </Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder={t("auth.login.passwordPlaceholder")}
                tabIndex={2}
                autoComplete="current-password"
                {...register("password")}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          {/* Checkbox 자체가 label 이라 텍스트를 안에 넣으면 label 이 중첩된다 — 옆에 두고 클릭만 연결 */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={remember}
              onChange={setRemember}
              size="sm"
              tabIndex={3}
              aria-label={t("auth.login.rememberMe")}
            />
            <span className="cursor-pointer select-none" onClick={() => setRemember(!remember)}>
              {t("auth.login.rememberMe")}
            </span>
          </div>

          {mutation.isError && (
            <p className="text-xs text-destructive">{t("auth.login.error")}</p>
          )}

          <Button type="submit" tabIndex={4} className="w-full font-semibold tracking-widest" disabled={mutation.isPending}>
            {mutation.isPending ? t("auth.login.submitting") : t("auth.login.submit")}
          </Button>
        </form>

        <div className="mt-5 flex flex-col items-center justify-center space-y-4 text-xs text-muted-foreground">
          <p>
            {t("auth.login.noAccount")}{" "}
            <Link to="/auth/register" className="text-primary hover:text-primary/80 font-medium transition-colors">
              {t("auth.login.signUpLink")}
            </Link>
          </p>

          <Link
            to="/auth/forgot-password"
            className="text-muted-foreground hover:text-primary transition-colors hover:underline underline-offset-4"
          >
            {t("auth.login.forgotPassword")}
          </Link>
        </div>
      </AuthCard>
    </>
  );
}
