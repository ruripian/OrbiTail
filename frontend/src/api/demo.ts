import { api } from "@/lib/axios";
import type { User } from "@/types";

export interface DemoStatusResponse {
  /** 이 배포가 공개 데모인지 */
  enabled: boolean;
  /** 샌드박스 유지 시간. 데모가 아니면 null */
  ttl_hours: number | null;
}

export interface DemoSessionResponse {
  access: string;
  refresh: string;
  user: User;
  /** 이 샌드박스가 삭제되는 시각 (ISO8601) */
  expires_at: string;
}

export const demoApi = {
  /** 데모 배포 여부 조회 — 인증 불필요 */
  getStatus: () => api.get<DemoStatusResponse>("/demo/status/").then((r) => r.data),

  /** 격리된 샌드박스를 만들고 그 방문자 계정의 토큰을 받는다 */
  createSession: () =>
    api.post<DemoSessionResponse>("/demo/session/").then((r) => r.data),
};
