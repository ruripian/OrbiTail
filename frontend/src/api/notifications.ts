import { api } from "@/lib/axios";
import type { Notification } from "@/types";

export interface NotificationPreference {
  email_enabled:        boolean;
  email_issue_assigned: boolean;
  email_issue_updated:  boolean;
  email_comment_added:  boolean;
  updated_at?:          string;
}

/* 프로젝트별 — 글로벌 타입은 NULL=상속/T/F=override, 추가로 issue_created 구독 */
export interface ProjectNotificationPreference {
  muted:                 boolean;
  email_issue_assigned:  boolean | null;
  email_issue_updated:   boolean | null;
  email_comment_added:   boolean | null;
  email_issue_created:   boolean;
  updated_at?:           string;
}

export const notificationsApi = {
  /** 알림 목록 (최신순 50개) */
  list: (workspaceSlug: string) =>
    api
      .get<{ results: Notification[] }>(`/workspaces/${workspaceSlug}/notifications/`)
      .then((r) => r.data.results),

  /** 미읽음 알림 수 */
  unreadCount: (workspaceSlug: string) =>
    api
      .get<{ count: number }>(`/workspaces/${workspaceSlug}/notifications/unread-count/`)
      .then((r) => r.data.count),

  /** 개별 알림 읽음 처리 */
  markAsRead: (workspaceSlug: string, id: string) =>
    api.patch(`/workspaces/${workspaceSlug}/notifications/${id}/read/`),

  /** 전체 읽음 처리 */
  markAllAsRead: (workspaceSlug: string) =>
    api.post(`/workspaces/${workspaceSlug}/notifications/read-all/`),

  /** 알림 환경설정 조회 (사용자 단위, 워크스페이스 무관) */
  getPreferences: () =>
    api.get<NotificationPreference>("/notifications/preferences/").then((r) => r.data),

  /** 알림 환경설정 부분 갱신 */
  updatePreferences: (data: Partial<NotificationPreference>) =>
    api.patch<NotificationPreference>("/notifications/preferences/", data).then((r) => r.data),

  /** 프로젝트별 알림 설정 조회 */
  getProjectPreferences: (workspaceSlug: string, projectId: string) =>
    api
      .get<ProjectNotificationPreference>(
        `/workspaces/${workspaceSlug}/projects/${projectId}/notification-preferences/`,
      )
      .then((r) => r.data),

  /** 프로젝트별 알림 설정 부분 갱신 */
  updateProjectPreferences: (
    workspaceSlug: string,
    projectId: string,
    data: Partial<ProjectNotificationPreference>,
  ) =>
    api
      .patch<ProjectNotificationPreference>(
        `/workspaces/${workspaceSlug}/projects/${projectId}/notification-preferences/`,
        data,
      )
      .then((r) => r.data),
};
