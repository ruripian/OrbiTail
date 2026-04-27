import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { projectsApi } from "@/api/projects";
import type { Project, ProjectFeatureKey } from "@/types";

/**
 * 프로젝트의 기능 on/off 상태를 조회하는 훅.
 *
 * 정책:
 *  - `project.features[key]` 가 명시적으로 `false` 일 때만 비활성.
 *  - 키가 없거나 `true` 면 활성 — 기존 프로젝트(features={}) 호환.
 *  - core 뷰(`table`/`archive`/`trash`) 는 항상 활성이라 이 훅 범위 밖.
 *
 * 사용:
 *   const { isEnabled } = useProjectFeatures();
 *   if (isEnabled("board")) { ... }
 */
export function useProjectFeatures(projectIdOverride?: string) {
  const { workspaceSlug, projectId: urlProjectId } = useParams<{
    workspaceSlug: string;
    projectId: string;
  }>();
  const projectId = projectIdOverride ?? urlProjectId;

  const { data: project } = useQuery<Project>({
    queryKey: ["project", workspaceSlug, projectId],
    queryFn: () => projectsApi.get(workspaceSlug!, projectId!),
    enabled: !!workspaceSlug && !!projectId,
    staleTime: 30_000,
  });

  const features = (project?.features ?? {}) as Partial<Record<ProjectFeatureKey, boolean>>;

  const isEnabled = (key: ProjectFeatureKey): boolean => features[key] !== false;

  return { project, features, isEnabled };
}
