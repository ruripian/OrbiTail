import { NavLink, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { UsersRound, UserCheck, Building2, Settings } from "lucide-react";
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
  // 이 워크스페이스의 실제 Admin(20) 이상만 관리 메뉴 노출.
  // 슈퍼유저(시스템 관리자)는 별개 영역 — 워크스페이스 운영 알림/메뉴와 섞이지 않게 자동 노출 제외.
  const canManageWorkspace = myRole >= 20;

  /* 가입 승인 — pending 카운트 뱃지 */
  const { data: pendingRequests = [] } = useQuery({
    queryKey: ["workspace-join-requests", workspaceSlug, "pending"],
    queryFn: () => workspacesApi.joinRequestsAdmin.list(workspaceSlug!, "pending"),
    enabled: !!workspaceSlug && canManageWorkspace,
    refetchInterval: 30000,
  });

  /* 헤더 표시용 워크스페이스 이름 */
  const { data: workspace } = useQuery({
    queryKey: ["workspace", workspaceSlug],
    queryFn: () => workspacesApi.get(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  return (
    <div className="flex h-full overflow-y-auto">
      <aside className="w-56 shrink-0 border-r bg-background p-4 space-y-1 flex flex-col sticky top-0 self-start max-h-full">
        {/* 헤더 — "워크스페이스 관리자" 라벨로 시스템 관리자(/admin) 와 시각적으로 구분 */}
        <div className="px-2 mb-4 pb-3 border-b">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400">
            <Building2 className="h-3 w-3" />
            {t("settings.layout.workspaceAdmin", "워크스페이스 관리")}
          </div>
          {workspace && (
            <p className="mt-1 text-sm font-bold truncate" title={workspace.name}>
              {workspace.name}
            </p>
          )}
        </div>
        {canManageWorkspace && (
          <>
            <NavLink
              to={`${base}/general`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <Settings className="h-4 w-4 shrink-0" />
              {t("settings.layout.workspaceGeneral", "일반")}
            </NavLink>

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

            <NavLink
              to={`${base}/join-requests`}
              className={({ isActive }) =>
                cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <span className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 shrink-0" />
                {t("settings.layout.workspaceJoinRequests", "가입 승인")}
              </span>
              {(pendingRequests as any[]).length > 0 && (
                <span className="inline-flex items-center justify-center text-2xs font-bold rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 h-4 min-w-[16px] px-1.5">
                  {(pendingRequests as any[]).length}
                </span>
              )}
            </NavLink>
          </>
        )}

      </aside>

      <main className="flex-1 p-8 max-w-2xl min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
