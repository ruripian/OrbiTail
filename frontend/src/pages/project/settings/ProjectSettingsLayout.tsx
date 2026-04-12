import { NavLink, Outlet, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Settings, Circle, Tag, Users, Archive, FileText, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "general",       tKey: "project.settings.tabs.general",       icon: Settings },
  { to: "members",       tKey: "project.settings.tabs.members",       icon: Users },
  { to: "states",        tKey: "project.settings.tabs.states",        icon: Circle },
  { to: "labels",        tKey: "project.settings.tabs.labels",        icon: Tag },
  { to: "templates",     tKey: "project.settings.tabs.templates",     icon: FileText },
  { to: "auto-archive",  tKey: "project.settings.tabs.autoArchive",   icon: Archive },
  { to: "notifications", tKey: "project.settings.tabs.notifications", icon: Bell },
];

export function ProjectSettingsLayout() {
  const { workspaceSlug, projectId } = useParams<{
    workspaceSlug: string;
    projectId: string;
  }>();
  const { t } = useTranslation();
  const base = `/${workspaceSlug}/projects/${projectId}/settings`;

  return (
    <div className="flex h-full">
      {/* 프로젝트 설정 탭 사이드바 */}
      <aside className="w-52 shrink-0 border-r bg-background p-4 space-y-1">
        <p className="px-2 mb-3 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("project.settings.sidebarTitle")}
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
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t(tKey)}
          </NavLink>
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto p-6 sm:p-8">
        <Outlet />
      </main>
    </div>
  );
}
