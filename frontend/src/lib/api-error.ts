import axios from "axios";

/**
 * API 실패 응답에서 사용자에게 보여줄 메시지를 꺼낸다.
 *
 * DRF 가 내는 두 형태를 모두 받는다:
 *   1. `{ detail: "..." }`            — 권한/404 등 일반 실패
 *   2. `{ slug: ["이미 사용 중"] }`    — serializer 필드 검증 실패
 * 둘 다 아니거나(네트워크 오류 등) 응답이 없으면 호출부가 준 fallback 을 쓴다.
 *
 * 쓰는 곳: react-query mutation 의 onError — `onError: (e) => toast.error(apiErrorMessage(e, t("...")))`
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (!axios.isAxiosError(e)) return fallback;
  const data = e.response?.data;
  if (!data || typeof data !== "object") return fallback;

  const rec = data as Record<string, unknown>;
  if (typeof rec.detail === "string" && rec.detail) return rec.detail;

  for (const v of Object.values(rec)) {
    if (Array.isArray(v) && typeof v[0] === "string" && v[0]) return v[0];
  }
  return fallback;
}

/** HTTP 상태 코드가 필요할 때 (413 용량 초과처럼 코드별로 다르게 안내하는 경우). */
export function apiErrorStatus(e: unknown): number | undefined {
  return axios.isAxiosError(e) ? e.response?.status : undefined;
}
