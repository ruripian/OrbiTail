import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { settingsApi } from "@/api/settings";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DangerZone } from "@/components/ui/danger-zone";

export function SecurityPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const clearAuth = useAuthStore((s) => s.clearAuth);

  /* 계정 탈퇴 — PASS3-7: DangerZone 으로 통합 (password+DELETE 입력 inline) */
  const deleteMutation = useMutation({
    mutationFn: (password: string) => settingsApi.deleteAccount(password),
    onSuccess: () => {
      toast.success(t("settings.security.deleteAccountSuccess"));
      clearAuth();
      navigate("/login");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail ?? t("settings.security.deleteAccountFailed"));
    },
  });

  // Zod 스키마 (t() 사용을 위해 컴포넌트 내부에 정의)
  const schema = z
    .object({
      current_password: z.string().min(1, t("settings.security.currentPasswordRequired")),
      new_password:     z.string().min(8, t("settings.security.newPasswordMin")),
      confirm_password: z.string(),
    })
    .refine((d) => d.new_password === d.confirm_password, {
      message: t("settings.security.confirmPasswordMismatch"),
      path: ["confirm_password"],
    });
  type FormValues = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: (data: FormValues) =>
      settingsApi.changePassword({
        current_password: data.current_password,
        new_password: data.new_password,
      }),
    onSuccess: () => {
      reset();
      toast.success(t("common.passwordChanged"));
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail ?? t("common.passwordChangeFailed");
      toast.error(msg);
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">{t("settings.security.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("settings.security.subtitle")}
        </p>
      </div>

      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d))}
        className="space-y-5 max-w-sm"
      >
        <div className="space-y-1.5">
          <Label htmlFor="current_password">{t("settings.security.currentPassword")}</Label>
          <Input
            id="current_password"
            type="password"
            autoComplete="current-password"
            {...register("current_password")}
          />
          {errors.current_password && (
            <p className="text-xs text-destructive">{errors.current_password.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new_password">{t("settings.security.newPassword")}</Label>
          <Input
            id="new_password"
            type="password"
            autoComplete="new-password"
            {...register("new_password")}
          />
          {errors.new_password && (
            <p className="text-xs text-destructive">{errors.new_password.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm_password">{t("settings.security.confirmPassword")}</Label>
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            {...register("confirm_password")}
          />
          {errors.confirm_password && (
            <p className="text-xs text-destructive">{errors.confirm_password.message}</p>
          )}
        </div>

        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? t("settings.security.submitting") : t("settings.security.submit")}
        </Button>
      </form>

      {/* ═══════════ DANGER ZONE — 계정 탈퇴 (PASS3-7) ═══════════ */}
      <div className="max-w-xl pt-6 border-t border-border">
        <DangerZone
          title={t("settings.security.deleteAccountTitle")}
          description={t("settings.security.deleteAccountWarning")}
          confirmText={t("settings.security.deleteAccountConfirmText")}
          confirmPlaceholder={t("settings.security.deleteAccountConfirmLabel")}
          requiresPassword
          passwordPlaceholder={t("settings.security.deleteAccountPasswordLabel")}
          buttonLabel={t("settings.security.deleteAccountButton")}
          onConfirm={({ password }) => deleteMutation.mutate(password!)}
          isPending={deleteMutation.isPending}
        />
      </div>
    </div>
  );
}
