import { useQuery } from "@tanstack/react-query";

import { workspacesApi } from "@/api/workspaces";
import { useAuthStore } from "@/stores/authStore";

/** 워크스페이스 관리 화면 공통 판정 — ADMIN(20) 이상 또는 슈퍼유저. 서버도 같은 기준으로 막는다. */
export function useWorkspaceAdmin(workspaceSlug: string) {
  const user = useAuthStore((s) => s.user);
  const { data: wsMembers = [], isLoading } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug),
    enabled: !!workspaceSlug,
  });
  const isAdmin = (wsMembers.find((m) => m.member.id === user?.id)?.role ?? 0) >= 20 || !!user?.is_superuser;
  return { isAdmin, isLoading, wsMembers, user };
}
