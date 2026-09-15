"""공개 API v1 — 여기에 올린 것만 외부 계약이다.

내부 API(/api/workspaces/…)는 화면을 위해 자유롭게 바뀐다. 그걸 그대로 열면 내부 리팩터가
곧 외부 연동 파괴가 되므로, 외부에 약속할 것만 이 파일에 따로 올린다.
"""
from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from .v1 import views as v

SCHEMA_SETTINGS = {
    "TITLE": "OrbiTail API v1",
    "DESCRIPTION": (
        "워크스페이스 설정 › API 토큰에서 만든 토큰을 `Authorization: Bearer orbt_…` 로 보냅니다.\n\n"
        "- 워크스페이스는 토큰에서 정해집니다 — 주소에 넣지 않습니다.\n"
        "- 토큰은 만든 사람의 권한으로 동작합니다. 그 사람이 볼 수 없는 것은 토큰도 볼 수 없습니다.\n"
        "- read 토큰은 조회만, write 토큰은 만들기·고치기·지우기까지 할 수 있습니다.\n"
        "- 본문(이슈 설명·댓글·문서)은 마크다운으로 주고받습니다.\n"
        "- 목록은 `?page=` `&page_size=`(최대 100)로 나눠 받습니다."
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
