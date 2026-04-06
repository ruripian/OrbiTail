from django.urls import path
from .views import (
    ProjectListCreateView,
    ProjectDetailView,
    ProjectIdentifierCheckView,
    ProjectArchiveView,
    ProjectDiscoverView,
    ProjectJoinView,
    ProjectLeaveView,
    ProjectMemberListCreateView,
    ProjectMemberDetailView,
    CategoryListCreateView,
    CategoryDetailView,
    SprintListCreateView,
    SprintDetailView,
    StateListCreateView,
    StateDetailView,
    ProjectEventListCreateView,
    ProjectEventDetailView,
)

urlpatterns = [
    # 프로젝트 CRUD
    path(
        "workspaces/<slug:workspace_slug>/projects/",
        ProjectListCreateView.as_view(),
        name="project-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:pk>/",
        ProjectDetailView.as_view(),
        name="project-detail",
    ),
    # 식별자 중복 검사
    path(
        "workspaces/<slug:workspace_slug>/projects/check-identifier/",
        ProjectIdentifierCheckView.as_view(),
        name="project-identifier-check",
    ),
    # 프로젝트 탐색 / 참가 / 나가기
    path(
        "workspaces/<slug:workspace_slug>/projects/discover/",
        ProjectDiscoverView.as_view(),
        name="project-discover",
    ),
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:pk>/join/",
        ProjectJoinView.as_view(),
        name="project-join",
    ),
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:pk>/leave/",
        ProjectLeaveView.as_view(),
        name="project-leave",
    ),
    # 프로젝트 보관/해제
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:pk>/archive/",
        ProjectArchiveView.as_view(),
        name="project-archive",
    ),
    # 프로젝트 멤버
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:project_pk>/members/",
        ProjectMemberListCreateView.as_view(),
        name="project-member-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:project_pk>/members/<uuid:pk>/",
        ProjectMemberDetailView.as_view(),
        name="project-member-detail",
    ),
    # 카테고리
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:project_pk>/categories/",
        CategoryListCreateView.as_view(),
        name="category-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:project_pk>/categories/<uuid:pk>/",
        CategoryDetailView.as_view(),
        name="category-detail",
    ),
    # 스프린트
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:project_pk>/sprints/",
        SprintListCreateView.as_view(),
        name="sprint-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:project_pk>/sprints/<uuid:pk>/",
        SprintDetailView.as_view(),
        name="sprint-detail",
    ),
    # 상태
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:project_pk>/states/",
        StateListCreateView.as_view(),
        name="state-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:project_pk>/states/<uuid:pk>/",
        StateDetailView.as_view(),
        name="state-detail",
    ),
    # 프로젝트 캘린더 이벤트
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:project_pk>/events/",
        ProjectEventListCreateView.as_view(),
        name="event-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/projects/<uuid:project_pk>/events/<uuid:pk>/",
        ProjectEventDetailView.as_view(),
        name="event-detail",
    ),
]
