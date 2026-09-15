from django.urls import path
from .collab_views import CollabAuthView, CollabDocumentView
from .views import (
    WorkspaceSpaceAdminDetailView,
    WorkspaceSpaceAdminListView,
    WorkspaceSpaceAdminMemberDetailView,
    WorkspaceSpaceAdminMemberListView,
)
from .views import (
    SpaceListCreateView,
    SpaceDetailView,
    DiscoverableSpacesView,
    SpaceJoinView,
    SpaceMemberListCreateView,
    SpaceMemberDetailView,
    SpaceExportView,
    SpaceImportView,
    SpaceAnalyticsView,
    TrashedDocumentDetailView,
    DocumentLabelListCreateView,
    DocumentLabelDetailView,
    DocumentListCreateView,
    DocumentDetailView,
    DocumentMoveView,
    DocumentBulkMoveView,
    DocumentTrashView,
    DocumentBacklinkView,
    DocumentMarkdownExportView,
    DocumentGraphView,
    DocumentIssueLinkListCreateView,
    DocumentIssueLinkDeleteView,
    DocumentSearchView,
    MyDocumentsView,
    RecentDocumentsView,
    BookmarkedDocumentsView,
    DocumentBookmarkToggleView,
    BookmarkedSpacesView,
    SpaceBookmarkToggleView,
    OrphanSpaceListView,
    OrphanSpaceDeleteView,
    AttachmentSearchView,
    DocumentVersionListCreateView,
    DocumentVersionDetailView,
    DocumentCommentListCreateView,
    DocumentCommentDetailView,
    DocumentAttachmentListCreateView,
    DocumentAttachmentDeleteView,
    CommentThreadListCreateView,
    CommentThreadDetailView,
    CommentThreadReplyView,
    CommentThreadResolveView,
    DocumentTemplateListCreateView,
    DocumentTemplateDetailView,
    DocumentShareView,
    PublicDocumentView,
)

urlpatterns = [
    # 워크스페이스 설정 › 문서 스페이스 — 관리자 전용, 비공개 포함 전체 공용 스페이스(내용 없음)
    path("workspaces/<slug:workspace_slug>/documents/admin/spaces/", WorkspaceSpaceAdminListView.as_view(),
         name="workspace-space-admin-list"),
    path("workspaces/<slug:workspace_slug>/documents/admin/spaces/<uuid:pk>/", WorkspaceSpaceAdminDetailView.as_view(),
         name="workspace-space-admin-detail"),
    path("workspaces/<slug:workspace_slug>/documents/admin/spaces/<uuid:space_pk>/members/",
         WorkspaceSpaceAdminMemberListView.as_view(), name="workspace-space-admin-members"),
    path("workspaces/<slug:workspace_slug>/documents/admin/spaces/<uuid:space_pk>/members/<uuid:member_pk>/",
         WorkspaceSpaceAdminMemberDetailView.as_view(), name="workspace-space-admin-member-detail"),
    # 스페이스
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/",
        SpaceListCreateView.as_view(),
        name="document-space-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/discoverable/",
        DiscoverableSpacesView.as_view(),
        name="document-space-discoverable",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:pk>/",
        SpaceDetailView.as_view(),
        name="document-space-detail",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:pk>/join/",
        SpaceJoinView.as_view(),
        name="document-space-join",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/members/",
        SpaceMemberListCreateView.as_view(),
        name="document-space-member-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/members/<uuid:member_pk>/",
        SpaceMemberDetailView.as_view(),
        name="document-space-member-detail",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/trash/",
        DocumentTrashView.as_view(),
        name="document-trash",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/trash/<uuid:pk>/",
        TrashedDocumentDetailView.as_view(),
        name="document-trash-detail",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/export/",
        SpaceExportView.as_view(),
        name="document-space-export",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/analytics/",
        SpaceAnalyticsView.as_view(),
        name="document-space-analytics",
    ),

    # 라벨 — 워크스페이스 단위
    path(
        "workspaces/<slug:workspace_slug>/documents/labels/",
        DocumentLabelListCreateView.as_view(),
        name="document-label-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/labels/<uuid:pk>/",
        DocumentLabelDetailView.as_view(),
        name="document-label-detail",
    ),

    # 문서 CRUD
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/",
        DocumentListCreateView.as_view(),
        name="document-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:pk>/",
        DocumentDetailView.as_view(),
        name="document-detail",
    ),

    # 트리 이동
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/bulk-move/",
        DocumentBulkMoveView.as_view(),
        name="document-bulk-move",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:pk>/move/",
        DocumentMoveView.as_view(),
        name="document-move",
    ),

    # 마크다운 반입 — .md 또는 볼트 .zip
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/import/",
        SpaceImportView.as_view(),
        name="document-space-import",
    ),

    # 문서 한 장을 .md 로
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/export-md/",
        DocumentMarkdownExportView.as_view(),
        name="document-export-md",
    ),

    # 실시간 협업 서버(Hocuspocus) 전용 — 사람이 직접 쓰는 API 가 아니다
    path(
        "internal/collab/documents/<uuid:doc_pk>/auth/",
        CollabAuthView.as_view(),
        name="collab-auth",
    ),
    path(
        "internal/collab/documents/<uuid:doc_pk>/state/",
        CollabDocumentView.as_view(),
        name="collab-state",
    ),

    # 문서 관계망 — 본문 링크로 이어진 그래프
    path(
        "workspaces/<slug:workspace_slug>/documents/graph/",
        DocumentGraphView.as_view(),
        name="document-graph",
    ),

    # 백링크 — 이 문서를 가리키는 문서 + 깨진 나가는 링크
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/backlinks/",
        DocumentBacklinkView.as_view(),
        name="document-backlinks",
    ),

    # 이슈 연결
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/issues/",
        DocumentIssueLinkListCreateView.as_view(),
        name="document-issue-link-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/issues/<uuid:issue_pk>/",
        DocumentIssueLinkDeleteView.as_view(),
        name="document-issue-link-delete",
    ),

    # 검색
    path(
        "workspaces/<slug:workspace_slug>/documents/search/",
        DocumentSearchView.as_view(),
        name="document-search",
    ),

    # 탐색 탭 — 내가 만든 / 최근 / 즐겨찾기
    path(
        "workspaces/<slug:workspace_slug>/documents/mine/",
        MyDocumentsView.as_view(),
        name="document-mine",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/recent/",
        RecentDocumentsView.as_view(),
        name="document-recent",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/bookmarks/",
        BookmarkedDocumentsView.as_view(),
        name="document-bookmarks",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/bookmarks/<uuid:doc_id>/",
        DocumentBookmarkToggleView.as_view(),
        name="document-bookmark-toggle",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/space-bookmarks/",
        BookmarkedSpacesView.as_view(),
        name="document-space-bookmark-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/space-bookmarks/<uuid:space_id>/",
        SpaceBookmarkToggleView.as_view(),
        name="document-space-bookmark-toggle",
    ),

    # 워크스페이스 관리자 — 탈퇴자 개인 스페이스 + 첨부 검색
    path(
        "workspaces/<slug:workspace_slug>/documents/admin/orphan-spaces/",
        OrphanSpaceListView.as_view(),
        name="document-orphan-spaces",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/admin/orphan-spaces/<uuid:pk>/",
        OrphanSpaceDeleteView.as_view(),
        name="document-orphan-space-delete",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/admin/attachments/",
        AttachmentSearchView.as_view(),
        name="document-attachment-search",
    ),

    # 버전
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/versions/",
        DocumentVersionListCreateView.as_view(),
        name="document-version-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/versions/<uuid:pk>/",
        DocumentVersionDetailView.as_view(),
        name="document-version-detail",
    ),

    # 댓글
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/comments/",
        DocumentCommentListCreateView.as_view(),
        name="document-comment-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/comments/<uuid:pk>/",
        DocumentCommentDetailView.as_view(),
        name="document-comment-detail",
    ),

    # 블록 댓글 스레드
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/threads/",
        CommentThreadListCreateView.as_view(),
        name="comment-thread-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/threads/<uuid:pk>/",
        CommentThreadDetailView.as_view(),
        name="comment-thread-detail",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/threads/<uuid:thread_pk>/reply/",
        CommentThreadReplyView.as_view(),
        name="comment-thread-reply",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/threads/<uuid:thread_pk>/resolve/",
        CommentThreadResolveView.as_view(),
        name="comment-thread-resolve",
    ),

    # 공개 공유 링크 — 편집자만 관리, 공개 조회는 /public/documents/<token>/
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/share/",
        DocumentShareView.as_view(),
        name="document-share",
    ),
    path(
        "public/documents/<str:token>/",
        PublicDocumentView.as_view(),
        name="public-document",
    ),

    # 템플릿 — 워크스페이스 단위 (built-in + workspace + user)
    path(
        "workspaces/<slug:workspace_slug>/documents/templates/",
        DocumentTemplateListCreateView.as_view(),
        name="document-template-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/templates/<uuid:pk>/",
        DocumentTemplateDetailView.as_view(),
        name="document-template-detail",
    ),

    # 첨부파일
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/attachments/",
        DocumentAttachmentListCreateView.as_view(),
        name="document-attachment-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:doc_pk>/attachments/<uuid:pk>/",
        DocumentAttachmentDeleteView.as_view(),
        name="document-attachment-delete",
    ),
]
