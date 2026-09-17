/**
 * 워크스페이스 설정 · 사용량 — 관리자 전용. 규모·첨부 용량과 정리할 거리(주인 없는 개인 스페이스)를 보여 준다.
 * 개인 스페이스는 내용을 보지 않고 목록만 — 영구 삭제는 슈퍼유저 콘솔이 맡는다.
 */
import { Link, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";

import { manageApi } from "@/api/manage";
import { useWorkspaceAdmin } from "./useWorkspaceAdmin";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const ORPHAN_REASON: Record<string, string> = {
  owner_missing: "workspaceSettings.usage.reason.ownerMissing",
  owner_inactive: "workspaceSettings.usage.reason.ownerInactive",
  owner_left: "workspaceSettings.usage.reason.ownerLeft",
};

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-2xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-2xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export function WorkspaceUsagePage() {
  const { t } = useTranslation();
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const { isAdmin, isLoading: membersLoading } = useWorkspaceAdmin(workspaceSlug);
  const { data, isLoading } = useQuery({
    queryKey: ["workspace-usage", workspaceSlug],
    queryFn: () => manageApi.usage(workspaceSlug),
    enabled: !!workspaceSlug && isAdmin,
  });

  if (!membersLoading && !isAdmin) {
    return <Navigate to={`/${workspaceSlug}/workspace-settings/archived`} replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t("workspaceSettings.usage.title")}</h1>
        <p className="text-xs text-muted-foreground mt-1">{t("workspaceSettings.usage.subtitle")}</p>
      </div>

      {isLoading || membersLoading || !data ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("common.loading")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label={t("workspaceSettings.usage.members")} value={data.members} />
            <Stat label={t("sidebar.teams")} value={data.teams} />
            <Stat label={t("workspaceSettings.projects.title")} value={data.projects} sub={t("workspaceSettings.usage.projectSub", { archived: data.projects_archived, trashed: data.projects_trashed })} />
            <Stat label={t("workspaceSettings.usage.issues")} value={data.issues} sub={t("workspaceSettings.usage.trashedSub", { count: data.issues_trashed })} />
            <Stat label={t("workspaceSettings.usage.sharedSpaces")} value={data.spaces} />
            <Stat label={t("workspaceSettings.usage.documents")} value={data.documents} sub={t("workspaceSettings.usage.trashedSub", { count: data.documents_trashed })} />
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t("workspaceSettings.usage.attachments")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Stat label={t("workspaceSettings.usage.total")}
                value={formatBytes(data.storage.issue_attachments.bytes + data.storage.document_attachments.bytes)}
                sub={t("workspaceSettings.usage.fileCount", { count: data.storage.issue_attachments.count + data.storage.document_attachments.count })} />
              <Stat label={t("admin.overview.storageIssues")} value={formatBytes(data.storage.issue_attachments.bytes)} sub={t("workspaceSettings.usage.fileCount", { count: data.storage.issue_attachments.count })} />
              <Stat label={t("admin.overview.storageDocuments")} value={formatBytes(data.storage.document_attachments.bytes)} sub={t("workspaceSettings.usage.fileCount", { count: data.storage.document_attachments.count })} />
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t("workspaceSettings.usage.orphanTitle")}</h2>
            <p className="text-2xs text-muted-foreground">
              {t("workspaceSettings.usage.orphanDesc")}
              {data.can_delete_orphans ? (
                <> {t("workspaceSettings.usage.purgeVia")} <Link to={`/admin/workspaces/${workspaceSlug}/spaces`} className="underline hover:text-foreground">{t("workspaceSettings.usage.adminConsole")}</Link>.</>
              ) : (
                <> {t("workspaceSettings.usage.askAdmin")}</>
              )}
            </p>
            {data.orphan_personal_spaces.length === 0 ? (
              <p className="text-xs text-muted-foreground rounded-lg border bg-background p-3">{t("workspaceSettings.usage.orphanEmpty")}</p>
            ) : (
              <div className="rounded-lg border divide-y bg-background">
                {data.orphan_personal_spaces.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-medium truncate">{s.name}</span>
                    <span className="text-2xs text-muted-foreground">{s.owner_email ?? "—"}</span>
                    <span className="ml-auto text-2xs text-muted-foreground">
                      {ORPHAN_REASON[s.reason] ? t(ORPHAN_REASON[s.reason]) : s.reason} · {t("workspaceSettings.usage.docCount", { count: s.document_count })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
