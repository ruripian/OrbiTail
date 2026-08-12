import { api } from "@/lib/axios";
import type { AuthTokens, User } from "@/types";

export const authApi = {
  register: (data: {
    email: string; display_name: string; password: string;
    first_name?: string; last_name?: string;
    invite_token?: string; workspace_slug?: string;
  }) =>
    api.post<{
      detail: string;
      email_verification_required: boolean;
      auto_activated?: boolean;
      /** 첫 사용자(관리자) 자동 생성 케이스 — 셀프 가입 안내와 구분하는 데 쓴다 */
      bootstrap_superuser?: boolean;
      requested_workspace?: string | null;
      workspace_slug?: string | null;
    }>("/auth/register/", data).then((r) => r.data),

  login: (data: { email: string; password: string }) =>
    api.post<AuthTokens>("/auth/login/", data).then((r) => r.data),

  logout: (refresh: string) =>
    api.post("/auth/logout/", { refresh }).then((r) => r.data),

  me: () => api.get<User>("/auth/me/").then((r) => r.data),

  updateMe: (data: Partial<User>) =>
    api.patch<User>("/auth/me/", data).then((r) => r.data),

  verifyEmail: (data: { token: string }) =>
    api.post<{
      detail?: string;
      /** 인증과 동시에 가입 신청이 자동 생성된 워크스페이스 slug (없으면 null) */
      auto_requested_workspace?: string | null;
    }>("/auth/verify-email/", data).then((r) => r.data),

  requestPasswordReset: (data: { email: string }) =>
    api.post("/auth/password-reset/", data).then((r) => r.data),

  confirmPasswordReset: (data: { token: string; new_password: string }) =>
    api.post("/auth/password-reset/confirm/", data).then((r) => r.data),
};
