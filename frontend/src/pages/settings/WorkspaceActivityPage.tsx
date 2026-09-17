/**
 * 워크스페이스 설정 · 활동 기록 — 관리자 전용.
 * 누가 언제 프로젝트·스페이스·멤버·토큰·웹훅을 바꿨는지. 특히 관리자가 비공개 공간에 자신을 추가한 기록이 여기 남는다.
 */
import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { manageApi, type WorkspaceActivityEntry } from "@/api/manage";
import { cn } from "@/lib/utils";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { formatLongDate, formatTime } from "@/utils/date-format";
import { PROJECT_ROLE_KEY } from "./WorkspaceProjectsManagePage";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useWorkspaceAdmin } from "./useWorkspaceAdmin";

const CATEGORIES = [
  { value: "", labelKey: "workspaceSettings.activity.cat.all" },
  { value: "project", labelKey: "workspaceSettings.activity.cat.project" },
  { value: "space", labelKey: "workspaceSettings.activity.cat.space" },
  { value: "member", labelKey: "workspaceSettings.activity.cat.member" },
  { value: "invitation", labelKey: "workspaceSettings.activity.cat.invitation" },
  { value: "join", labelKey: "workspaceSettings.activity.cat.join" },
  { value: "team", labelKey: "workspaceSettings.activity.cat.team" },
  { value: "api_token", labelKey: "workspaceSettings.activity.cat.apiToken" },
  { value: "webhook", labelKey: "workspaceSettings.activity.cat.webhook" },
];


const WS_ROLE_KEY: Record<number, string> = {
  10: "settings.workspaceMembers.role.guest",
  15: "settings.workspaceMembers.role.member",
  20: "settings.workspaceMembers.role.admin",
  25: "settings.workspaceMembers.role.owner",
};
const SPACE_ROLE_KEY: Record<number, string> = {
  5: "documents.spaceRole.viewer",
  15: "documents.spaceRole.editor",
  20: "documents.spaceRole.admin",
};

function roleLabel(t: TFunction, action: string, role: unknown) {
  if (typeof role !== "number") return String(role);
  const map = action.startsWith("project.") ? PROJECT_ROLE_KEY : action.startsWith("space.") ? SPACE_ROLE_KEY : WS_ROLE_KEY;
  return map[role] ? t(map[role]) : String(role);
}

/** 사람이 읽을 수 있는 세부 — 알려진 키만 보여 주고 나머지는 숨긴다(내부 식별자 노출 방지) */
function details(t: TFunction, a: WorkspaceActivityEntry): string[] {
  const m = a.metadata;
  const out: string[] = [];
  if (typeof m.member === "string") out.push(m.member);
  if (typeof m.email === "string") out.push(m.email);
  if ("lead" in m) out.push(t("workspaceSettings.activity.leadTo", { name: m.lead ?? t("workspaceSettings.activity.leadNone") }));
  if ("role" in m) out.push(roleLabel(t, a.action, m.role));
  if ("old_role" in m && "new_role" in m) out.push(`${roleLabel(t, a.action, m.old_role)} → ${roleLabel(t, a.action, m.new_role)}`);
  if ("is_private" in m && a.action === "space.visibility") out.push(m.is_private ? t("workspaceSettings.activity.toPrivate") : t("workspaceSettings.activity.toPublic"));
  if (Array.isArray(m.changed)) out.push(t("workspaceSettings.activity.changedFields", { fields: m.changed.join(", ") }));
  if (m.via === "workspace_settings") out.push(t("workspaceSettings.activity.viaSettings"));
  return out;
}

export function WorkspaceActivityPage() {
  const { t } = useTranslation();
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const { isAdmin, isLoading: membersLoading } = useWorkspaceAdmin(workspaceSlug);
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["workspace-activity", workspaceSlug, category, page],
    queryFn: () => manageApi.activity(workspaceSlug, { category: category || undefined, page }),
    enabled: !!workspaceSlug && isAdmin,
    placeholderData: keepPreviousData,
  });

  if (!membersLoading && !isAdmin) {
    return <Navigate to={`/${workspaceSlug}/workspace-settings/archived`} replace />;
  }

  const rows = data?.results ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">{t("workspaceSettings.activity.title")}</h1>
        <p className="text-xs text-muted-foreground mt-1">
          {t("workspaceSettings.activity.subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button key={c.value} type="button" onClick={() => { setCategory(c.value); setPage(1); }}
            aria-pressed={category === c.value}
            className={cn(
              "px-2.5 py-1 rounded-full border text-xs transition-colors",
              category === c.value ? "bg-primary/10 border-primary/40 text-foreground" : "text-muted-foreground hover:bg-accent",
            )}>
            {t(c.labelKey)}
          </button>
        ))}
      </div>

      {isLoading || membersLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("workspaceSettings.activity.empty")}</p>
      ) : (
        <div className={cn("rounded-lg border divide-y bg-background", isFetching && "opacity-70")}>
          {rows.map((a) => {
            const selfAddedPrivate = a.metadata.self_added === true && a.metadata.is_private === true;
            return (
              <div key={a.id} className="flex items-start gap-3 px-3 py-2.5">
                <AvatarInitials name={a.actor.display_name || a.actor.email} avatar={a.actor.avatar} size="sm" className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{a.actor.display_name || a.actor.email}</span>
                    <span className="text-muted-foreground"> · {t(`workspaceSettings.activity.action.${a.action}`, { defaultValue: a.action })}</span>
                    {a.target_label && <span className="font-medium"> · {a.target_label}</span>}
                    {selfAddedPrivate && (
                      <span className="ml-2 text-2xs font-semibold px-1.5 py-0.5 rounded-md border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                        {t("workspaceSettings.activity.selfAddedPrivate")}
                      </span>
                    )}
                  </p>
                  {details(t, a).length > 0 && (
                    <p className="text-2xs text-muted-foreground mt-0.5 truncate">{details(t, a).join(" · ")}</p>
                  )}
                </div>
                <time className="shrink-0 text-2xs text-muted-foreground tabular-nums" dateTime={a.created_at}>
                  {formatLongDate(a.created_at)} {formatTime(a.created_at)}
                </time>
              </div>
            );
          })}
        </div>
      )}

      {(data?.previous || data?.next) && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={!data?.previous} onClick={() => setPage((p) => p - 1)}>{t("workspaceSettings.activity.prev")}</Button>
          <span className="text-xs text-muted-foreground">{t("workspaceSettings.activity.pageNo", { page })}</span>
          <Button variant="outline" size="sm" disabled={!data?.next} onClick={() => setPage((p) => p + 1)}>{t("workspaceSettings.activity.next")}</Button>
        </div>
      )}
    </div>
  );
}
