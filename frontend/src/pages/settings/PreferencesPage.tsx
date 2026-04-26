import { useState } from "react";
import { useTranslation, getI18n } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { settingsApi } from "@/api/settings";
import { notificationsApi, type NotificationPreference } from "@/api/notifications";
import { useAuthStore } from "@/stores/authStore";
import { useTheme } from "@/lib/theme-provider";
import { useMotion, type MotionMode } from "@/lib/motion-provider";
import { useDensity, type Density } from "@/lib/density-provider";
import { TIMEZONES } from "@/lib/timezones";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** PASS3-6 — 모든 프리퍼런스를 즉시 저장으로 통일.
    Theme/Motion/Density 는 자체 provider 가 즉시 반영. Locale 그룹(Language/Timezone/FirstDayOfWeek)도
    onChange 시 PATCH 한 번. Save 버튼/form wrapper 제거.
    카드 그루핑: Appearance / Locale & Region / Notifications. */

type Theme = "light" | "dark";
type Language = "ko" | "en";
type FirstDow = 0 | 1;

interface LocaleState {
  language: Language;
  timezone: string;
  first_day_of_week: FirstDow;
}

export function PreferencesPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const { setTheme } = useTheme();
  const { mode: motionMode, setMode: setMotionMode } = useMotion();
  const { density, setDensity } = useDensity();

  const initialTheme: Theme = ((user?.theme === "system" ? "dark" : user?.theme) ?? "dark") as Theme;
  const [themeValue, setThemeValue] = useState<Theme>(initialTheme);
  const [locale, setLocale] = useState<LocaleState>({
    language: (user?.language ?? "ko") as Language,
    timezone: user?.timezone ?? "Asia/Seoul",
    first_day_of_week: (user?.first_day_of_week ?? 0) as FirstDow,
  });

  const mutation = useMutation({
    mutationFn: (data: Partial<{ theme: Theme; language: Language; timezone: string; first_day_of_week: FirstDow }>) =>
      settingsApi.updatePreferences(data),
    onSuccess: (updated) => {
      updateUser(updated);
      if (updated.language) getI18n().changeLanguage(updated.language);
    },
    onError: () => toast.error(t("settings.preferences.saveFailed")),
  });

  const THEME_OPTIONS = [
    { value: "light", label: t("settings.preferences.themeLight") },
    { value: "dark",  label: t("settings.preferences.themeDark")  },
  ] as const;

  const LANGUAGE_OPTIONS = [
    { value: "ko", label: t("settings.preferences.langKo") },
    { value: "en", label: t("settings.preferences.langEn") },
  ];

  const DOW_OPTIONS = [
    { value: 0, label: t("settings.preferences.sunday") },
    { value: 1, label: t("settings.preferences.monday") },
  ];

  /* ── 알림 환경설정 ── */
  const qc = useQueryClient();
  const { data: notifPrefs } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn:  notificationsApi.getPreferences,
    staleTime: 30_000,
  });
  const notifMutation = useMutation({
    mutationFn: (data: Partial<NotificationPreference>) => notificationsApi.updatePreferences(data),
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
    { key: "email_comment_added",  labelKey: "settings.preferences.notifCommentAdded"  },
    { key: "email_issue_updated",  labelKey: "settings.preferences.notifIssueUpdated"  },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{t("settings.preferences.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("settings.preferences.subtitle")}
        </p>
      </div>

      {/* ── Appearance ── */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-5">
        <h2 className="text-sm font-semibold text-foreground">
          {t("settings.preferences.sectionAppearance", "외관")}
        </h2>

        <div className="flex items-center gap-6">
          <Label>{t("settings.preferences.theme")}</Label>
          <SegmentedControl
            value={themeValue}
            options={THEME_OPTIONS}
            onChange={(v) => {
              const nv = v as Theme;
              setThemeValue(nv);
              setTheme(nv);
              mutation.mutate({ theme: nv });
            }}
          />
        </div>

        <div className="flex items-center gap-6">
          <Label>{t("settings.preferences.motionMode")}</Label>
          <SegmentedControl
            value={motionMode}
            options={[
              { value: "rich",    label: t("settings.preferences.motionRich") },
              { value: "minimal", label: t("settings.preferences.motionMinimal") },
            ]}
            onChange={(v) => setMotionMode(v as MotionMode)}
          />
        </div>

        <div className="flex items-center gap-6">
          <Label>{t("settings.preferences.density", "밀도")}</Label>
          <SegmentedControl
            value={density}
            options={[
              { value: "compact",     label: t("settings.preferences.densityCompact") },
              { value: "comfortable", label: t("settings.preferences.densityComfortable") },
              { value: "spacious",    label: t("settings.preferences.densitySpacious") },
            ]}
            onChange={(v) => setDensity(v as Density)}
          />
        </div>
      </section>

      {/* ── Locale & Region ── */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-5">
        <h2 className="text-sm font-semibold text-foreground">
          {t("settings.preferences.sectionLocale", "언어 및 지역")}
        </h2>

        <div className="space-y-1.5">
          <Label>{t("settings.preferences.language")}</Label>
          <Select
            value={locale.language}
            onValueChange={(v) => {
              const nv = v as Language;
              setLocale((prev) => ({ ...prev, language: nv }));
              mutation.mutate({ language: nv });
            }}
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

        <div className="space-y-1.5">
          <Label>{t("settings.preferences.timezone")}</Label>
          <Select
            value={locale.timezone}
            onValueChange={(v) => {
              setLocale((prev) => ({ ...prev, timezone: v }));
              mutation.mutate({ timezone: v });
            }}
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

        <div className="space-y-1.5">
          <Label>{t("settings.preferences.firstDayOfWeek")}</Label>
          <Select
            value={String(locale.first_day_of_week)}
            onValueChange={(v) => {
              const nv = Number(v) as FirstDow;
              setLocale((prev) => ({ ...prev, first_day_of_week: nv }));
              mutation.mutate({ first_day_of_week: nv });
            }}
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
      </section>

      {/* ── Notifications ── */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("settings.preferences.notifTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t("settings.preferences.notifSubtitle")}</p>
        </div>

        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("settings.preferences.inAppTitle")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("settings.preferences.inAppDesc")}</p>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("settings.preferences.emailTitle")}
          </h3>

          <NotifToggle
            label={t("settings.preferences.notifEmailMaster")}
            description={t("settings.preferences.notifEmailMasterDesc")}
            checked={notifPrefs?.email_enabled ?? true}
            onChange={(v) => notifMutation.mutate({ email_enabled: v })}
          />

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
      </section>
    </div>
  );
}

/* ── Helpers ── */

interface SegOpt<V extends string> { value: V; label: string }
function SegmentedControl<V extends string>({
  value, options, onChange,
}: {
  value: V;
  options: readonly SegOpt<V>[];
  onChange: (v: V) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-5 py-1.5 text-xs font-medium transition-all duration-fast",
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
  );
}

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
