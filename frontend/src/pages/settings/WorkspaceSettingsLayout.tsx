import { NavLink, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { UsersRound, ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { workspacesApi } from "@/api/workspaces";
import { cn } from "@/lib/utils";

/** WorkspaceSettingsLayout — 워크스페이스 설정 전용 패널.
 *  계정 설정과 분리된 별도 사이드바를 가진 layout.
 *  현재는 멤버 관리만 있고, 추후 brand color / integrations 등 확장 예정. */
export function WorkspaceSettingsLayout() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const base = `/${workspaceSlug}/workspace-settings`;
  const user = useAuthStore((s) => s.user);

  /* Admin 이상만 워크스페이스 멤버 관리 가능 */
  const { data: wsMembers = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const myRole = wsMembers.find((m) => m.member.id === user?.id)?.role ?? 0;
  const canManageWorkspace = myRole >= 20 || user?.is_workspace_admin || user?.is_superuser;

  return (
    <div className="flex h-full">
      <aside className="w-52 shrink-0 border-r bg-background p-4 space-y-1 flex flex-col">
        <p className="px-2 mb-3 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("settings.layout.workspace", "워크스페이스")}
        </p>
        {canManageWorkspace && (
          <NavLink
            to={`${base}/members`}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )
            }
          >
            <UsersRound className="h-4 w-4 shrink-0" />
            {t("settings.layout.workspaceMembers")}
          </NavLink>
        )}

        {(user?.is_workspace_admin || user?.is_superuser) && (
          <NavLink
            to={`/${workspaceSlug}/admin/users`}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ShieldAlert className="h-4 w-4 shrink-0" />
            {t("topbar.adminPanel", "관리자 패널")}
          </NavLink>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto p-8 max-w-2xl">
        <Outlet />
      </main>
    </div>
  );
}
