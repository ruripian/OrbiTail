from django.urls import path
from . import views

urlpatterns = [
    # GET  /api/workspaces/<slug>/notifications/           — 알림 목록
    path(
        "workspaces/<str:workspace_slug>/notifications/",
        views.NotificationListView.as_view(),
        name="notification-list",
    ),
    # PATCH /api/workspaces/<slug>/notifications/<id>/read/ — 개별 읽음
    path(
        "workspaces/<str:workspace_slug>/notifications/<uuid:pk>/read/",
        views.NotificationMarkReadView.as_view(),
        name="notification-mark-read",
    ),
    # POST/DELETE /api/workspaces/<slug>/notifications/<id>/archive/ — 보관/복원
    path(
        "workspaces/<str:workspace_slug>/notifications/<uuid:pk>/archive/",
        views.NotificationArchiveView.as_view(),
        name="notification-archive",
    ),
    # POST /api/workspaces/<slug>/notifications/read-all/  — 전체 읽음
    path(
        "workspaces/<str:workspace_slug>/notifications/read-all/",
        views.NotificationReadAllView.as_view(),
        name="notification-read-all",
    ),
    # GET  /api/workspaces/<slug>/notifications/unread-count/ — 미읽음 수
    path(
        "workspaces/<str:workspace_slug>/notifications/unread-count/",
        views.NotificationUnreadCountView.as_view(),
        name="notification-unread-count",
    ),
    # GET/PATCH /api/notifications/preferences/ — 사용자 전역 알림 환경설정
    path(
        "notifications/preferences/",
        views.NotificationPreferenceView.as_view(),
        name="notification-preferences",
    ),
    # GET/PATCH /api/workspaces/<slug>/projects/<pk>/notification-preferences/ — 프로젝트 단위
    path(
        "workspaces/<str:workspace_slug>/projects/<uuid:project_pk>/notification-preferences/",
        views.ProjectNotificationPreferenceView.as_view(),
        name="project-notification-preferences",
    ),
]
