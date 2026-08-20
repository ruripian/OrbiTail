import axios from "axios";

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

export interface DemoSessionCheck {
  /** 서버가 판정한 결과 — 지금도 살아 있는 데모 세션인가 */
  valid: boolean;
  expires_at?: string;
}

export const demoApi = {
  /** 데모 배포 여부 조회 — 인증 불필요 */
  getStatus: () => api.get<DemoStatusResponse>("/demo/status/").then((r) => r.data),

  /** 격리된 샌드박스를 만들고 그 방문자 계정의 토큰을 받는다 */
  createSession: () =>
    api.post<DemoSessionResponse>("/demo/session/").then((r) => r.data),

  /** 들고 있는 토큰이 아직 유효한 데모 세션인지 서버에 묻는다.
   *
   *  lib/axios 의 api 인스턴스를 쓰지 않고 맨 axios 로 호출한다. 그 인스턴스는
   *  401 을 받으면 refresh 를 시도하고 실패 시 /auth/login 으로 강제 이동시키는데,
   *  여기서는 401 이 "세션 없음" 이라는 정상적인 답이라 그 처리가 방해가 된다.
   */
  checkSession: async (): Promise<DemoSessionCheck> => {
    const token = localStorage.getItem("access_token");
    if (!token) return { valid: false };
    try {
      const { data } = await axios.get<DemoSessionCheck>("/api/demo/session/check/", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return data;
    } catch {
      /* 401(만료·삭제된 계정) 포함 — 어떤 실패든 세션이 없는 것으로 본다 */
      return { valid: false };
    }
  },
};
