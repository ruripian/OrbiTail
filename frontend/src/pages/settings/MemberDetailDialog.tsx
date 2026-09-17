/**
 * 워크스페이스 멤버 상세 — 어느 프로젝트·스페이스·팀에 속해 있고 맡은 일이 얼마나 남았는지.
 * 내보내거나 역할을 바꾸기 전에 영향을 확인하는 용도. 이슈 제목 같은 내용은 싣지 않는다.
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { manageApi } from "@/api/manage";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatLongDate } from "@/utils/date-format";
import { PROJECT_ROLE_KEY } from "./WorkspaceProjectsManagePage";

/* 역할 번호 → i18n 키 (문구가 아니라 키) */
const SPACE_ROLE_KEY: Record<number, string> = {
  5: "documents.spaceRole.viewer",
  15: "documents.spaceRole.editor",
  20: "documents.spaceRole.admin",
};
const TEAM_ROLE_KEY: Record<number, string> = { 15: "team.role.member", 20: "team.role.admin" };

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <section>
      <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">{title} {count}</h3>
      {count === 0 ? <p className="text-2xs text-muted-foreground">{t("memberDetail.none")}</p> : <div className="rounded-md border divide-y">{children}</div>}
    </section>
  );
}

export function MemberDetailDialog({ workspaceSlug, userId, onClose }: {
  workspaceSlug: string;
  userId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["manage-member", workspaceSlug, userId],
    queryFn: () => manageApi.member(workspaceSlug, userId),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("memberDetail.title")}</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t("common.loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <AvatarInitials name={data.user.display_name || data.user.email} avatar={data.user.avatar} size="lg" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {data.user.display_name}
                  {(!data.user.is_active || data.user.is_suspended) && (
                    <span className="ml-1.5 text-2xs text-destructive">{data.user.is_suspended ? t("memberDetail.suspended") : t("memberDetail.inactive")}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground truncate">{data.user.email}</p>
                <p className="text-2xs text-muted-foreground mt-0.5">
                  {t("memberDetail.joinedOn", { date: formatLongDate(data.joined_at) })}
                  {" · "}{t("memberDetail.lastLogin", { date: data.user.last_login ? formatLongDate(data.user.last_login) : t("memberDetail.noRecord") })}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border p-2">
                <p className="text-lg font-bold tabular-nums">{data.open_issue_count}</p>
                <p className="text-2xs text-muted-foreground">{t("memberDetail.openIssues")}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-lg font-bold tabular-nums">{data.active_api_tokens}</p>
                <p className="text-2xs text-muted-foreground">{t("memberDetail.activeTokens")}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-lg font-bold">{data.has_personal_space ? t("memberDetail.yes") : t("memberDetail.no")}</p>
                <p className="text-2xs text-muted-foreground">{t("memberDetail.personalSpace")}</p>
              </div>
            </div>

            <Section title={t("workspaceSettings.projects.title")} count={data.projects.length}>
              {data.projects.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="w-12 shrink-0 font-mono text-2xs text-muted-foreground">{p.identifier}</span>
                  <span className="truncate">{p.name}</span>
                  {p.visibility === "private" && <span className="text-2xs text-muted-foreground">{t("workspaceSettings.projects.private")}</span>}
                  {p.trashed && <span className="text-2xs text-muted-foreground">{t("memberDetail.trash")}</span>}
                  <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                    {p.is_lead && <span className="font-semibold text-primary mr-1">{t("workspaceSettings.projects.lead")}</span>}
                    {PROJECT_ROLE_KEY[p.role] ? t(PROJECT_ROLE_KEY[p.role]) : p.role}
                  </span>
                </div>
              ))}
            </Section>

            <Section title={t("memberDetail.spaces")} count={data.spaces.length}>
              {data.spaces.map((s) => (
                <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="truncate">{s.name}</span>
                  {s.is_private && <span className="text-2xs text-muted-foreground">{t("workspaceSettings.projects.private")}</span>}
                  <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{SPACE_ROLE_KEY[s.role] ? t(SPACE_ROLE_KEY[s.role]) : s.role}</span>
                </div>
              ))}
            </Section>

            <Section title={t("sidebar.teams")} count={data.teams.length}>
              {data.teams.map((tm) => (
                <div key={tm.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="truncate">{tm.name}</span>
                  {tm.title && <span className="text-2xs text-muted-foreground">{tm.title}</span>}
                  <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{TEAM_ROLE_KEY[tm.role] ? t(TEAM_ROLE_KEY[tm.role]) : tm.role}</span>
                </div>
              ))}
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
