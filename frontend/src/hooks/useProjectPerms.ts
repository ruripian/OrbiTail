import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { projectsApi } from "@/api/projects";
import { QUERY_TIERS } from "@/lib/query-defaults";
import type { ProjectMember } from "@/types";

interface EffectivePerms {
  can_edit: boolean;
  can_archive: boolean;
  can_delete: boolean;
  can_purge: boolean;
  can_schedule: boolean;
}

const NO_PERMS: EffectivePerms = {
  can_edit: false,
  can_archive: false,
  can_delete: false,
  can_purge: false,
  can_schedule: false,
};

/**
 * 현재 유저의 프로젝트 effective_perms를 반환.
 * members 쿼리를 공유하므로 이미 캐시되어 있으면 추가 요청 없음.
 *
 * 인자 우선 — 패널(마이페이지/문서/검색)에서 라우트 params 없이 이슈를 열 때
 * 호출부가 ws/project 를 직접 넘긴다. 미지정 시 라우트 params 사용.
 */
export function useProjectPerms(workspaceSlugArg?: string, projectIdArg?: string) {
  const params = useParams();
  const workspaceSlug = workspaceSlugArg ?? params.workspaceSlug;
  const projectId = projectIdArg ?? params.projectId;
  const user = useAuthStore((s) => s.user);

  const { data: members = [] } = useQuery<ProjectMember[]>({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug!, projectId!),
    enabled: !!workspaceSlug && !!projectId,
    ...QUERY_TIERS.meta,
  });

  const me = members.find((m) => m.member.id === user?.id);

  return {
    perms: me?.effective_perms ?? NO_PERMS,
    role: me?.role ?? null,
    isAdmin: (me?.role ?? 0) >= 20,
    isMember: !!me,
  };
}
