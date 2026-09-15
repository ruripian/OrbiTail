/**
 * 팀 설정 레이아웃 — /<ws>/teams/<teamId>/settings.
 *
 * 프로젝트/문서 스페이스 설정과 동일한 좌측 탭 구조(ProjectSettingsLayout).
 * 팀에는 워크플로/자동화에 해당하는 개념이 없어 탭은 일반·멤버 2개뿐이다.
 */
import { NavLink, Outlet, useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Settings, Users, ArrowLeft } from "lucide-react";
import { teamsApi } from "@/api/teams";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "general", tKey: "team.settings.tabs.general", icon: Settings },
  { to: "members", tKey: "team.settings.tabs.members", icon: Users },
];

export function TeamSettingsLayout() {
  const { workspaceSlug = "", teamId = "" } = useParams<{ workspaceSlug: string; teamId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const base = `/${workspaceSlug}/teams/${teamId}/settings`;

  const { data: team } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => teamsApi.get(workspaceSlug, teamId),
    enabled: !!workspaceSlug && !!teamId,
  });

  return (
    <div className="flex h-full overflow-y-auto">
      <aside className="w-52 shrink-0 border-r bg-background p-4 space-y-1 sticky top-0 self-start max-h-full">
        <button
          onClick={() => navigate(`/${workspaceSlug}/teams/${teamId}`)}
          className="flex items-center gap-1 px-2 mb-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="truncate">{team?.name ?? t("team.settings.sidebarTitle")}</span>
        </button>
        <p className="px-2 mb-3 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("team.settings.sidebarTitle")}
        </p>
        {TABS.map(({ to, tKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={`${base}/${to}`}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t(tKey)}
          </NavLink>
        ))}
      </aside>

      <main className="flex-1 p-6 sm:p-8 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
