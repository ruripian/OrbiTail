import { api } from "@/lib/axios";
import type { AdminUser, AuditLog, PaginatedResponse, Workspace } from "@/types";

export type UserStatusFilter = "pending" | "approved" | "suspended" | "superusers";

/**
 * 관리자 API — 사용자 / 워크스페이스 / 감사 로그.
 * 응답이 `PaginatedResponse<T>`인 엔드포인트는 `.results`만 반환.
 */
export const adminApi = {
  /* ─── 사용자 ─── */
  listUsers: (params?: { status?: UserStatusFilter; search?: string }) =>
    api
      .get<PaginatedResponse<AdminUser>>("/auth/admin/users/", { params })
      .then((r) => r.data.results),

  approveUser: (userId: string) =>
    api.post<{ detail: string }>(`/auth/admin/users/${userId}/approve/`).then((r) => r.data),

  /** 슈퍼유저 권한 부여/회수 */
  toggleSuperuser: (userId: string, is_superuser: boolean) =>
    api
      .patch<AdminUser>(`/auth/admin/users/${userId}/superuser/`, { is_superuser })
      .then((r) => r.data),

  /** 계정 일시 정지/해제 */
  suspendUser: (userId: string, is_suspended: boolean) =>
    api
      .patch<AdminUser>(`/auth/admin/users/${userId}/suspend/`, { is_suspended })
      .then((r) => r.data),

  /** 계정 영구 삭제 */
  deleteUser: (userId: string) => api.delete(`/auth/admin/users/${userId}/`),

  /* ─── 워크스페이스 ─── */
  listWorkspaces: (search?: string) =>
    api
      .get<PaginatedResponse<Workspace>>("/workspaces/admin/all/", {
        params: search ? { search } : undefined,
      })
      .then((r) => r.data.results),

  createWorkspace: (data: { name: string; slug: string; owner_id: string }) =>
    api.post<Workspace>("/workspaces/admin/create/", data).then((r) => r.data),

  deleteWorkspace: (slug: string) => api.delete(`/workspaces/admin/${slug}/`),

  transferWorkspaceOwner: (slug: string, owner_id: string) =>
    api
      .patch<Workspace>(`/workspaces/admin/${slug}/owner/`, { owner_id })
      .then((r) => r.data),

  /* ─── 감사 로그 ─── */
  listAudit: (params?: { action?: string; target_type?: string; actor?: string }) =>
    api
      .get<PaginatedResponse<AuditLog>>("/admin/audit/", { params })
      .then((r) => r.data.results),
};
