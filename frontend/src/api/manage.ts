/**
 * 워크스페이스 설정의 관리 화면 API — 관리자 전용(backend apps/workspaces/admin_views.py).
 * 비공개 포함 전체를 다루지만 이슈·문서 내용은 오지 않는다.
 */
import { api } from "@/lib/axios";
import type { PaginatedResponse } from "@/types";

export interface ManageUser {
  id: string | null;
  display_name: string;
  email: string;
  avatar?: string | null;
}

export interface ManagedProject {
  id: string;
  name: string;
  identifier: string;
  visibility: "public" | "private";
  lead: ManageUser | null;
  member_count: number;
  issue_count: number;
  archived_at: string | null;
  deleted_at: string | null;
  i_am_member: boolean;
  created_at: string;
}

export interface ManagedProjectMember {
  user: ManageUser & { id: string };
  role: number;
}

export interface ManagedMemberDetail {
  user: ManageUser & { id: string; last_login: string | null; is_active: boolean; is_suspended: boolean };
  role: number;
  joined_at: string;
  projects: { id: string; name: string; identifier: string; role: number; is_lead: boolean; visibility: string; trashed: boolean }[];
  spaces: { id: string; name: string; role: number; is_private: boolean }[];
  teams: { id: string; name: string; role: number; title: string }[];
  open_issue_count: number;
  active_api_tokens: number;
  has_personal_space: boolean;
}

export interface ManagedTeam {
  id: string;
  name: string;
  description: string;
  member_count: number;
  admins: string[];
  created_by: ManageUser | null;
  created_at: string;
}

export interface WorkspaceActivityEntry {
  id: string;
  action: string;
  actor: ManageUser;
  target_type: string;
  target_id: string | null;
  target_label: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WorkspaceUsage {
  members: number;
  projects: number;
  projects_archived: number;
  projects_trashed: number;
  issues: number;
  issues_trashed: number;
  spaces: number;
  documents: number;
  documents_trashed: number;
  teams: number;
  storage: {
    issue_attachments: { count: number; bytes: number };
    document_attachments: { count: number; bytes: number };
  };
  orphan_personal_spaces: { id: string; name: string; owner_email: string | null; document_count: number; reason: string }[];
  can_delete_orphans: boolean;
}

const base = (slug: string) => `/workspaces/${slug}/manage`;

export const manageApi = {
  activity: (slug: string, params: { category?: string; page?: number }) =>
    api.get<PaginatedResponse<WorkspaceActivityEntry>>(`${base(slug)}/activity/`, { params }).then((r) => r.data),

  projects: {
    list: (slug: string) => api.get<ManagedProject[]>(`${base(slug)}/projects/`).then((r) => r.data),
    update: (slug: string, id: string, data: { lead?: string | null; archived?: boolean }) =>
      api.patch(`${base(slug)}/projects/${id}/`, data).then((r) => r.data),
    trash: (slug: string, id: string) => api.delete(`${base(slug)}/projects/${id}/`),
    members: {
      list: (slug: string, id: string) =>
        api.get<ManagedProjectMember[]>(`${base(slug)}/projects/${id}/members/`).then((r) => r.data),
      add: (slug: string, id: string, member: string, role: number) =>
        api.post(`${base(slug)}/projects/${id}/members/`, { member, role }).then((r) => r.data),
      setRole: (slug: string, id: string, member: string, role: number) =>
        api.patch(`${base(slug)}/projects/${id}/members/${member}/`, { role }).then((r) => r.data),
      remove: (slug: string, id: string, member: string) =>
        api.delete(`${base(slug)}/projects/${id}/members/${member}/`),
    },
  },

  member: (slug: string, userId: string) =>
    api.get<ManagedMemberDetail>(`${base(slug)}/members/${userId}/`).then((r) => r.data),

  teams: {
    list: (slug: string) => api.get<ManagedTeam[]>(`${base(slug)}/teams/`).then((r) => r.data),
    remove: (slug: string, id: string) => api.delete(`${base(slug)}/teams/${id}/`),
  },

  usage: (slug: string) => api.get<WorkspaceUsage>(`${base(slug)}/usage/`).then((r) => r.data),
};
