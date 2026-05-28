from django.urls import path
from .views import (
    WorkspaceListCreateView,
    WorkspacePublicListView,
    WorkspaceJoinableListView,
    WorkspaceJoinRequestCreateView,
    MyJoinRequestsView,
    MyJoinRequestCancelView,
    WorkspaceJoinRequestAdminListView,
    WorkspaceJoinRequestDecisionView,
    WorkspaceDetailView,
    WorkspaceMemberListView,
    WorkspaceMemberDetailView,
    WorkspaceInvitationListCreateView,
    WorkspaceInvitationRevokeView,
    AdminWorkspaceListView,
    AdminWorkspaceCreateView,
    AdminWorkspaceDeleteView,
    AdminWorkspaceOwnerView,
    TeamListCreateView,
    TeamDetailView,
    TeamMemberListCreateView,
    TeamMemberDetailView,
    TeamCalendarIssuesView,
    TeamCalendarPersonalEventsView,
    TeamCalendarProjectEventsView,
)

urlpatterns = [
    path("", WorkspaceListCreateView.as_view(), name="workspace-list"),
    # 공개 워크스페이스 목록 — 회원가입 폼의 워크스페이스 셀렉터용 (비로그인 가능)
    path("public/", WorkspacePublicListView.as_view(), name="workspace-public-list"),
    # 셀프 가입 — 가입 가능 후보 + 내가 보낸 신청 + 신청 취소
    path("joinable/", WorkspaceJoinableListView.as_view(), name="workspace-joinable"),
    path("join-requests/mine/", MyJoinRequestsView.as_view(), name="workspace-my-join-requests"),
    path("join-requests/<uuid:request_id>/cancel/", MyJoinRequestCancelView.as_view(), name="workspace-my-join-request-cancel"),
    # Admin 엔드포인트 — <slug:slug> 패턴이 catch-all 되지 않도록 먼저 선언
    path("admin/all/", AdminWorkspaceListView.as_view(), name="admin-workspace-list"),
    path("admin/create/", AdminWorkspaceCreateView.as_view(), name="admin-workspace-create"),
    path("admin/<slug:slug>/", AdminWorkspaceDeleteView.as_view(), name="admin-workspace-delete"),
    path("admin/<slug:slug>/owner/", AdminWorkspaceOwnerView.as_view(), name="admin-workspace-owner"),
    # 가입 신청 — 사용자(POST) / 워크스페이스 어드민(GET 목록 + 승인/거절)
    path("<slug:slug>/join-request/", WorkspaceJoinRequestCreateView.as_view(), name="workspace-join-request-create"),
    path("<slug:slug>/join-requests/", WorkspaceJoinRequestAdminListView.as_view(), name="workspace-join-requests-admin"),
    path("<slug:slug>/join-requests/<uuid:request_id>/decision/", WorkspaceJoinRequestDecisionView.as_view(), name="workspace-join-request-decision"),
    path("<slug:slug>/", WorkspaceDetailView.as_view(), name="workspace-detail"),
    path("<slug:slug>/members/", WorkspaceMemberListView.as_view(), name="workspace-members"),
    path("<slug:slug>/members/<uuid:member_id>/", WorkspaceMemberDetailView.as_view(), name="workspace-member-detail"),
    # 초대 관리 (워크스페이스 내)
    path("<slug:slug>/invitations/", WorkspaceInvitationListCreateView.as_view(), name="workspace-invitations"),
    path("<slug:slug>/invitations/<uuid:invitation_id>/revoke/", WorkspaceInvitationRevokeView.as_view(), name="workspace-invitation-revoke"),
    # 팀 — 워크스페이스 안 멤버 그룹
    path("<slug:workspace_slug>/teams/", TeamListCreateView.as_view(), name="team-list"),
    path("<slug:workspace_slug>/teams/<uuid:pk>/", TeamDetailView.as_view(), name="team-detail"),
    path("<slug:workspace_slug>/teams/<uuid:team_pk>/members/", TeamMemberListCreateView.as_view(), name="team-member-list"),
    path("<slug:workspace_slug>/teams/<uuid:team_pk>/members/<uuid:pk>/", TeamMemberDetailView.as_view(), name="team-member-detail"),
    # 팀 캘린더 — 멤버 담당 이슈(요청자별 필터) + 본인 PE + 멤버 공통 프로젝트 이벤트
    path("<slug:workspace_slug>/teams/<uuid:team_pk>/calendar/issues/", TeamCalendarIssuesView.as_view(), name="team-calendar-issues"),
    path("<slug:workspace_slug>/teams/<uuid:team_pk>/calendar/personal-events/", TeamCalendarPersonalEventsView.as_view(), name="team-calendar-pes"),
    path("<slug:workspace_slug>/teams/<uuid:team_pk>/calendar/project-events/", TeamCalendarProjectEventsView.as_view(), name="team-calendar-pjes"),
]
