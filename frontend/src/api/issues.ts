import { api } from "@/lib/axios";
import type { Issue, IssueSearchResult, IssueComment, IssueActivity, IssueAttachment, IssueLink, IssueNodeLink, IssueTemplate, Label, IssueStats, PaginatedResponse } from "@/types";

export interface NodeGraphResponse {
  nodes: Array<{
    id: string;
    title: string;
    sequence_id: number;
    project_id: string | null;
    project_identifier: string | null;
    state_group: string | null;
    labels: Array<{ id: string; name: string; color: string }>;
    external?: boolean;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    link_type: string;
    note: string;
    label_id?: string;
    label_color?: string;
  }>;
}

interface IssueFilters {
  state?: string;
  priority?: string;
  assignees?: string;
  category?: string;
  sprint?: string;
  search?: string;
  ordering?: string;
  include_sub_issues?: string; // "true"면 하위 이슈 포함 (타임라인 계층 뷰용)
}

export const issuesApi = {
  list: (workspaceSlug: string, projectId: string, filters?: IssueFilters) =>
    api
      .get<Issue[]>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/`, { params: filters })
      .then((r) => r.data),

  create: (workspaceSlug: string, projectId: string, data: Partial<Issue>) =>
    api
      .post<Issue>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/`, data)
      .then((r) => r.data),

  get: (workspaceSlug: string, projectId: string, issueId: string) =>
    api
      .get<Issue>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/`)
      .then((r) => r.data),

  update: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<Issue>) =>
    api
      .patch<Issue>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/`, data)
      .then((r) => r.data),

  delete: (workspaceSlug: string, projectId: string, issueId: string) =>
    api.delete(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/`),

  restore: (workspaceSlug: string, projectId: string, issueId: string) =>
    api
      .post<Issue>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/restore/`)
      .then((r) => r.data),

  /** 삭제된 이슈 목록 (휴지통) */
  listDeleted: (workspaceSlug: string, projectId: string) =>
    api
      .get<PaginatedResponse<Issue>>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/trash/`)
      .then((r) => r.data.results),

  /** 이슈 영구 삭제 */
  hardDelete: (workspaceSlug: string, projectId: string, issueId: string) =>
    api.delete(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/hard-delete/`),

  /** 이슈 딥카피 (하위 이슈 포함 전체 복제) */
  duplicate: (workspaceSlug: string, projectId: string, issueId: string) =>
    api
      .post<Issue>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/duplicate/`)
      .then((r) => r.data),

  /** 보관된 이슈 목록 */
  listArchived: (workspaceSlug: string, projectId: string, filters?: Record<string, string>) =>
    api
      .get<PaginatedResponse<Issue>>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/archive/`, { params: filters })
      .then((r) => r.data.results),

  /** 이슈 보관 */
  archive: (workspaceSlug: string, projectId: string, issueId: string) =>
    api
      .post<Issue>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/archive/`)
      .then((r) => r.data),

  /** 보관된 이슈 복원 */
  unarchive: (workspaceSlug: string, projectId: string, issueId: string) =>
    api
      .delete<Issue>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/archive/`)
      .then((r) => r.data),

  subIssues: {
    list: (workspaceSlug: string, projectId: string, issueId: string) =>
      api
        .get<PaginatedResponse<Issue>>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/sub-issues/`)
        .then((r) => r.data.results),

    // 백엔드 IssueSerializer가 project를 필수로 요구하므로 항상 projectId를 포함해 전송
    create: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<Issue>) =>
      api
        .post<Issue>(
          `/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/sub-issues/`,
          { ...data, project: projectId }
        )
        .then((r) => r.data),
  },

  comments: {
    list: (workspaceSlug: string, projectId: string, issueId: string) =>
      api
        .get<PaginatedResponse<IssueComment>>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/comments/`)
        .then((r) => r.data.results),

    create: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<IssueComment>) =>
      api
        .post<IssueComment>(
          `/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/comments/`,
          data
        )
        .then((r) => r.data),

    delete: (workspaceSlug: string, projectId: string, issueId: string, commentId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/comments/${commentId}/`),
  },

  links: {
    list: (workspaceSlug: string, projectId: string, issueId: string) =>
      api
        .get<PaginatedResponse<IssueLink>>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/links/`)
        .then((r) => r.data.results),

    create: (workspaceSlug: string, projectId: string, issueId: string, data: { title: string; url: string }) =>
      api
        .post<IssueLink>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/links/`, data)
        .then((r) => r.data),

    delete: (workspaceSlug: string, projectId: string, issueId: string, linkId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/links/${linkId}/`),
  },

  /* 이슈 간 자유 링크(node) — 트리 경계 넘는 연결 */
  nodeLinks: {
    list: (workspaceSlug: string, projectId: string, issueId: string) =>
      api
        .get<PaginatedResponse<IssueNodeLink> | IssueNodeLink[]>(
          `/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/node-links/`,
        )
        .then((r) => (Array.isArray(r.data) ? r.data : r.data.results)),

    create: (
      workspaceSlug: string,
      projectId: string,
      issueId: string,
      data: { source: string; target: string; link_type?: string; note?: string },
    ) =>
      api
        .post<IssueNodeLink>(
          `/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/node-links/`,
          data,
        )
        .then((r) => r.data),

    delete: (workspaceSlug: string, linkId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/node-links/${linkId}/`),
  },

  /* 프로젝트 범위 그래프 — 기본. 같은 꼭지(프로젝트) 아래 이슈 관계망. */
  nodeGraph: (
    workspaceSlug: string,
    projectId: string,
    opts?: { includeLabelEdges?: boolean; manualOnly?: boolean },
  ) =>
    api
      .get<NodeGraphResponse>(
        `/workspaces/${workspaceSlug}/projects/${projectId}/node-graph/`,
        {
          params: {
            include_label_edges: opts?.includeLabelEdges === false ? "false" : "true",
            manual_only: opts?.manualOnly ? "true" : "false",
          },
        },
      )
      .then((r) => r.data),

  /* 워크스페이스 전체 그래프 — 선택적, 전체 오버뷰용. */
  nodeGraphAllWorkspace: (
    workspaceSlug: string,
    opts?: { includeLabelEdges?: boolean; manualOnly?: boolean },
  ) =>
    api
      .get<NodeGraphResponse>(`/workspaces/${workspaceSlug}/node-graph/`, {
        params: {
          include_label_edges: opts?.includeLabelEdges === false ? "false" : "true",
          manual_only: opts?.manualOnly ? "true" : "false",
        },
      })
      .then((r) => r.data),

  attachments: {
    list: (workspaceSlug: string, projectId: string, issueId: string) =>
      api
        .get<PaginatedResponse<IssueAttachment>>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/attachments/`)
        .then((r) => r.data.results),

    upload: (workspaceSlug: string, projectId: string, issueId: string, file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return api
        .post<IssueAttachment>(
          `/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/attachments/`,
          formData,
          { headers: { "Content-Type": "multipart/form-data" } }
        )
        .then((r) => r.data);
    },

    delete: (workspaceSlug: string, projectId: string, issueId: string, attachmentId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/attachments/${attachmentId}/`),
  },

  activities: (workspaceSlug: string, projectId: string, issueId: string) =>
    api
      .get<PaginatedResponse<IssueActivity>>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/activities/`)
      .then((r) => r.data.results),

  recentByWorkspace: (workspaceSlug: string) =>
    api
      .get<PaginatedResponse<Issue>>(`/workspaces/${workspaceSlug}/issues/recent/`)
      .then((r) => r.data.results),

  /** 이슈 일괄 업데이트 */
  bulkUpdate: (workspaceSlug: string, projectId: string, issueIds: string[], updates: Record<string, unknown>) =>
    api.patch(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/bulk/`, { issue_ids: issueIds, updates }).then((r) => r.data),

  /** 이슈 일괄 삭제 */
  bulkDelete: (workspaceSlug: string, projectId: string, issueIds: string[]) =>
    api.post(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/bulk-delete/`, { issue_ids: issueIds }).then((r) => r.data),

  /** 내가 배정된 이슈 — 워크스페이스 홈용 (완료/취소 제외) */
  myIssues: (workspaceSlug: string) =>
    api
      .get<PaginatedResponse<Issue>>(`/workspaces/${workspaceSlug}/issues/my/`)
      .then((r) => r.data.results),

  /** 프로젝트 이슈 통계 — 대시보드 차트용 */
  stats: (workspaceSlug: string, projectId: string) =>
    api
      .get<IssueStats>(`/workspaces/${workspaceSlug}/projects/${projectId}/issues/stats/`)
      .then((r) => r.data),

  /** 워크스페이스 전체 이슈 검색 — Cmd+K 전역 검색용
   *  고급 구문: priority, state_group, assignee 파라미터 지원 */
  searchByWorkspace: (workspaceSlug: string, search: string, params?: Record<string, string>) =>
    api
      .get<PaginatedResponse<IssueSearchResult>>(`/workspaces/${workspaceSlug}/issues/search/`, { params: { search, ...params } })
      .then((r) => r.data.results),

  labels: {
    list: (workspaceSlug: string, projectId: string) =>
      api
        .get<PaginatedResponse<Label>>(`/workspaces/${workspaceSlug}/projects/${projectId}/labels/`)
        .then((r) => r.data.results),

    create: (workspaceSlug: string, projectId: string, data: Partial<Label>) =>
      api
        .post<Label>(`/workspaces/${workspaceSlug}/projects/${projectId}/labels/`, data)
        .then((r) => r.data),

    update: (workspaceSlug: string, projectId: string, labelId: string, data: Partial<Label>) =>
      api
        .patch<Label>(`/workspaces/${workspaceSlug}/projects/${projectId}/labels/${labelId}/`, data)
        .then((r) => r.data),

    delete: (workspaceSlug: string, projectId: string, labelId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/projects/${projectId}/labels/${labelId}/`),
  },

  templates: {
    list: (workspaceSlug: string, projectId: string) =>
      api.get<PaginatedResponse<IssueTemplate>>(`/workspaces/${workspaceSlug}/projects/${projectId}/templates/`).then((r) => r.data.results),

    create: (workspaceSlug: string, projectId: string, data: Partial<IssueTemplate>) =>
      api.post<IssueTemplate>(`/workspaces/${workspaceSlug}/projects/${projectId}/templates/`, data).then((r) => r.data),

    update: (workspaceSlug: string, projectId: string, templateId: string, data: Partial<IssueTemplate>) =>
      api.patch<IssueTemplate>(`/workspaces/${workspaceSlug}/projects/${projectId}/templates/${templateId}/`, data).then((r) => r.data),

    delete: (workspaceSlug: string, projectId: string, templateId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/projects/${projectId}/templates/${templateId}/`),
  },

  /** 이슈에 연결된 문서 조회 */
  documentLinks: (workspaceSlug: string, projectId: string, issueId: string) =>
    api.get<{ id: string; document_id: string; document_title: string; document_icon_prop: unknown; space_id: string; created_at: string }[]>(
      `/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/documents/`,
    ).then((r) => r.data),
};
