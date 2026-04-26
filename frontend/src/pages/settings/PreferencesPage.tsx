import { useForm } from "react-hook-form";
import { useTranslation, getI18n } from "react-i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";


import { settingsApi } from "@/api/settings";
import { notificationsApi, type NotificationPreference } from "@/api/notifications";
import { useAuthStore } from "@/stores/authStore";
import { useTheme } from "@/lib/theme-provider";
import { useMotion, type MotionMode } from "@/lib/motion-provider";
import { useDensity, type Density } from "@/lib/density-provider";
import { TIMEZONES } from "@/lib/timezones";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const schema = z.object({
  theme:             z.enum(["light", "dark"]),
  language:          z.enum(["ko", "en"]),
  timezone:          z.string().min(1),
  first_day_of_week: z.number().int().min(0).max(1),
});
type FormValues = z.infer<typeof schema>;

export function PreferencesPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const { setTheme } = useTheme();
  const { mode: motionMode, setMode: setMotionMode } = useMotion();
  const { density, setDensity } = useDensity();

  // 옵션 목록 (t() 사용을 위해 컴포넌트 내부에 정의)
  const THEME_OPTIONS = [
    { value: "light",  label: t("settings.preferences.themeLight") },
    { value: "dark",   label: t("settings.preferences.themeDark") },
  ] as const;

  const LANGUAGE_OPTIONS = [
    { value: "ko", label: t("settings.preferences.langKo") },
    { value: "en", label: t("settings.preferences.langEn") },
  ];

  const DOW_OPTIONS = [
    { value: 0, label: t("settings.preferences.sunday") },
    { value: 1, label: t("settings.preferences.monday") },
  ];

  const { handleSubmit, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      theme:             ((user?.theme === "system" ? "dark" : user?.theme) ?? "dark") as FormValues["theme"],
      language:          (user?.language ?? "ko") as FormValues["language"],
      timezone:          user?.timezone ?? "Asia/Seoul",
      first_day_of_week: user?.first_day_of_week ?? 0,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: FormValues) => settingsApi.updatePreferences(data),
    onSuccess: (updated) => {
      updateUser(updated);
      /* 언어 변경을 i18n에 즉시 반영 */
      if (updated.language) getI18n().changeLanguage(updated.language);
      toast.success(t("settings.preferences.saved"));
    },
    onError: () => toast.error(t("settings.preferences.saveFailed")),
  });

  // watch로 현재 값 추적 (Select에 value 바인딩 필요)
  const values = watch();

  /* ── 알림 환경설정 (이메일) — 별도 엔드포인트로 즉시 저장 ── */
  const qc = useQueryClient();
  const { data: notifPrefs } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn:  notificationsApi.getPreferences,
    staleTime: 30_000,
  });
  const notifMutation = useMutation({
    mutationFn: (data: Partial<NotificationPreference>) => notificationsApi.updatePreferences(data),
    /* 옵티미스틱 업데이트 — 토글 즉시 반영, 실패 시 롤백 */
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["notification-preferences"] });
      const prev = qc.getQueryData<NotificationPreference>(["notification-preferences"]);
      if (prev) qc.setQueryData(["notification-preferences"], { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notification-preferences"], ctx.prev);
      toast.error(t("settings.preferences.saveFailed"));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });

  const NOTIF_KEYS = [
    { key: "email_issue_assigned", labelKey: "settings.preferences.notifIssueAssigned" },
    { key: "email_comment_added",  labelKey: "settings.preferences.notifCommentAdded" },
    { key: "email_issue_updated",  labelKey: "settings.preferences.notifIssueUpdated" },
  ] as const;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">{t("settings.preferences.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("settings.preferences.subtitle")}
        </p>
      </div>

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-6">

        {/* 테마 토글 */}
        <div className="flex items-center gap-6">
          <Label>{t("settings.preferences.theme")}</Label>
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {THEME_OPTIONS.map((o) => {
              const active = values.theme === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    const themeVal = o.value as FormValues["theme"];
                    setValue("theme", themeVal);
                    setTheme(themeVal);
                  }}
                  className={cn(
                    "rounded-md px-5 py-1.5 text-xs font-medium transition-all duration-150",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 애니메이션 모드 */}
        <div className="flex items-center gap-6">
          <Label>{t("settings.preferences.motionMode")}</Label>
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {([
              { value: "rich",    label: t("settings.preferences.motionRich") },
              { value: "minimal", label: t("settings.preferences.motionMinimal") },
            ] as const).map((o) => {
              const active = motionMode === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setMotionMode(o.value as MotionMode)}
                  className={cn(
                    "rounded-md px-5 py-1.5 text-xs font-medium transition-all duration-150",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Phase 2.6 — Density 토글 (compact / comfortable / spacious) */}
        <div className="flex items-center gap-6">
          <Label>{t("settings.preferences.density", "밀도")}</Label>
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {([
              { value: "compact",     label: t("settings.preferences.densityCompact",     "조밀") },
              { value: "comfortable", label: t("settings.preferences.densityComfortable", "보통") },
              { value: "spacious",    label: t("settings.preferences.densitySpacious",    "여유") },
            ] as const).map((o) => {
              const active = density === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setDensity(o.value as Density)}
                  className={cn(
                    "rounded-md px-5 py-1.5 text-xs font-medium transition-all duration-150",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 언어 */}
        <div className="space-y-1.5">
          <Label>{t("settings.preferences.language")}</Label>
          <Select
            value={values.language}
            onValueChange={(v) => setValue("language", v as FormValues["language"])}
          >
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 시간대 */}
        <div className="space-y-1.5">
          <Label>{t("settings.preferences.timezone")}</Label>
          <Select
            value={values.timezone}
            onValueChange={(v) => setValue("timezone", v)}
          >
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 주의 시작 요일 */}
        <div className="space-y-1.5">
          <Label>{t("settings.preferences.firstDayOfWeek")}</Label>
          <Select
            value={String(values.first_day_of_week)}
            onValueChange={(v) => setValue("first_day_of_week", Number(v))}
          >
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOW_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? t("settings.preferences.saving") : t("settings.preferences.save")}
        </Button>
      </form>

      {/* ── 알림 환경설정 ── */}
      <div className="pt-8 mt-2 border-t border-border space-y-8">
        <div>
          <h2 className="text-base font-semibold">{t("settings.preferences.notifTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("settings.preferences.notifSubtitle")}
          </p>
        </div>

        {/* 인앱 알림 — 항상 표시, 토글 없음 */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("settings.preferences.inAppTitle")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.preferences.inAppDesc")}
          </p>
        </section>

        {/* 메일 알림 */}
        <section className="space-y-5">
          <h3 className="text-sm font-semibold">{t("settings.preferences.emailTitle")}</h3>

          {/* 마스터 토글 */}
          <NotifToggle
            label={t("settings.preferences.notifEmailMaster")}
            description={t("settings.preferences.notifEmailMasterDesc")}
            checked={notifPrefs?.email_enabled ?? true}
            onChange={(v) => notifMutation.mutate({ email_enabled: v })}
          />

          {/* 타입별 토글 — 마스터가 꺼져있으면 비활성화 */}
          <div className={cn("space-y-3 pl-2", !(notifPrefs?.email_enabled ?? true) && "opacity-40 pointer-events-none")}>
            {NOTIF_KEYS.map(({ key, labelKey }) => (
              <NotifToggle
                key={key}
                label={t(labelKey)}
                checked={(notifPrefs?.[key] ?? true) as boolean}
                onChange={(v) => notifMutation.mutate({ [key]: v } as Partial<NotificationPreference>)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* 작은 토글 행 컴포넌트 — PreferencesPage 안에서만 사용 */
function NotifToggle({
  label, description, checked, onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer group">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "shrink-0 h-5 w-9 rounded-full border transition-colors flex items-center px-0.5 mt-0.5",
          checked
            ? "bg-primary border-primary"
            : "bg-muted/40 border-border group-hover:border-border/80"
        )}
      >
        <span
          className={cn(
            "h-4 w-4 rounded-full shadow-sm transition-transform",
            checked ? "translate-x-4 bg-primary-foreground" : "translate-x-0 bg-muted-foreground/60"
          )}
        />
      </button>
    </label>
  );
}
