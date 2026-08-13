"""콘솔 콘텐츠 탐색기 직렬화기.

문서 첨부와 이슈 첨부는 필드명이 서로 다르다(file_size/size, content_type/mime_type).
모델 필드명을 통일하는 마이그레이션은 앱 전체 코드가 영향을 받으므로 하지 않고,
콘솔 표시 계층에서만 같은 이름으로 맞춘다. 그래야 프론트가 두 목록에 같은 컬럼 정의를 쓴다.
"""
from rest_framework import serializers

from apps.documents.models import DocumentAttachment
from apps.issues.models import IssueAttachment


class _AttachmentRowMixin(serializers.ModelSerializer):
    kind             = serializers.SerializerMethodField()
    file_url         = serializers.SerializerMethodField()
    uploaded_by_name = serializers.CharField(source="uploaded_by.display_name", default=None)
    uploaded_at      = serializers.DateTimeField(source="created_at")

    def get_file_url(self, obj):
        return obj.file.url if obj.file else None


class DocumentAttachmentRowSerializer(_AttachmentRowMixin):
    """문서 첨부 한 줄."""

    size            = serializers.IntegerField(source="file_size")
    mime            = serializers.CharField(source="content_type")
    parent_id       = serializers.UUIDField(source="document.id")
    parent_title    = serializers.CharField(source="document.title")
    location_id     = serializers.UUIDField(source="document.space.id")
    location_name   = serializers.CharField(source="document.space.name")
    # personal 스페이스는 소유자 외에는 볼 수 없는 콘텐츠다 — 목록에서 배지로 구분한다.
    space_type      = serializers.CharField(source="document.space.space_type")
    workspace_slug  = serializers.CharField(source="document.space.workspace.slug")
    workspace_name  = serializers.CharField(source="document.space.workspace.name")

    class Meta:
        model = DocumentAttachment
        fields = [
            "id", "kind", "filename", "size", "mime", "file_url",
            "parent_id", "parent_title", "location_id", "location_name", "space_type",
            "workspace_slug", "workspace_name",
            "uploaded_by_name", "uploaded_at",
        ]

    def get_kind(self, obj):
        return "document"


class IssueAttachmentRowSerializer(_AttachmentRowMixin):
    """이슈 첨부 한 줄. source=from_comment 면 댓글 편집기로 올라온 파일이다."""

    mime            = serializers.CharField(source="mime_type")
    parent_id       = serializers.UUIDField(source="issue.id")
    parent_title    = serializers.SerializerMethodField()
    location_id     = serializers.UUIDField(source="issue.project.id")
    location_name   = serializers.CharField(source="issue.project.name")
    workspace_slug  = serializers.CharField(source="issue.project.workspace.slug")
    workspace_name  = serializers.CharField(source="issue.project.workspace.name")
    origin          = serializers.CharField(source="source")

    class Meta:
        model = IssueAttachment
        fields = [
            "id", "kind", "filename", "size", "mime", "file_url",
            "parent_id", "parent_title", "location_id", "location_name", "origin",
            "workspace_slug", "workspace_name",
            "uploaded_by_name", "uploaded_at",
        ]

    def get_kind(self, obj):
        return "issue"

    def get_parent_title(self, obj):
        return f"{obj.issue.project.identifier}-{obj.issue.sequence_id} {obj.issue.title}"
