"""공개 API v1 — 여기에 올린 것만 외부 계약이다.

내부 API(/api/workspaces/…)는 화면을 위해 자유롭게 바뀐다. 그걸 그대로 열면 내부 리팩터가
곧 외부 연동 파괴가 되므로, 외부에 약속할 것만 이 파일에 따로 올린다.
"""
from django.urls import path
from django.utils.translation import gettext_lazy
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from .v1 import views as v

SCHEMA_SETTINGS = {
    "TITLE": "OrbiTail API v1",
    "DESCRIPTION": (
        gettext_lazy("Send a token created under Workspace settings › API tokens as `Authorization: Bearer orbt_…`.\n\n- The workspace comes from the token — do not put it in the URL.\n- A token acts with the permissions of the person who created it. Whatever they cannot see, the token cannot see either.\n- A read token can only read; a write token can also create, update and delete.\n- Bodies (issue descriptions, comments, documents) are exchanged as Markdown.\n- Lists are paginated with `?page=` and `&page_size=` (up to 100).")
    ),
    "VERSION": "1",
    "SCHEMA_PATH_PREFIX": "/api/v1",
    "COMPONENT_SPLIT_REQUEST": True,
}

urlpatterns = [
    path("me/", v.MeView.as_view(), name="v1-me"),

    path("projects/", v.ProjectListView.as_view(), name="v1-projects"),
    path("projects/<str:project_id>/", v.ProjectDetailView.as_view(), name="v1-project"),
    path("projects/<str:project_id>/states/", v.ProjectStateListView.as_view(), name="v1-project-states"),
    path("projects/<str:project_id>/labels/", v.ProjectLabelListView.as_view(), name="v1-project-labels"),
    path("projects/<str:project_id>/sprints/", v.ProjectSprintListView.as_view(), name="v1-project-sprints"),
    path("projects/<str:project_id>/categories/", v.ProjectCategoryListView.as_view(), name="v1-project-categories"),
    path("projects/<str:project_id>/members/", v.ProjectMemberListView.as_view(), name="v1-project-members"),

    path("issues/", v.IssueListView.as_view(), name="v1-issues"),
    path("issues/<str:ref>/", v.IssueDetailView.as_view(), name="v1-issue"),
    path("issues/<str:ref>/comments/", v.IssueCommentListView.as_view(), name="v1-issue-comments"),

    path("spaces/", v.SpaceListView.as_view(), name="v1-spaces"),
    path("spaces/<str:space_id>/documents/", v.SpaceDocumentListView.as_view(), name="v1-space-documents"),
    path("documents/<str:doc_id>/", v.DocumentDetailView.as_view(), name="v1-document"),
    path("documents/<str:doc_id>/content/", v.DocumentContentView.as_view(), name="v1-document-content"),
    path("documents/<str:doc_id>/append/", v.DocumentAppendView.as_view(), name="v1-document-append"),

    # 문서 — 토큰 없이 볼 수 있다. 계약 자체는 비밀이 아니다.
    path(
        "schema/",
        SpectacularAPIView.as_view(
            urlconf="apps.api.schema_urlconf", custom_settings=SCHEMA_SETTINGS,
            authentication_classes=[], permission_classes=[],
        ),
        name="v1-schema",
    ),
    path(
        "docs/",
        SpectacularSwaggerView.as_view(url_name="v1-schema", authentication_classes=[], permission_classes=[]),
        name="v1-docs",
    ),
]
