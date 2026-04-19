import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { projectsApi } from "@/api/projects";
import type { SavedFilter } from "@/types";

/**
 * 저장된 필터 프리셋 — 백엔드 DB 기반 (디바이스 간 동기화)
 *
 * 사용 패턴:
 *   const { presets, saveFilter, deleteFilter, toFilters } = useSavedFilters(projectId);
 */

export interface FilterPreset {
  id: string;
  name: string;
  states: string[];
  priorities: string[];
  assignees: string[];
  labels: string[];
}

interface Filters {
  states: Set<string>;
  priorities: Set<string>;
  assignees: Set<string>;
  labels: Set<string>;
}

export function useSavedFilters(projectId: string) {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const qc = useQueryClient();
  const queryKey = ["saved-filters", workspaceSlug, projectId];

  const { data: rawPresets = [] } = useQuery({
    queryKey,
    queryFn: () => projectsApi.savedFilters.list(workspaceSlug!, projectId),
    enabled: !!workspaceSlug && !!projectId,
  });

  // 백엔드 SavedFilter → 프론트 FilterPreset 변환
  const presets: FilterPreset[] = rawPresets.map((sf) => ({
    id: sf.id,
    name: sf.name,
    states: sf.filters.states ?? [],
    priorities: sf.filters.priorities ?? [],
    assignees: sf.filters.assignees ?? [],
    labels: sf.filters.labels ?? [],
  }));

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; filters: Record<string, string[]> }) =>
      projectsApi.savedFilters.create(workspaceSlug!, projectId, data),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (filterId: string) =>
      projectsApi.savedFilters.delete(workspaceSlug!, projectId, filterId),
    onSuccess: invalidate,
  });

  const saveFilter = useCallback((name: string, filters: Filters) => {
    createMutation.mutate({
      name,
      filters: {
        states: Array.from(filters.states),
        priorities: Array.from(filters.priorities),
        assignees: Array.from(filters.assignees),
        labels: Array.from(filters.labels),
      },
    });
  }, [createMutation]);

  const deleteFilter = useCallback((presetId: string) => {
    deleteMutation.mutate(presetId);
  }, [deleteMutation]);

  const toFilters = useCallback((preset: FilterPreset): Filters => ({
    states: new Set(preset.states),
    priorities: new Set(preset.priorities),
    assignees: new Set(preset.assignees),
    labels: new Set(preset.labels),
  }), []);

  return { presets, saveFilter, deleteFilter, toFilters };
}
