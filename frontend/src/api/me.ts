import { api } from "@/lib/axios";
import type { Issue, ProjectEvent, PersonalEvent, MeSummary, PaginatedResponse } from "@/types";
import type { NodeGraphResponse } from "./issues";

interface DateRange {
  from?: string;
  to?: string;
}

interface IssueOptions {
  include_completed?: boolean;
  workspace?: string;
}

interface EventOptions extends DateRange {
  workspace?: string;
}

/** /api/me/* — 모든 워크스페이스의 본인 데이터 통합 */
export const meApi = {
  /** 본인이 담당자인 이슈. 기본은 미완료, ?include_completed=true 로 완료 포함. */
  issues: (opts: IssueOptions = {}) =>
    api
      .get<PaginatedResponse<Issue>>("/me/issues/", {
        params: {
          ...(opts.include_completed ? { include_completed: "true" } : {}),
          ...(opts.workspace ? { workspace: opts.workspace } : {}),
        },
      })
      .then((r) => r.data.results),

  /** 본인이 참여(is_global=true 포함) 하는 프로젝트 이벤트. */
  projectEvents: (opts: EventOptions = {}) =>
    api
      .get<PaginatedResponse<ProjectEvent>>("/me/project-events/", { params: opts })
      .then((r) => r.data.results),

  /** 종합 탭 카드 + 분포 데이터. */
  summary: () =>
    api.get<MeSummary>("/me/summary/").then((r) => r.data),

  /** 본인 이슈 그래프 — 같은 NodeGraphResponse 포맷. 외부 조상은 external=true 반투명. */
  graph: (opts?: { includeLabelEdges?: boolean; manualOnly?: boolean }) =>
    api
      .get<NodeGraphResponse>("/me/graph/", {
        params: {
          include_label_edges: opts?.includeLabelEdges === false ? "false" : "true",
          manual_only: opts?.manualOnly ? "true" : "false",
        },
      })
      .then((r) => r.data),

  personalEvents: {
    list: (opts: DateRange = {}) =>
      api
        .get<PaginatedResponse<PersonalEvent>>("/me/personal-events/", { params: opts })
        .then((r) => r.data.results),

    create: (data: Partial<PersonalEvent>) =>
      api.post<PersonalEvent>("/me/personal-events/", data).then((r) => r.data),

    update: (id: string, data: Partial<PersonalEvent>) =>
      api.patch<PersonalEvent>(`/me/personal-events/${id}/`, data).then((r) => r.data),

    delete: (id: string) =>
      api.delete<void>(`/me/personal-events/${id}/`).then(() => undefined),
  },
};
