import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "@/api/issues";
import type { Issue } from "@/types";

/**
 * useParentChain — 이슈의 상위 조상 체인을 순차 fetch하여 반환
 *
 * 반환 배열 순서: [root, ..., grandparent, parent]
 * - 현재 이슈는 포함하지 않음
 * - parent가 없으면 빈 배열
 *
 * React Query 캐시(`["issue", id]`)를 재사용하므로, 이미 방문한 부모는 즉시 반환됨
 *
 * 사용:
 *   const chain = useParentChain(workspaceSlug, projectId, issue.parent);
 */
/** 부모가 없을 때 돌려줄 고정 참조 — 매번 새 [] 를 만들면 소비하는 쪽 deps 가 흔들린다. */
const EMPTY_CHAIN: Issue[] = [];

export function useParentChain(
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  startParentId: string | null | undefined,
): Issue[] {
  const qc = useQueryClient();
  const [chain, setChain] = useState<Issue[]>(EMPTY_CHAIN);
  const enabled = !!workspaceSlug && !!projectId && !!startParentId;

  useEffect(() => {
    /* 조회할 게 없으면 아무것도 하지 않는다 — 빈 상태는 아래 반환에서 처리해
       effect 가 "fetch 결과를 담는다" 한 가지 일만 하게 한다. */
    if (!enabled) return;

    let cancelled = false;
    const visited = new Set<string>(); // 순환 참조 방어
    const result: Issue[] = [];

    (async () => {
      let pid: string | null = startParentId;
      while (pid && !visited.has(pid)) {
        visited.add(pid);
        try {
          const parent: Issue = await qc.fetchQuery({
            queryKey: ["issue", pid],
            queryFn:  () => issuesApi.get(workspaceSlug, projectId, pid!),
          });
          if (cancelled) return;
          result.unshift(parent);
          pid = parent.parent;
        } catch {
          break;
        }
      }
      if (!cancelled) setChain(result);
    })();

    return () => { cancelled = true; };
  }, [enabled, workspaceSlug, projectId, startParentId, qc]);

  return enabled ? chain : EMPTY_CHAIN;
}
