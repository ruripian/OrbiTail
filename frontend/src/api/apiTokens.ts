import { api } from "@/lib/axios";

export type ApiTokenScope = "read" | "write";

export interface ApiToken {
  id: string;
  name: string;
  /** 목록에서 알아보기 위한 앞부분 — 이것만으로는 인증할 수 없다 */
  prefix: string;
  scope: ApiTokenScope;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  owner: { id: string; display_name: string; email: string };
  status: "active" | "expired" | "revoked";
}

/** 발급 응답에만 원문 `token` 이 실린다. 다시 조회할 방법은 없다. */
export interface IssuedApiToken extends ApiToken {
  token: string;
}

export const apiTokensApi = {
  /** all=true 는 워크스페이스 관리자 전용 — 모든 멤버의 토큰 */
  list: (workspaceSlug: string, all = false) =>
    api.get<ApiToken[]>(`/workspaces/${workspaceSlug}/api-tokens/`, { params: all ? { all: "true" } : undefined })
      .then((r) => r.data),

  create: (workspaceSlug: string, data: { name: string; scope: ApiTokenScope; expires_in_days: 30 | 90 | 365 | null }) =>
    api.post<IssuedApiToken>(`/workspaces/${workspaceSlug}/api-tokens/`, data).then((r) => r.data),

  revoke: (workspaceSlug: string, id: string) =>
    api.delete(`/workspaces/${workspaceSlug}/api-tokens/${id}/`),
};
