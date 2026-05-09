from rest_framework import serializers
from apps.accounts.serializers import UserSerializer
from .models import DocumentSpace, Document, DocumentIssueLink, DocumentAttachment, DocumentComment, DocumentVersion, CommentThread, DocumentTemplate


class DocumentSpaceSerializer(serializers.ModelSerializer):
    document_count = serializers.SerializerMethodField()
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    project_identifier = serializers.CharField(source="project.identifier", read_only=True, default=None)
    project_network = serializers.IntegerField(source="project.network", read_only=True, default=None)
    owner_detail = UserSerializer(source="owner", read_only=True)
    members_detail = UserSerializer(source="members", many=True, read_only=True)

    class Meta:
        model = DocumentSpace
        fields = [
            "id", "name", "icon", "icon_prop", "identifier", "description", "space_type",
            "project", "project_name", "project_identifier", "project_network",
            "owner", "owner_detail",
            "members", "members_detail",
            "is_private",
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
    cover_image_url = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            "id", "space", "parent", "title", "icon_prop",
            "cover_image", "cover_image_url",
            "cover_offset_x", "cover_offset_y", "cover_zoom", "cover_height",
            "preferred_width",
            "font_size_body", "font_size_h3", "font_size_h2", "font_size_h1",
            "content_html", "is_folder",
            "created_by", "created_by_detail",
            "sort_order", "children_count",
            "has_yjs_state",
            "deleted_at", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "space", "created_by", "deleted_at", "created_at", "updated_at",
            "has_yjs_state", "cover_image_url",
        ]
        # cover_image 자체는 write-only로 허용 (multipart PATCH 가능), 읽기는 cover_image_url
        extra_kwargs = {
            "cover_image": {"write_only": True, "required": False, "allow_null": True},
        }

    def get_children_count(self, obj):
        return obj.children.filter(deleted_at__isnull=True).count()

    def get_has_yjs_state(self, obj):
        # 실시간 시드 권한 판정용 — 실질 내용 있는 state만 True.
        # 빈 Y.Doc의 get_update()는 2바이트 marker라 bool()로는 구분 안 됨.
        if not obj.yjs_state:
            return False
        return len(bytes(obj.yjs_state)) > 2

    def get_cover_image_url(self, obj):
        return obj.cover_image.url if obj.cover_image else None


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
    project_id = serializers.UUIDField(source="issue.project_id", read_only=True)
    project_identifier = serializers.CharField(source="issue.project.identifier", read_only=True)

    class Meta:
        model = DocumentIssueLink
        fields = [
            "id", "document", "issue",
            "issue_title", "issue_sequence_id", "issue_state", "issue_priority",
            "project_id", "project_identifier",
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


class DocumentTemplateSerializer(serializers.ModelSerializer):
    created_by_detail = UserSerializer(source="created_by", read_only=True)

    class Meta:
        model = DocumentTemplate
        fields = [
            "id", "name", "description", "icon_prop",
            "scope", "workspace", "owner",
            "content_html", "sort_order",
            "created_by", "created_by_detail",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "scope", "workspace", "owner",
            "created_by", "created_at", "updated_at",
        ]


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
        fields = [
            "id", "document", "thread", "author", "author_detail",
            "content", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "document", "thread", "author", "created_at", "updated_at"]


class CommentThreadSerializer(serializers.ModelSerializer):
    """스레드 + 내부 댓글 nested. 목록 조회 시 한 번에 내려보낼 수 있도록."""
    created_by_detail = UserSerializer(source="created_by", read_only=True)
    resolved_by_detail = UserSerializer(source="resolved_by", read_only=True)
    comments = DocumentCommentSerializer(many=True, read_only=True)
    comment_count = serializers.SerializerMethodField()

    # 최초 작성 시 initial_content로 첫 댓글 자동 생성 — 빈 스레드 방지
    initial_content = serializers.CharField(write_only=True, required=False, allow_blank=False)

    class Meta:
        model = CommentThread
        fields = [
            "id", "document", "anchor_text",
            "resolved", "resolved_at", "resolved_by", "resolved_by_detail",
            "created_by", "created_by_detail", "created_at",
            "comments", "comment_count",
            "initial_content",
        ]
        read_only_fields = [
            "id", "document",
            "resolved_at", "resolved_by", "created_by", "created_at",
            "comments", "comment_count",
        ]

    def get_comment_count(self, obj):
        return obj.comments.count()
