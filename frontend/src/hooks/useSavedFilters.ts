import { useState, useCallback, useEffect } from "react";

/**
 * 커스텀 필터 프리셋 저장 훅 (localStorage 기반)
 *
 * 프로젝트별로 필터 프리셋을 저장/불러오기/삭제할 수 있음
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

const STORAGE_KEY = "orbitail_saved_filters";

function loadAll(): Record<string, FilterPreset[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveAll(data: Record<string, FilterPreset[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function useSavedFilters(projectId: string) {
  const [presets, setPresets] = useState<FilterPreset[]>([]);

  // 초기 로드
  useEffect(() => {
    const all = loadAll();
    setPresets(all[projectId] ?? []);
  }, [projectId]);

  // 저장
  const saveFilter = useCallback((name: string, filters: Filters) => {
    const preset: FilterPreset = {
      id: crypto.randomUUID(),
      name,
      states: Array.from(filters.states),
      priorities: Array.from(filters.priorities),
      assignees: Array.from(filters.assignees),
      labels: Array.from(filters.labels),
    };
    const all = loadAll();
    const list = [...(all[projectId] ?? []), preset];
    all[projectId] = list;
    saveAll(all);
    setPresets(list);
    return preset;
  }, [projectId]);

  // 삭제
  const deleteFilter = useCallback((presetId: string) => {
    const all = loadAll();
    const list = (all[projectId] ?? []).filter((p) => p.id !== presetId);
    all[projectId] = list;
    saveAll(all);
    setPresets(list);
  }, [projectId]);

  // 프리셋 → Filters 변환 헬퍼
  const toFilters = useCallback((preset: FilterPreset): Filters => ({
    states: new Set(preset.states),
    priorities: new Set(preset.priorities),
    assignees: new Set(preset.assignees),
    labels: new Set(preset.labels),
  }), []);

  return { presets, saveFilter, deleteFilter, toFilters };
}
