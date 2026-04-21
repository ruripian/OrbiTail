import { api } from "@/lib/axios";
import type { User } from "@/types";

export interface UpdateProfilePayload {
  display_name?: string;
  first_name?: string;
  last_name?: string;
}

export interface UpdatePreferencesPayload {
  timezone?: string;
  language?: string;
  first_day_of_week?: number;
  theme?: "light" | "dark" | "system";
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

export const settingsApi = {
  /** 내 프로필/환경설정 조회 (GET /api/auth/me/) */
  getMe: () => api.get<User>("/auth/me/").then((r) => r.data),

  /** 프로필 정보 수정 (PATCH /api/auth/me/) */
  updateProfile: (data: UpdateProfilePayload) =>
    api.patch<User>("/auth/me/", data).then((r) => r.data),

  /** 환경설정 수정 (PATCH /api/auth/me/) */
  updatePreferences: (data: UpdatePreferencesPayload) =>
    api.patch<User>("/auth/me/", data).then((r) => r.data),

  /** 비밀번호 변경 (POST /api/auth/me/password/) */
  changePassword: (data: ChangePasswordPayload) =>
    api.post("/auth/me/password/", data).then((r) => r.data),

  /** 계정 탈퇴 — 비밀번호 재확인 후 소프트 삭제 (DELETE /api/auth/me/delete/) */
  deleteAccount: (password: string) =>
    api.delete<{ detail: string }>("/auth/me/delete/", { data: { password } }).then((r) => r.data),

  /** 프로필 사진 업로드 (PATCH multipart /api/auth/me/) */
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append("avatar", file);
    // Content-Type 헤더는 브라우저가 FormData boundary 와 함께 자동 설정하도록 맡김
    return api.patch<User>("/auth/me/", fd).then((r) => r.data);
  },

  /** 프로필 사진 삭제 */
  removeAvatar: () =>
    api.patch<User>("/auth/me/", { avatar: null }).then((r) => r.data),
};
