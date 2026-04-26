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
    api.post("/auth/verify-email/", data).then((r) => r.data),

  requestPasswordReset: (data: { email: string }) =>
    api.post("/auth/password-reset/", data).then((r) => r.data),

  confirmPasswordReset: (data: { token: string; new_password: string }) =>
    api.post("/auth/password-reset/confirm/", data).then((r) => r.data),
};
