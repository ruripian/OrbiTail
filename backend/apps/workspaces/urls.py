from django.urls import path
from .views import (
    WorkspaceListCreateView,
    WorkspaceDetailView,
    WorkspaceMemberListView,
    WorkspaceMemberDetailView,
    WorkspaceInvitationListCreateView,
    WorkspaceInvitationRevokeView,
    AdminWorkspaceListView,
    AdminWorkspaceCreateView,
    AdminWorkspaceDeleteView,
    AdminWorkspaceOwnerView,
)

urlpatterns = [
    path("", WorkspaceListCreateView.as_view(), name="workspace-list"),
    # Admin 엔드포인트 — <slug:slug> 패턴이 catch-all 되지 않도록 먼저 선언
    path("admin/all/", AdminWorkspaceListView.as_view(), name="admin-workspace-list"),
    path("admin/create/", AdminWorkspaceCreateView.as_view(), name="admin-workspace-create"),
    path("admin/<slug:slug>/", AdminWorkspaceDeleteView.as_view(), name="admin-workspace-delete"),
    path("admin/<slug:slug>/owner/", AdminWorkspaceOwnerView.as_view(), name="admin-workspace-owner"),
    path("<slug:slug>/", WorkspaceDetailView.as_view(), name="workspace-detail"),
    path("<slug:slug>/members/", WorkspaceMemberListView.as_view(), name="workspace-members"),
    path("<slug:slug>/members/<uuid:member_id>/", WorkspaceMemberDetailView.as_view(), name="workspace-member-detail"),
    # 초대 관리 (워크스페이스 내)
    path("<slug:slug>/invitations/", WorkspaceInvitationListCreateView.as_view(), name="workspace-invitations"),
    path("<slug:slug>/invitations/<uuid:invitation_id>/revoke/", WorkspaceInvitationRevokeView.as_view(), name="workspace-invitation-revoke"),
]
