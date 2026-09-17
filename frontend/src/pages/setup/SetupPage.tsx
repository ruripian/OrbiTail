import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import i18n from "@/lib/i18n";
import { setupApi } from "@/api/setup";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuthCard, AuthCardHeader } from "@/components/auth/AuthCard";
import { TIMEZONES } from "@/lib/timezones";

const LANGUAGES = [
  { value: "ko", label: "한국어" }, // i18n-ignore — 언어 자기 이름
  { value: "en", label: "English" },
] as const;

/* 비밀번호 복잡도: 8자 이상 + 영문 + 숫자 + 특수문자 */
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;

const schema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  display_name: z.string().min(1),
  email: z.string().email(),
  password: z.string().regex(PASSWORD_RE),
  confirm_password: z.string(),
  timezone: z.string().min(1),
}).refine((d) => d.password === d.confirm_password, {
  path: ["confirm_password"],
  message: "passwordMismatch",
});

type FormValues = z.infer<typeof schema>;

// 섹션 구분선 컴포넌트
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-2xs font-semibold tracking-widest text-primary uppercase mb-3">
      {children}
    </p>
  );
}

export function SetupPage({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);

  const { register, handleSubmit, control, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { timezone: "Asia/Seoul" },
  });

  const mutation = useMutation({
    mutationFn: setupApi.initialize,
    onSuccess: () => {
      // 셋업 완료 후 로그인 페이지로 보냄 (자동 로그인 제거 — 의도적)
      // onComplete → status="ready" → router 진입 → ProtectedRoute가 /auth/login으로 리다이렉트
      toast.success(t("setup.successLoginNeeded"));
      onComplete();
    },
  });

  // 언어 변경 — 폼 제출 없이 즉시 적용 (i18n + localStorage 자동 저장)
  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <AuthCard wide>
      <AuthCardHeader subtitle={t("setup.subtitle")} />

      <form onSubmit={handleSubmit(({ confirm_password: _cp, ...d }) => mutation.mutate(d))} className="space-y-6">

        {/* ── 시스템 설정 섹션 ── */}
        <div>
          <SectionLabel>{t("setup.systemSection")}</SectionLabel>
          <div className="grid grid-cols-2 gap-3">

            {/* 언어 선택 — 선택 즉시 UI 언어 변경, 서버로 전송하지 않음 */}
            <div className="space-y-1.5">
              <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                {t("setup.language")}
              </Label>
              <Select
                defaultValue={i18n.language.startsWith("ko") ? "ko" : "en"}
                onValueChange={handleLanguageChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 타임존 */}
            <div className="space-y-1.5">
              <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                {t("setup.timezone")}
              </Label>
              <Controller
                control={control}
                name="timezone"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
        </div>

        {/* ── 관리자 계정 섹션 ── */}
        <div>
          <SectionLabel>{t("setup.adminSection")}</SectionLabel>
          <div className="space-y-3">
            {/* 성 / 이름 — 가로 2칸 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                  {t("setup.lastName")}
                </Label>
                <Input placeholder={t("setup.lastNamePlaceholder")} {...register("last_name")} />
                {errors.last_name && (
                  <p className="text-xs text-destructive">{errors.last_name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                  {t("setup.firstName")}
                </Label>
                <Input placeholder={t("setup.firstNamePlaceholder")} {...register("first_name")} />
                {errors.first_name && (
                  <p className="text-xs text-destructive">{errors.first_name.message}</p>
                )}
              </div>
            </div>

            {/* 표기 이름 */}
            <div className="space-y-1.5">
              <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                {t("setup.displayName")}
              </Label>
              <Input placeholder={t("setup.displayNamePlaceholder")} {...register("display_name")} />
              {errors.display_name && (
                <p className="text-xs text-destructive">{errors.display_name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                {t("setup.email")}
              </Label>
              <Input type="email" placeholder={t("setup.emailPlaceholder")} {...register("email")} />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            {/* 비밀번호 — 보기/숨기기 토글 */}
            <div className="space-y-1.5">
              <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                {t("setup.password")}
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder={t("setup.passwordPlaceholder")}
                  {...register("password")}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <p className="text-2xs text-muted-foreground/70">{t("setup.passwordRule")}</p>
              {errors.password && (
                <p className="text-xs text-destructive">{t("setup.passwordRuleError")}</p>
              )}
            </div>

            {/* 비밀번호 확인 */}
            <div className="space-y-1.5">
              <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                {t("setup.confirmPassword")}
              </Label>
              <div className="relative">
                <Input
                  type={showConfirm ? "text" : "password"}
                  placeholder={t("setup.confirmPasswordPlaceholder")}
                  {...register("confirm_password")}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground hover:text-foreground"
                >
                  {showConfirm ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.confirm_password && (
                <p className="text-xs text-destructive">{t("setup.passwordMismatch")}</p>
              )}
            </div>
          </div>
        </div>

        {mutation.isError && (
          <p className="text-xs text-destructive">{t("setup.error")}</p>
        )}

        <Button
          type="submit"
          className="w-full font-semibold tracking-widest"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? t("setup.submitting") : t("setup.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
