from rest_framework import serializers
from apps.accounts.serializers import UserSerializer
from .models import DocumentSpace, DocumentSpaceMember, DocumentLabel, Document, DocumentIssueLink, DocumentAttachment, DocumentComment, DocumentVersion, CommentThread, DocumentTemplate


class DocumentSpaceMemberSerializer(serializers.ModelSerializer):
    member_detail = UserSerializer(source="member", read_only=True)

    class Meta:
        model = DocumentSpaceMember
        fields = ["id", "space", "member", "member_detail", "role", "created_at"]
        read_only_fields = ["id", "space", "member_detail", "created_at"]


class DocumentSpaceSerializer(serializers.ModelSerializer):
    document_count = serializers.SerializerMethodField()
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    project_identifier = serializers.CharField(source="project.identifier", read_only=True, default=None)
    project_network = serializers.IntegerField(source="project.network", read_only=True, default=None)
    owner_detail = UserSerializer(source="owner", read_only=True)
    members_detail = UserSerializer(source="members", many=True, read_only=True)
    # 역할까지 필요한 화면(설정)은 이쪽을 본다 — members_detail 은 역할 없는 명단이라 그대로 둔다
    space_members = DocumentSpaceMemberSerializer(many=True, read_only=True)

    class Meta:
        model = DocumentSpace
        fields = [
            "id", "name", "icon", "icon_prop", "identifier", "description", "space_type",
            "project", "project_name", "project_identifier", "project_network",
            "owner", "owner_detail",
            "members", "members_detail", "space_members",
            "is_private",
            "archived_at", "home_document",
            "document_count", "created_at",
        ]
        # archived_at 은 쓰기 허용 — 스페이스 보관/해제를 설정 화면에서 한다.
        # 단 프로젝트 스페이스는 프로젝트 보관과 동기화되므로 뷰에서 따로 막는다.
        read_only_fields = [
            "id", "project", "owner", "space_type", "created_at",
            "members_detail", "space_members",
        ]

    def get_document_count(self, obj):
        return obj.documents.filter(deleted_at__isnull=True, is_folder=False).count()


class DocumentLabelSerializer(serializers.ModelSerializer):
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = DocumentLabel
        fields = ["id", "name", "color", "created_by", "created_at", "document_count"]
        read_only_fields = ["id", "created_by", "created_at", "document_count"]

    def get_document_count(self, obj):
        return obj.documents.filter(deleted_at__isnull=True).count()


class DocumentSerializer(serializers.ModelSerializer):
    created_by_detail = UserSerializer(source="created_by", read_only=True)
    children_count = serializers.SerializerMethodField()
    has_yjs_state = serializers.SerializerMethodField()
    cover_image_url = serializers.SerializerMethodField()
    labels_detail = DocumentLabelSerializer(source="labels", many=True, read_only=True)

    class Meta:
        model = Document
        fields = [
            "id", "space", "parent", "title", "icon_prop",
            "labels", "labels_detail",
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
            "has_yjs_state", "cover_image_url", "labels_detail",
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
    labels_detail = DocumentLabelSerializer(source="labels", many=True, read_only=True)

    class Meta:
        model = Document
        # space 는 검색 결과처럼 URL 에 space_pk 가 없는 응답에서 클라가 후속 호출(연결/이동)에
        # 필요. 트리/리스트 응답에 포함시켜도 비용 없음.
        fields = [
            "id", "space", "parent", "title", "icon_prop", "is_folder",
            "labels", "labels_detail",
            "sort_order", "children_count",
            "created_at", "updated_at",
        ]

    def get_children_count(self, obj):
        return obj.children.filter(deleted_at__isnull=True).count()


class TrashedDocumentSerializer(serializers.ModelSerializer):
    """휴지통 목록 — 누가 언제 지웠는지가 핵심이라 그 두 필드를 함께 실어 보낸다.

    본문(content_html)은 목록에 넣지 않는다. 문서가 많으면 응답이 급격히 커진다 —
    미리보기는 필요할 때 단건으로 따로 받는다.
    """
    deleted_by_detail = UserSerializer(source="deleted_by", read_only=True)

    class Meta:
        model = Document
        fields = [
            "id", "space", "parent", "title", "icon_prop", "is_folder",
            "deleted_at", "deleted_by", "deleted_by_detail",
            "created_at", "updated_at",
        ]


class TrashedDocumentDetailSerializer(serializers.ModelSerializer):
    """휴지통 미리보기 — 본문까지 포함한 단건 조회용(읽기 전용)."""
    deleted_by_detail = UserSerializer(source="deleted_by", read_only=True)
    created_by_detail = UserSerializer(source="created_by", read_only=True)

    class Meta:
        model = Document
        fields = [
            "id", "space", "parent", "title", "icon_prop", "is_folder", "content_html",
            "deleted_at", "deleted_by", "deleted_by_detail",
            "created_by", "created_by_detail", "created_at", "updated_at",
        ]


class DocumentIssueLinkSerializer(serializers.ModelSerializer):
    issue_title = serializers.CharField(source="issue.title", read_only=True)
    issue_sequence_id = serializers.IntegerField(source="issue.sequence_id", read_only=True)
    issue_state = serializers.CharField(source="issue.state_id", read_only=True)
    issue_priority = serializers.CharField(source="issue.priority", read_only=True)
    project_id = serializers.UUIDField(source="issue.project_id", read_only=True)
    project_identifier = serializers.CharField(source="issue.project.identifier", read_only=True)
    # 미러 카운트 — 문서에서 연결된 이슈의 활동량을 한눈에 보여주기 위함.
    # 연결 수가 보통 한 자리수라 N+1 이 큰 부담은 아님. 폭발 시 prefetch 도입 검토.
    issue_comment_count = serializers.SerializerMethodField()
    issue_attachment_count = serializers.SerializerMethodField()
    issue_last_comment_at = serializers.SerializerMethodField()

    class Meta:
        model = DocumentIssueLink
        fields = [
            "id", "document", "issue",
            "issue_title", "issue_sequence_id", "issue_state", "issue_priority",
            "project_id", "project_identifier",
            "issue_comment_count", "issue_attachment_count", "issue_last_comment_at",
            "created_at",
        ]
        read_only_fields = ["id", "document", "created_at"]

    def get_issue_comment_count(self, obj):
        return obj.issue.comments.count()

    def get_issue_attachment_count(self, obj):
        return obj.issue.attachments.filter(deleted_at__isnull=True).count()

    def get_issue_last_comment_at(self, obj):
        last = obj.issue.comments.order_by("-created_at").only("created_at").first()
        return last.created_at.isoformat() if last else None


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
            "scope", "workspace", "owner", "space",
            "content_html", "sort_order",
            "created_by", "created_by_detail",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "scope", "workspace", "owner", "space",
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
