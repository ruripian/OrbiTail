import { NavLink, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { UsersRound, UserCheck, Building2, Settings, Archive, KeyRound, Webhook, FolderLock, FolderKanban, Users, History, HardDrive } from "lucide-react";
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
              {pendingRequests.length > 0 && (
                <span className="inline-flex items-center justify-center text-2xs font-bold rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 h-4 min-w-[16px] px-1.5">
                  {pendingRequests.length}
                </span>
              )}
            </NavLink>

            {/* 프로젝트 — 비공개 포함 전체. 이슈 내용 없이 멤버·리드·보관·휴지통만 */}
            <NavLink
              to={`${base}/projects`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <FolderKanban className="h-4 w-4 shrink-0" />
              {t("workspaceSettings.projects.title")}
            </NavLink>

            {/* 문서 스페이스 — 비공개 포함 전체 공용 스페이스 관리. 문서 화면에서는 관리자에게도 숨긴다 */}
            <NavLink
              to={`${base}/spaces`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <FolderLock className="h-4 w-4 shrink-0" />
              {t("memberDetail.spaces")}
            </NavLink>

            {/* 팀 — 전체 팀 목록과 삭제 */}
            <NavLink
              to={`${base}/teams`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <Users className="h-4 w-4 shrink-0" />
              {t("sidebar.teams")}
            </NavLink>

            {/* 웹훅 — 워크스페이스의 일을 밖으로 내보내는 설정이라 관리자 전용 */}
            <NavLink
              to={`${base}/webhooks`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <Webhook className="h-4 w-4 shrink-0" />
              {t("settings.layout.workspaceWebhooks")}
            </NavLink>

            {/* 활동 기록 — 관리 동작 기록. 비공개에 자신을 추가한 기록도 여기 남는다 */}
            <NavLink
              to={`${base}/activity`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <History className="h-4 w-4 shrink-0" />
              {t("workspaceSettings.activity.title")}
            </NavLink>

            {/* 사용량 — 규모·첨부 용량·주인 없는 개인 스페이스 */}
            <NavLink
              to={`${base}/usage`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <HardDrive className="h-4 w-4 shrink-0" />
              {t("workspaceSettings.usage.title")}
            </NavLink>
          </>
        )}

        {/* 보관함 — 사이드바에서 빠진 후 ws 설정으로 이전.
            관리 권한 무관하게 모든 ws 멤버가 보관된 프로젝트 조회 가능. */}
        <NavLink
          to={`${base}/archived`}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              isActive
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )
          }
        >
          <Archive className="h-4 w-4 shrink-0" />
          {t("settings.layout.workspaceArchived", "보관함")}
        </NavLink>

        {/* API 토큰 — 토큰은 만든 사람의 권한으로 동작하므로 모든 멤버가 자기 토큰을 관리한다.
            관리자는 같은 화면에서 워크스페이스 전체 토큰을 본다. */}
        <NavLink
          to={`${base}/api-tokens`}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              isActive
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )
          }
        >
          <KeyRound className="h-4 w-4 shrink-0" />
          {t("settings.layout.workspaceApiTokens")}
        </NavLink>

      </aside>

      <main className="flex-1 p-8 max-w-regular min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
