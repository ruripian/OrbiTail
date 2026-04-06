import { NavLink, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { User, Lock, SlidersHorizontal, Users, UsersRound, Github, ExternalLink } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { workspacesApi } from "@/api/workspaces";
import { cn } from "@/lib/utils";

export function SettingsLayout() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const base = `/${workspaceSlug}/settings`;
  const user = useAuthStore((s) => s.user);

  /* 현재 워크스페이스에서 사용자의 역할 확인 — Admin 이상만 워크스페이스 멤버 관리 링크 노출 */
  const { data: wsMembers = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const myRole = wsMembers.find((m) => m.member.id === user?.id)?.role ?? 0;
  const canManageWorkspace = myRole >= 20;

  // 설정 탭 목록 (t() 사용을 위해 컴포넌트 내부에 정의)
  const TABS = [
    { to: "profile",      label: t("settings.layout.profile"),      icon: User },
    { to: "preferences",  label: t("settings.layout.preferences"),  icon: SlidersHorizontal },
    { to: "security",     label: t("settings.layout.security"),     icon: Lock },
  ];

  return (
    <div className="flex h-full">
      {/* 설정 탭 사이드바 */}
      <aside className="w-52 shrink-0 border-r bg-background p-4 space-y-1 flex flex-col">
        <p className="px-2 mb-3 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("settings.layout.myAccount")}
        </p>
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={`${base}/${to}`}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}

        {canManageWorkspace && (
          <>
            <div className="pt-4 pb-2">
              <p className="px-2 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
                {t("settings.layout.workspace")}
              </p>
            </div>
            <NavLink
              to={`${base}/workspace-members`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )
              }
            >
              <UsersRound className="h-4 w-4 shrink-0" />
              {t("settings.layout.workspaceMembers")}
            </NavLink>
          </>
        )}

        {user?.is_staff && (
          <>
            <div className="pt-4 pb-2">
              <p className="px-2 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
                {t("settings.layout.admin")}
              </p>
            </div>
            <NavLink
              to={`${base}/users`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )
              }
            >
              <Users className="h-4 w-4 shrink-0" />
              {t("settings.layout.userManagement")}
            </NavLink>
          </>
        )}
        {/* 하단 — 프로젝트 링크 */}
        <div className="mt-auto pt-6 space-y-2">
          <p className="px-2 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("settings.layout.sponsor")}
          </p>
          <a
            href="https://github.com/ruripian/ouroboros"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Github className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{t("settings.layout.sponsorGithub")}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-40" />
          </a>
        </div>
      </aside>

      {/* 탭 컨텐츠 */}
      <main className="flex-1 overflow-y-auto p-8 max-w-2xl">
        <Outlet />
      </main>
    </div>
  );
}
