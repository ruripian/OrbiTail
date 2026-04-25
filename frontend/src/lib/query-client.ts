import { QueryClient } from "@tanstack/react-query";

/**
 * 전역 React Query 클라이언트.
 *
 * authStore의 setAuth/clearAuth 가 사용자 전환 시 cache.clear() 를 호출해야 하므로
 * main.tsx와 authStore 양쪽에서 동일 인스턴스를 import 할 수 있게 별도 모듈로 분리.
 *
 * staleTime 60s — 같은 데이터를 짧은 시간 내 여러 화면에서 다시 받지 않게.
 *                 사용자 전환 시에는 cache 자체가 비워지므로 stale 데이터가 새 사용자에게 노출되지 않음.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60, retry: 1 },
  },
});
