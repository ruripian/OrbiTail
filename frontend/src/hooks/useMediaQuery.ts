import { useCallback, useSyncExternalStore } from "react";

/**
 * 미디어 쿼리 훅 — 반응형 분기에 사용
 *
 * matchMedia 는 React 밖의 상태라 useSyncExternalStore 로 구독한다.
 * state + effect 조합으로 흉내내면 첫 렌더 직후 setState 가 한 번 더 돌아
 * 불필요한 재렌더가 생긴다.
 *
 * @param query CSS 미디어 쿼리 문자열 (예: "(min-width: 1024px)")
 * @returns 현재 뷰포트가 쿼리에 매칭되는지 여부
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false, // 서버 렌더 시엔 매칭 안 됨으로 간주
  );
}

/** lg 브레이크포인트 (1024px) 이상인지 — 사이드바 표시 기준 */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
