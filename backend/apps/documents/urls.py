from django.urls import path
from .views import (
    SpaceListCreateView,
    SpaceDetailView,
    DocumentListCreateView,
    DocumentDetailView,
    DocumentMoveView,
    DocumentIssueLinkListCreateView,
    DocumentIssueLinkDeleteView,
    DocumentSearchView,
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
)

urlpatterns = [
    # 스페이스
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/",
        SpaceListCreateView.as_view(),
        name="document-space-list",
    ),
    path(
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:pk>/",
        SpaceDetailView.as_view(),
        name="document-space-detail",
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
        "workspaces/<slug:workspace_slug>/documents/spaces/<uuid:space_pk>/docs/<uuid:pk>/move/",
        DocumentMoveView.as_view(),
        name="document-move",
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
