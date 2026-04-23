from rest_framework import serializers
from apps.accounts.serializers import UserSerializer
from .models import DocumentSpace, Document, DocumentIssueLink, DocumentAttachment, DocumentComment, DocumentVersion


class DocumentSpaceSerializer(serializers.ModelSerializer):
    document_count = serializers.SerializerMethodField()
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    project_identifier = serializers.CharField(source="project.identifier", read_only=True, default=None)
    owner_detail = UserSerializer(source="owner", read_only=True)
    members_detail = UserSerializer(source="members", many=True, read_only=True)

    class Meta:
        model = DocumentSpace
        fields = [
            "id", "name", "icon", "icon_prop", "identifier", "description", "space_type",
            "project", "project_name", "project_identifier",
            "owner", "owner_detail",
            "members", "members_detail",
            "archived_at",
            "document_count", "created_at",
        ]
        read_only_fields = [
            "id", "project", "owner", "space_type", "archived_at", "created_at",
            "members_detail",
        ]

    def get_document_count(self, obj):
        return obj.documents.filter(deleted_at__isnull=True, is_folder=False).count()


class DocumentSerializer(serializers.ModelSerializer):
    created_by_detail = UserSerializer(source="created_by", read_only=True)
    children_count = serializers.SerializerMethodField()
    has_yjs_state = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            "id", "space", "parent", "title", "icon_prop",
            "content_html", "is_folder",
            "created_by", "created_by_detail",
            "sort_order", "children_count",
            "has_yjs_state",
            "deleted_at", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "space", "created_by", "deleted_at", "created_at", "updated_at",
            "has_yjs_state",
        ]

    def get_children_count(self, obj):
        return obj.children.filter(deleted_at__isnull=True).count()

    def get_has_yjs_state(self, obj):
        # 실시간 시드 권한 판정용 — 이미 CRDT 상태가 있으면 클라이언트는 시드 스킵
        return bool(obj.yjs_state)


class DocumentTreeSerializer(serializers.ModelSerializer):
    """트리 목록용 경량 시리얼라이저 — content 제외"""
    children_count = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            "id", "parent", "title", "icon_prop", "is_folder",
            "sort_order", "children_count",
            "created_at", "updated_at",
        ]

    def get_children_count(self, obj):
        return obj.children.filter(deleted_at__isnull=True).count()


class DocumentIssueLinkSerializer(serializers.ModelSerializer):
    issue_title = serializers.CharField(source="issue.title", read_only=True)
    issue_sequence_id = serializers.IntegerField(source="issue.sequence_id", read_only=True)
    issue_state = serializers.CharField(source="issue.state_id", read_only=True)
    issue_priority = serializers.CharField(source="issue.priority", read_only=True)
    project_identifier = serializers.CharField(source="issue.project.identifier", read_only=True)

    class Meta:
        model = DocumentIssueLink
        fields = [
            "id", "document", "issue",
            "issue_title", "issue_sequence_id", "issue_state", "issue_priority",
            "project_identifier",
            "created_at",
        ]
        read_only_fields = ["id", "document", "created_at"]


class DocumentVersionSerializer(serializers.ModelSerializer):
    created_by_detail = UserSerializer(source="created_by", read_only=True)

    class Meta:
        model = DocumentVersion
        fields = [
            "id", "document", "version_number", "title",
            "content_html",
            "created_by", "created_by_detail", "created_at",
        ]
        read_only_fields = ["id", "document", "version_number", "created_by", "created_at"]


class DocumentAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserSerializer(source="uploaded_by", read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = DocumentAttachment
        fields = ["id", "document", "file", "file_url", "filename", "file_size", "content_type", "uploaded_by", "uploaded_by_detail", "created_at"]
        read_only_fields = ["id", "document", "filename", "file_size", "content_type", "uploaded_by", "created_at"]

    def get_file_url(self, obj):
        """항상 상대 경로 반환 — 프록시가 처리"""
        if obj.file:
            return obj.file.url
        return None


class DocumentCommentSerializer(serializers.ModelSerializer):
    author_detail = UserSerializer(source="author", read_only=True)

    class Meta:
        model = DocumentComment
        fields = ["id", "document", "author", "author_detail", "content", "created_at", "updated_at"]
        read_only_fields = ["id", "document", "author", "created_at", "updated_at"]
