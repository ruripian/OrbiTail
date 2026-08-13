import { api } from "@/lib/axios";
import type {
  AdminAttachmentRow,
  AdminOverview,
  AdminUser,
  AuditLog,
  PaginatedResponse,
  Workspace,
} from "@/types";

export type UserStatusFilter = "pending" | "approved" | "suspended" | "superusers";

/**
 * 관리자 API — 사용자 / 워크스페이스 / 감사 로그.
 */
export const adminApi = {
  /* ─── 개요 ─── */
  overview: () => api.get<AdminOverview>("/admin/overview/").then((r) => r.data),

  /* ─── 사용자 ─── */
  listUsers: (params?: { status?: UserStatusFilter; search?: string; page?: number }) =>
    api
      .get<PaginatedResponse<AdminUser>>("/auth/admin/users/", { params })
      .then((r) => r.data),

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
  listWorkspaces: (params?: Record<string, string | number | undefined>) =>
    api
      .get<PaginatedResponse<Workspace>>("/workspaces/admin/all/", { params })
      .then((r) => r.data),

  createWorkspace: (data: { name: string; slug: string; owner_id: string }) =>
    api.post<Workspace>("/workspaces/admin/create/", data).then((r) => r.data),

  deleteWorkspace: (slug: string) => api.delete(`/workspaces/admin/${slug}/`),

  transferWorkspaceOwner: (slug: string, owner_id: string) =>
    api
      .patch<Workspace>(`/workspaces/admin/${slug}/owner/`, { owner_id })
      .then((r) => r.data),

  /* ─── 콘텐츠 탐색기 ───
     문서/이슈 첨부는 모델이 달라 엔드포인트를 나누되 응답 형태는 동일하게 정규화된다. */
  content: {
    documentAttachments: (params?: Record<string, string | number | undefined>) =>
      api
        .get<PaginatedResponse<AdminAttachmentRow>>("/admin/content/document-attachments/", { params })
        .then((r) => r.data),

    issueAttachments: (params?: Record<string, string | number | undefined>) =>
      api
        .get<PaginatedResponse<AdminAttachmentRow>>("/admin/content/issue-attachments/", { params })
        .then((r) => r.data),
  },

  /* ─── 감사 로그 ───
     파라미터는 AdminResourceListView 규격(search / ordering / page / page_size / filter_spec)을
     그대로 통과시키므로 개별 나열하지 않는다. */
  listAudit: (params?: Record<string, string | number | undefined>) =>
    api
      .get<PaginatedResponse<AuditLog>>("/admin/audit/", { params })
      .then((r) => r.data),
};
