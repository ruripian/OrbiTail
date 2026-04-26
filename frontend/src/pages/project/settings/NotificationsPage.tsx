/**
 * 프로젝트별 알림 설정 — 현재 사용자가 이 프로젝트에 한정해 받는 메일을 조정.
 *
 * - muted 켜면 이 프로젝트 관련 메일 전부 차단
 * - 글로벌 타입(assigned/updated/comment_added)은 3-state 토글:
 *    Inherit(global) / Force ON / Force OFF
 * - 프로젝트 전용: email_issue_created (이 프로젝트에 이슈가 생기면 메일)
 */
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { notificationsApi, type ProjectNotificationPreference } from "@/api/notifications";
import { cn } from "@/lib/utils";

type GlobalKey = "email_issue_assigned" | "email_issue_updated" | "email_comment_added";

export function NotificationsPage() {
  const { workspaceSlug, projectId } = useParams<{ workspaceSlug: string; projectId: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const queryKey = ["project-notification-preferences", workspaceSlug, projectId];

  const { data: prefs } = useQuery({
    queryKey,
    queryFn:  () => notificationsApi.getProjectPreferences(workspaceSlug!, projectId!),
    enabled:  !!workspaceSlug && !!projectId,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (data: Partial<ProjectNotificationPreference>) =>
      notificationsApi.updateProjectPreferences(workspaceSlug!, projectId!, data),
    /* 옵티미스틱: 토글 즉시 반영, 실패 시 롤백 */
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<ProjectNotificationPreference>(queryKey);
      if (prev) qc.setQueryData(queryKey, { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      toast.error(t("project.settings.notifications.saveFailed"));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const muted = prefs?.muted ?? false;

  const GLOBAL_KEYS: { key: GlobalKey; labelKey: string }[] = [
    { key: "email_issue_assigned", labelKey: "settings.preferences.notifIssueAssigned" },
    { key: "email_comment_added",  labelKey: "settings.preferences.notifCommentAdded" },
    { key: "email_issue_updated",  labelKey: "settings.preferences.notifIssueUpdated" },
  ];

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        {/* PASS4-1: 책임 분리 — 이 페이지는 이 프로젝트가 외부로 발신하는 알림만 다룸 */}
        <h1 className="text-lg font-semibold">{t("project.settings.integrations.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("project.settings.integrations.subtitle")}
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          {t("project.settings.integrations.userHint")}
        </p>
      </div>

      {/* 인앱 알림 — 정보 표시만 */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("project.settings.notifications.inAppTitle")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("project.settings.notifications.inAppDesc")}
        </p>
      </section>

      {/* 메일 알림 그룹 — mute + override + 프로젝트 전용 */}
      <section className="space-y-6">
        <h2 className="text-sm font-semibold">{t("project.settings.notifications.emailTitle")}</h2>

        {/* 프로젝트 음소거 */}
        <div className="rounded-xl border border-border bg-muted/10 p-4 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{t("project.settings.notifications.muteLabel")}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t("project.settings.notifications.muteDesc")}
            </div>
          </div>
          <Toggle checked={muted} onChange={(v) => mutation.mutate({ muted: v })} />
        </div>

        {/* 글로벌 타입 override — muted면 비활성화 */}
        <div className={cn("space-y-4", muted && "opacity-40 pointer-events-none")}>
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t("project.settings.notifications.overrideTitle")}
            </h3>
            <p className="text-xs text-muted-foreground/80 mt-0.5">
              {t("project.settings.notifications.overrideSubtitle")}
            </p>
          </div>
          <div className="space-y-3">
            {GLOBAL_KEYS.map(({ key, labelKey }) => (
              <TriToggleRow
                key={key}
                label={t(labelKey)}
                value={(prefs?.[key] ?? null) as boolean | null}
                onChange={(v) => mutation.mutate({ [key]: v } as Partial<ProjectNotificationPreference>)}
                tInherit={t("project.settings.notifications.inherit")}
                tOn={t("project.settings.notifications.on")}
                tOff={t("project.settings.notifications.off")}
              />
            ))}
          </div>
        </div>

        {/* 프로젝트 전용 구독 */}
        <div className={cn("space-y-4", muted && "opacity-40 pointer-events-none")}>
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t("project.settings.notifications.projectOnlyTitle")}
            </h3>
            <p className="text-xs text-muted-foreground/80 mt-0.5">
              {t("project.settings.notifications.projectOnlySubtitle")}
            </p>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {t("project.settings.notifications.issueCreatedLabel")}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t("project.settings.notifications.issueCreatedDesc")}
              </div>
            </div>
            <Toggle
              checked={prefs?.email_issue_created ?? false}
              onChange={(v) => mutation.mutate({ email_issue_created: v })}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── 토글 (PreferencesPage 와 동일 디자인이나 페이지 간 결합 회피 위해 로컬 정의) ── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "shrink-0 h-5 w-9 rounded-full border transition-colors flex items-center px-0.5 mt-0.5",
        checked ? "bg-primary border-primary" : "bg-muted/40 border-border"
      )}
    >
      <span
        className={cn(
          "h-4 w-4 rounded-full shadow-sm transition-transform",
          checked ? "translate-x-4 bg-primary-foreground" : "translate-x-0 bg-muted-foreground/60"
        )}
      />
    </button>
  );
}

/* 3-state row: 라벨 + Inherit/On/Off 세그먼트 */
function TriToggleRow({
  label, value, onChange, tInherit, tOn, tOff,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  tInherit: string; tOn: string; tOff: string;
}) {
  const opts: { v: boolean | null; label: string }[] = [
    { v: null,  label: tInherit },
    { v: true,  label: tOn },
    { v: false, label: tOff },
  ];
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm text-foreground">{label}</div>
      <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5">
        {opts.map((o) => {
          const active = value === o.v;
          return (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => onChange(o.v)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-all duration-fast",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
