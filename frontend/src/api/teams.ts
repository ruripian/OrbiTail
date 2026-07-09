import { api } from "@/lib/axios";
import type { Team, TeamMember, Issue, ProjectEvent, PersonalEvent } from "@/types";

/**
 * 팀 API — 워크스페이스 안 멤버 그룹.
 *
 * 권한 요약:
 *   - list/create: workspace 멤버 누구나 (list 는 본인이 멤버인 팀만 반환)
 *   - get/update/delete: 조회=팀 멤버, 편집=team admin or ws admin
 *   - 멤버 추가: team admin 만 (워크스페이스 멤버 subset)
 *   - 멤버 제거: team admin or 본인 탈퇴. 마지막 admin 차단.
 */
export const teamsApi = {
  /** 본인이 멤버인 팀 목록 */
  list: (workspaceSlug: string) =>
    api.get<Team[]>(`/workspaces/${workspaceSlug}/teams/`).then((r) => r.data),

  get: (workspaceSlug: string, teamId: string) =>
    api.get<Team>(`/workspaces/${workspaceSlug}/teams/${teamId}/`).then((r) => r.data),

  create: (workspaceSlug: string, data: { name: string; description?: string; color?: string; icon_prop?: Record<string, unknown> | null }) =>
    api.post<Team>(`/workspaces/${workspaceSlug}/teams/`, data).then((r) => r.data),

  update: (workspaceSlug: string, teamId: string, data: Partial<Pick<Team, "name" | "description" | "color" | "icon_prop">>) =>
    api.patch<Team>(`/workspaces/${workspaceSlug}/teams/${teamId}/`, data).then((r) => r.data),

  delete: (workspaceSlug: string, teamId: string) =>
    api.delete(`/workspaces/${workspaceSlug}/teams/${teamId}/`),

  members: {
    list: (workspaceSlug: string, teamId: string) =>
      api.get<TeamMember[]>(`/workspaces/${workspaceSlug}/teams/${teamId}/members/`).then((r) => r.data),

    /** member = User id. role 기본 15(MEMBER) */
    add: (workspaceSlug: string, teamId: string, data: { member: string; role?: number }) =>
      api.post<TeamMember>(`/workspaces/${workspaceSlug}/teams/${teamId}/members/`, data).then((r) => r.data),

    /** role 변경 (15/20). 마지막 admin 강등 차단은 백엔드. */
    update: (workspaceSlug: string, teamId: string, memberId: string, data: { role: number }) =>
      api.patch<TeamMember>(`/workspaces/${workspaceSlug}/teams/${teamId}/members/${memberId}/`, data).then((r) => r.data),

    /** 본인 탈퇴 OK + team admin. 마지막 admin 탈퇴 차단은 백엔드. */
    remove: (workspaceSlug: string, teamId: string, memberId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/teams/${teamId}/members/${memberId}/`),
  },

  /**
   * 팀 캘린더 데이터 — 3개 endpoint 분리 (마이 페이지 패턴 동일).
   * 응답은 비페이지네이션 배열 (PAGE_SIZE 로 캘린더 표시 누락 차단).
   *
   * 정책 (정보 누수 차단):
   *   - issues: 팀 멤버 담당 이슈 중 요청자가 그 프로젝트 멤버인 경우만 포함
   *   - personalEvents: 팀원이 shared_with_team=True 로 공유한 PE (미공유 PE 는 마이 페이지 전용)
   *   - projectEvents: 팀 멤버가 멤버인 프로젝트의 이벤트 중 요청자도 멤버인 것만
   */
  calendar: {
    issues: (workspaceSlug: string, teamId: string, params?: { from?: string; to?: string; include_completed?: string }) =>
      api.get<Issue[]>(`/workspaces/${workspaceSlug}/teams/${teamId}/calendar/issues/`, { params }).then((r) => r.data),

    personalEvents: (workspaceSlug: string, teamId: string, params?: { from?: string; to?: string }) =>
      api.get<PersonalEvent[]>(`/workspaces/${workspaceSlug}/teams/${teamId}/calendar/personal-events/`, { params }).then((r) => r.data),

    projectEvents: (workspaceSlug: string, teamId: string, params?: { from?: string; to?: string }) =>
      api.get<ProjectEvent[]>(`/workspaces/${workspaceSlug}/teams/${teamId}/calendar/project-events/`, { params }).then((r) => r.data),
  },
};
