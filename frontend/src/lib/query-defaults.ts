/**
 * React Query 캐시 정책 tier (PASS7-1).
 *
 * useQuery 호출 시 데이터 성격에 맞는 tier 를 spread 로 적용:
 *   useQuery({ queryKey, queryFn, ...QUERY_TIERS.meta })
 *
 * 기본값은 query-client.ts 의 staleTime: 60s — list 와 meta 사이의 절충값.
 * 명시적으로 다른 캐시 행동이 필요한 곳에서만 tier 를 override.
 */
export const QUERY_TIERS = {
  /** 거의 안 바뀌는 메타데이터 — states/labels/members/categories/sprints. */
  meta: { staleTime: 5 * 60_000, gcTime: 30 * 60_000 },

  /** 자주 바뀌는 리스트 — issues/comments/links. 기본값과 가까움. */
  list: { staleTime: 30_000, gcTime: 5 * 60_000 },

  /** 실시간성 필요 — notifications/activity/cursors. */
  realtime: { staleTime: 0, gcTime: 60_000 },
} as const;
