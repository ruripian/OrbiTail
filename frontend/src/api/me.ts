import { api } from "@/lib/axios";
import type { Issue, ProjectEvent, PersonalEvent, MeSummary, Priority, State } from "@/types";
import type { NodeGraphResponse } from "./issues";

interface DateRange {
  from?: string;
  to?: string;
}

interface IssueOptions {
  include_completed?: boolean;
}

/** 단발성 이슈 생성 입력 — Personal 프로젝트는 backend lazy 생성되므로 클라가 알 필요 없음. */
export interface CreatePersonalIssueInput {
  title: string;
  description?: unknown;
  description_html?: string;
  priority?: Priority;
  /** Personal 프로젝트 State id — 미지정 시 backend 가 unstarted 기본 상태로 설정. */
  state?: string;
  start_date?: string | null;
  due_date?: string | null;
  /** 기본 true — 본인이 속한 팀 캘린더에 노출. false 면 본인만 봄. */
  shared_with_team?: boolean;
}

/** /api/me/* — 마이 페이지 ws-scoped 데이터.
 * 모든 메서드가 workspaceSlug 필수 — 워크스페이스는 별개 공간이라 마이 페이지도 그 ws 한정.
 * PersonalEvent 는 user-owned 이지만 ws 별로 분리되어 표시됨 (사용자 멘탈 모델).
 *
 * NOTE: detail endpoint(PersonalEvent update/delete)는 ID 기반이라 ws 인자 불필요.
 */
export const meApi = {
  /** 본인 담당 이슈 — 해당 ws 안에서. 기본 미완료, ?include_completed=true 로 완료 포함.
   *  create 는 단발성 이슈 생성 — backend 가 Personal 프로젝트(ws+user 별 lazy)에 자동 귀속. */
  issues: Object.assign(
    (workspaceSlug: string, opts: IssueOptions = {}) =>
      api
        .get<Issue[]>("/me/issues/", {
          params: {
            workspace: workspaceSlug,
            ...(opts.include_completed ? { include_completed: "true" } : {}),
          },
        })
        .then((r) => r.data),
    {
      /** 단발성 이슈 생성. 응답은 표준 Issue (project_kind=personal). */
      create: (workspaceSlug: string, data: CreatePersonalIssueInput) =>
        api
          .post<Issue>("/me/issues/", { ...data, workspace_slug: workspaceSlug })
          .then((r) => r.data),
    },
  ),

  /** 단발성 이슈 생성 창의 상태 선택용 — 본인 Personal 프로젝트 State 목록.
   *  backend 가 Personal 프로젝트를 보장(get_or_create)하므로 항상 5개 반환. */
  personalStates: (workspaceSlug: string) =>
    api
      .get<State[]>("/me/personal-states/", { params: { workspace: workspaceSlug } })
      .then((r) => r.data),

  /** 본인 Personal 프로젝트("내 작업") — 사이드바 바로가기용 최소 메타.
   *  일반 프로젝트 목록에 안 잡히므로 별도 조회. backend get_or_create 로 항상 존재. */
  personalProject: (workspaceSlug: string) =>
    api
      .get<{ id: string; name: string; identifier: string; icon_prop: Record<string, unknown> | null }>(
        "/me/personal-project/",
        { params: { workspace: workspaceSlug } },
      )
      .then((r) => r.data),

  /** 본인이 참여(is_global=true 포함) 하는 프로젝트 이벤트 — 해당 ws 안에서만. */
  projectEvents: (workspaceSlug: string, opts: DateRange = {}) =>
    api
      .get<ProjectEvent[]>("/me/project-events/", {
        params: { workspace: workspaceSlug, ...opts },
      })
      .then((r) => r.data),

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
        .get<PersonalEvent[]>("/me/personal-events/", {
          params: { workspace: workspaceSlug, ...opts },
        })
        .then((r) => r.data),

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
