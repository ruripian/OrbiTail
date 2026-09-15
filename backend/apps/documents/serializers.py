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
    # 이 문서가 속한 폴더가 표라면 그 칸 정의 — 문서 화면이 채울 칸을 알아야 한다.
    # 따로 조회하게 두면 폴더 칸을 고쳤을 때 두 응답이 어긋난다.
    parent_db_columns = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            "id", "space", "parent", "title", "icon_prop",
            "labels", "labels_detail",
            "cover_image", "cover_image_url",
            "cover_offset_x", "cover_offset_y", "cover_zoom", "cover_height",
            "preferred_width",
            "font_size_body", "font_size_h3", "font_size_h2", "font_size_h1",
            "properties", "db_columns", "parent_db_columns",
            "content_html", "is_folder",
            "created_by", "created_by_detail",
            "sort_order", "children_count",
            "has_yjs_state",
            "deleted_at", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "space", "created_by", "deleted_at", "created_at", "updated_at",
            "has_yjs_state", "cover_image_url", "labels_detail", "parent_db_columns",
        ]
        # cover_image 자체는 write-only로 허용 (multipart PATCH 가능), 읽기는 cover_image_url
        extra_kwargs = {
            "cover_image": {"write_only": True, "required": False, "allow_null": True},
        }

    def _space(self):
        if self.instance is not None:
            return self.instance.space
        view = self.context.get("view")
        space_pk = view.kwargs.get("space_pk") if view else None
        return DocumentSpace.objects.filter(pk=space_pk).first() if space_pk else None

    def validate_parent(self, value):
        """부모는 같은 스페이스의 문서만 — 다른 스페이스 폴더를 가리키면 그 폴더의 칸 정의가 응답에 새고,
        그 폴더를 지울 때 이 문서까지 함께 지워진다."""
        space = self._space()
        if value is not None and space is not None and value.space_id != space.pk:
            raise serializers.ValidationError("같은 스페이스의 문서만 부모로 지정할 수 있습니다.")
        if value is not None and self.instance is not None and value.pk == self.instance.pk:
            raise serializers.ValidationError("자신을 부모로 지정할 수 없습니다.")
        return value

    def validate_labels(self, value):
        """라벨은 이 스페이스의 워크스페이스 것만 — 다른 워크스페이스 라벨의 이름·만든 사람이 새지 않게."""
        space = self._space()
        if space is not None and any(lb.workspace_id != space.workspace_id for lb in value):
            raise serializers.ValidationError("이 워크스페이스의 라벨이 아닌 것이 있습니다.")
        return value

    #: 표의 칸에 쓸 수 있는 값 종류.
    #  issue · doc 은 다른 것을 가리키는 칸이다. 값은 {"id", "label"} 로 담는다 —
    #  id 만 담으면 `.md` 머리말에 UUID 가 나가 사람이 못 읽고, label 만 담으면 이름이 바뀔 때 끊긴다.
    #  created · updated 는 문서 자체에서 나오는 값이라 사람이 채우지 않는다 —
    #  "회의 날짜" 같은 걸 매번 손으로 적게 하지 않으려고 둔다.
    COLUMN_TYPES = {
        "text", "number", "date", "select", "multi_select", "checkbox",
        "issue", "doc", "created", "updated",
    }
    MAX_COLUMNS = 20

    def validate_db_columns(self, value):
        """폴더를 표로 쓸 때의 칸 정의. None 이면 평범한 폴더."""
        if value is None:
            return None
        if not isinstance(value, list):
            raise serializers.ValidationError("칸 정의는 목록이어야 합니다.")
        if len(value) > self.MAX_COLUMNS:
            raise serializers.ValidationError(f"칸은 최대 {self.MAX_COLUMNS}개까지입니다.")
        cleaned = []
        seen = set()
        for col in value:
            if not isinstance(col, dict):
                raise serializers.ValidationError("칸 하나는 이름과 종류를 가진 묶음이어야 합니다.")
            name = str(col.get("name", "")).strip()
            if not name:
                raise serializers.ValidationError("칸 이름은 비워 둘 수 없습니다.")
            # 이름이 곧 값의 key 라 중복되면 한 칸이 다른 칸의 값을 덮는다
            if name.lower() in seen:
                raise serializers.ValidationError(f"칸 이름 '{name}' 이 중복됩니다.")
            seen.add(name.lower())
            ctype = str(col.get("type", "text"))
            if ctype not in self.COLUMN_TYPES:
                raise serializers.ValidationError(f"'{name}' 의 종류 '{ctype}' 를 알 수 없습니다.")
            entry = {"name": name[:100], "type": ctype}
            if ctype in ("select", "multi_select"):
                options = col.get("options") or []
                if not isinstance(options, list):
                    raise serializers.ValidationError(f"'{name}' 의 선택지는 목록이어야 합니다.")
                entry["options"] = [str(o).strip()[:100] for o in options if str(o).strip()][:50]
            cleaned.append(entry)
        return cleaned

    # YAML 머리말로 오갈 수 있는 값만 받는다. 중첩 객체를 허용하면 내보낸 마크다운을
    # 다시 읽어 들일 때 같은 모양으로 복원된다는 보장이 사라진다.
    MAX_PROPERTY_KEYS = 50

    def validate_properties(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("프로퍼티는 key-value 묶음이어야 합니다.")
        if len(value) > self.MAX_PROPERTY_KEYS:
            raise serializers.ValidationError(
                f"프로퍼티는 최대 {self.MAX_PROPERTY_KEYS}개까지입니다."
            )
        cleaned = {}
        for key, val in value.items():
            name = str(key).strip()
            if not name:
                raise serializers.ValidationError("프로퍼티 이름은 비워 둘 수 없습니다.")
            # 무언가를 가리키는 칸 — 보여줄 이름과 따라갈 id 를 함께 담는다
            if isinstance(val, dict):
                ref_id = str(val.get("id", "")).strip()
                label = str(val.get("label", "")).strip()
                if not ref_id:
                    raise serializers.ValidationError(f"'{name}' 이 가리키는 대상이 없습니다.")
                cleaned[name] = {"id": ref_id[:64], "label": label[:200]}
            elif isinstance(val, list):
                if not all(isinstance(v, (str, int, float, bool)) for v in val):
                    raise serializers.ValidationError(f"'{name}' 목록에는 값만 넣을 수 있습니다.")
                cleaned[name] = [str(v) if not isinstance(v, bool) else v for v in val]
            elif isinstance(val, (str, int, float, bool)) or val is None:
                cleaned[name] = val
            else:
                raise serializers.ValidationError(
                    f"'{name}' 값은 글자·숫자·참거짓 또는 그 목록만 됩니다."
                )
        return cleaned

    def get_parent_db_columns(self, obj):
        return obj.parent.db_columns if obj.parent_id and obj.parent else None

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
            # 표 뷰가 행을 그리려면 값이 목록 응답에 실려야 한다 — 문서마다 따로 부르면 N+1 이다
            "properties", "db_columns",
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
