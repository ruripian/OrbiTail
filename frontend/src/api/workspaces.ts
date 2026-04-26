import { api } from "@/lib/axios";
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceInvitation,
  InvitationInfo,
  PaginatedResponse,
} from "@/types";

export const workspacesApi = {
  list: () =>
    api.get<PaginatedResponse<Workspace>>("/workspaces/").then((r) => r.data?.results ?? []),

  /** 공개 워크스페이스 목록 — 비로그인 회원가입 폼용 (인증 불필요) */
  publicList: () =>
    api.get<Workspace[]>("/workspaces/public/").then((r) => r.data ?? []),

  /** 초대 없이 가입할 수 있는 워크스페이스 후보 (현재 멤버가 아닌 것) */
  joinable: () =>
    api.get<PaginatedResponse<Workspace>>("/workspaces/joinable/").then((r) => r.data?.results ?? []),

  /** 가입 신청 관련 — 사용자 측 */
  joinRequests: {
    /** 워크스페이스에 가입 신청 (PENDING 생성) — 이미 멤버면 already_member=true 응답 */
    create: (slug: string, message?: string) =>
      api.post<any>(`/workspaces/${slug}/join-request/`, message ? { message } : {}).then((r) => r.data),

    /** 내가 보낸 신청 목록 (모든 상태) */
    listMine: () =>
      api.get<PaginatedResponse<any>>(`/workspaces/join-requests/mine/`).then((r) => r.data?.results ?? []),

    /** 내 PENDING 신청 취소 */
    cancel: (requestId: string) =>
      api.post(`/workspaces/join-requests/${requestId}/cancel/`).then((r) => r.data),
  },

  /** 가입 신청 관련 — 워크스페이스 어드민 측 */
  joinRequestsAdmin: {
    list: (slug: string, statusFilter: "pending" | "all" = "pending") =>
      api.get<PaginatedResponse<any>>(`/workspaces/${slug}/join-requests/?status=${statusFilter}`).then((r) => r.data?.results ?? []),
    decide: (slug: string, requestId: string, action: "approve" | "reject") =>
      api.post(`/workspaces/${slug}/join-requests/${requestId}/decision/`, { action }).then((r) => r.data),
  },

  create: (data: { name: string; slug: string }) =>
    api.post<Workspace>("/workspaces/", data).then((r) => r.data),

  get: (slug: string) =>
    api.get<Workspace>(`/workspaces/${slug}/`).then((r) => r.data),

  update: (slug: string, data: Partial<Workspace>) =>
    api.patch<Workspace>(`/workspaces/${slug}/`, data).then((r) => r.data),

  delete: (slug: string) => api.delete(`/workspaces/${slug}/`),

  members: (slug: string) =>
    api.get<PaginatedResponse<WorkspaceMember>>(`/workspaces/${slug}/members/`).then((r) => r.data.results),

  /** 워크스페이스 멤버 관리 */
  memberOps: {
    /** 멤버 역할 변경 — Owner로 승격하면 소유자 이전 (기존 Owner는 Admin으로 강등) */
    updateRole: (slug: string, memberId: string, role: number) =>
      api.patch<WorkspaceMember>(`/workspaces/${slug}/members/${memberId}/`, { role }).then((r) => r.data),

    /** 멤버 제거 — Owner는 Owner만 제거 가능, 마지막 Owner/본인 제거 불가 */
    remove: (slug: string, memberId: string) =>
      api.delete(`/workspaces/${slug}/members/${memberId}/`),
  },

  /** 초대 관련 API */
  invitations: {
    /** 워크스페이스 초대 목록 조회 */
    list: (slug: string) =>
      api.get<WorkspaceInvitation[]>(`/workspaces/${slug}/invitations/`).then((r) => r.data),

    /** 초대 발송 */
    create: (slug: string, data: { email: string; role: number; message?: string }) =>
      api.post<WorkspaceInvitation>(`/workspaces/${slug}/invitations/`, data).then((r) => r.data),

    /** 초대 취소 */
    revoke: (slug: string, invitationId: string) =>
      api.post(`/workspaces/${slug}/invitations/${invitationId}/revoke/`).then((r) => r.data),

    /** 토큰으로 초대 정보 조회 (비인증 가능) */
    getByToken: (token: string) =>
      api.get<InvitationInfo>(`/invitations/${token}/`).then((r) => r.data),

    /** 초대 수락 (로그인 필수) */
    accept: (token: string) =>
      api.post<{ detail: string; workspace_slug: string }>(`/invitations/${token}/accept/`).then((r) => r.data),
  },
};
