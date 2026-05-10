import { api } from "@/lib/axios";
import type { Issue, ProjectEvent, PersonalEvent, MeSummary, PaginatedResponse } from "@/types";
import type { NodeGraphResponse } from "./issues";

interface DateRange {
  from?: string;
  to?: string;
}

interface IssueOptions {
  include_completed?: boolean;
}

/** /api/me/* — 마이 페이지 ws-scoped 데이터.
 * 모든 메서드가 workspaceSlug 필수 — 워크스페이스는 별개 공간이라 마이 페이지도 그 ws 한정.
 * PersonalEvent 는 user-owned 이지만 ws 별로 분리되어 표시됨 (사용자 멘탈 모델).
 *
 * NOTE: detail endpoint(PersonalEvent update/delete)는 ID 기반이라 ws 인자 불필요.
 */
export const meApi = {
  /** 본인 담당 이슈 — 해당 ws 안에서. 기본 미완료, ?include_completed=true 로 완료 포함. */
  issues: (workspaceSlug: string, opts: IssueOptions = {}) =>
    api
      .get<PaginatedResponse<Issue>>("/me/issues/", {
        params: {
          workspace: workspaceSlug,
          ...(opts.include_completed ? { include_completed: "true" } : {}),
        },
      })
      .then((r) => r.data.results),

  /** 본인이 참여(is_global=true 포함) 하는 프로젝트 이벤트 — 해당 ws 안에서만. */
  projectEvents: (workspaceSlug: string, opts: DateRange = {}) =>
    api
      .get<PaginatedResponse<ProjectEvent>>("/me/project-events/", {
        params: { workspace: workspaceSlug, ...opts },
      })
      .then((r) => r.data.results),

  /** 종합 탭 카드 + 분포 데이터 — 해당 ws 한정. */
  summary: (workspaceSlug: string) =>
    api.get<MeSummary>("/me/summary/", { params: { workspace: workspaceSlug } }).then((r) => r.data),

  /** 본인 이슈 그래프 — 해당 ws 한정. 외부 조상은 external=true 반투명. */
  graph: (workspaceSlug: string, opts?: { includeLabelEdges?: boolean; manualOnly?: boolean }) =>
    api
      .get<NodeGraphResponse>("/me/graph/", {
        params: {
          workspace: workspaceSlug,
          include_label_edges: opts?.includeLabelEdges === false ? "false" : "true",
          manual_only: opts?.manualOnly ? "true" : "false",
        },
      })
      .then((r) => r.data),

  personalEvents: {
    /** 해당 ws 의 본인 PersonalEvent 만 노출 */
    list: (workspaceSlug: string, opts: DateRange = {}) =>
      api
        .get<PaginatedResponse<PersonalEvent>>("/me/personal-events/", {
          params: { workspace: workspaceSlug, ...opts },
        })
        .then((r) => r.data.results),

    /** 생성 시 workspace_slug body 로 전달 — backend 가 그 ws 멤버 검증 후 자동 설정 */
    create: (workspaceSlug: string, data: Partial<PersonalEvent>) =>
      api
        .post<PersonalEvent>("/me/personal-events/", { ...data, workspace_slug: workspaceSlug })
        .then((r) => r.data),

    /** detail — ID 만으로 가능 (소유자 검증은 backend) */
    update: (id: string, data: Partial<PersonalEvent>) =>
      api.patch<PersonalEvent>(`/me/personal-events/${id}/`, data).then((r) => r.data),

    delete: (id: string) =>
      api.delete<void>(`/me/personal-events/${id}/`).then(() => undefined),
  },
};
