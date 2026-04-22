import { api } from "@/lib/axios";
import type { IssueRequest, Issue } from "@/types";

/** 버그/기능 요청 큐 — 제출 → 승인/거절 → 이슈 편입. */
export const requestsApi = {
  /** 프로젝트의 요청 목록. status 필터 (pending/approved/rejected) */
  list: (workspaceSlug: string, projectId: string, status?: string) =>
    api
      .get<IssueRequest[]>(`/workspaces/${workspaceSlug}/projects/${projectId}/requests/`, {
        params: status ? { status } : undefined,
      })
      .then((r) => r.data),

  /** 요청 제출 */
  create: (
    workspaceSlug: string,
    projectId: string,
    data: {
      kind: "bug" | "feature";
      visibility: "public" | "private";
      title: string;
      description_html?: string;
      priority?: string;
      meta?: Record<string, unknown>;
    },
  ) =>
    api
      .post<IssueRequest>(`/workspaces/${workspaceSlug}/projects/${projectId}/requests/`, data)
      .then((r) => r.data),

  /** 승인 → Issue 로 변환. 추가 필드(state, category, sprint, assignees, label 등) 지정 가능 */
  approve: (
    workspaceSlug: string,
    projectId: string,
    requestId: string,
    data: {
      state?: string;
      category?: string;
      sprint?: string;
      assignees?: string[];
      label?: string[];
      start_date?: string;
      due_date?: string;
      estimate_point?: number;
    },
  ) =>
    api
      .post<{ request: IssueRequest; issue: Issue }>(
        `/workspaces/${workspaceSlug}/projects/${projectId}/requests/${requestId}/approve/`,
        data,
      )
      .then((r) => r.data),

  /** 거절 — 사유 선택 */
  reject: (workspaceSlug: string, projectId: string, requestId: string, reason?: string) =>
    api
      .post<IssueRequest>(
        `/workspaces/${workspaceSlug}/projects/${projectId}/requests/${requestId}/reject/`,
        { reason: reason ?? "" },
      )
      .then((r) => r.data),

  /** 요청 삭제 — 제출자(pending) 또는 관리자 */
  delete: (workspaceSlug: string, projectId: string, requestId: string) =>
    api.delete(`/workspaces/${workspaceSlug}/projects/${projectId}/requests/${requestId}/`),
};
