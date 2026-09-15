"""공개 API v1 의 입출력 모양 — 외부에 약속한 계약이다.

내부 시리얼라이저(apps/*/serializers.py)를 재사용하지 않는다. 그쪽은 화면이 필요로 하는 필드를
자유롭게 붙이고 떼는데(아이콘·카운트·캐시용 필드), 그게 그대로 외부 계약이 되면 화면을 고칠
때마다 연동이 깨진다.

본문은 **마크다운으로만** 주고받는다. HTML 을 받지 않는 이유: 이 저장소의 일부 화면(댓글 등)은
저장된 HTML 을 그대로 그리므로, 외부에서 HTML 을 넣게 하면 스크립트 주입 통로가 된다.
마크다운 → HTML 변환기는 태그를 이스케이프하고 위험한 링크 스킴을 막는다.
"""
from rest_framework import serializers

from apps.documents.markdown import html_to_markdown, markdown_to_html


def _user_brief(user):
    if user is None:
        return None
    return {"id": str(user.id), "display_name": user.display_name, "email": user.email}


def _absolute(request, path: str) -> str:
    return request.build_absolute_uri(path) if request is not None else path


class UserBriefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    display_name = serializers.CharField()
    email = serializers.EmailField()


class RefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()


# ── 프로젝트 ────────────────────────────────────────────────────

class ProjectSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    identifier = serializers.CharField(help_text="이슈 번호 앞에 붙는 식별자. 예: OUR")
    name = serializers.CharField()
    description = serializers.CharField()
    visibility = serializers.SerializerMethodField(help_text="public | private")
    archived_at = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()
    web_url = serializers.SerializerMethodField()

    def get_visibility(self, obj) -> str:
        from apps.projects.models import Project
        return "public" if obj.network == Project.Network.PUBLIC else "private"

    def get_web_url(self, obj) -> str:
        return _absolute(self.context.get("request"), f"/{obj.workspace.slug}/projects/{obj.id}/issues")


class StateSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    group = serializers.CharField(help_text="backlog | unstarted | started | completed | cancelled")
    color = serializers.CharField()
    default = serializers.BooleanField()


class LabelSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    color = serializers.CharField()


class SprintSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    status = serializers.CharField(help_text="draft | active | completed | cancelled")
    start_date = serializers.DateField()
    end_date = serializers.DateField()


class CategorySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    status = serializers.CharField()


class ProjectMemberSerializer(serializers.Serializer):
    user = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField(help_text="viewer | member | admin")

    def get_user(self, obj) -> UserBriefSerializer:
        return _user_brief(obj.member)

    def get_role(self, obj) -> str:
        return {10: "viewer", 15: "member", 20: "admin"}.get(obj.role, "member")


# ── 이슈 ────────────────────────────────────────────────────────

class IssueSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    identifier = serializers.SerializerMethodField(help_text="사람이 읽는 번호. 예: OUR-12")
    project = serializers.SerializerMethodField()
    title = serializers.CharField()
    description = serializers.SerializerMethodField(help_text="마크다운")
    priority = serializers.CharField(help_text="none | urgent | high | medium | low")
    state = serializers.SerializerMethodField()
    assignees = serializers.SerializerMethodField()
    labels = serializers.SerializerMethodField()
    sprint = serializers.SerializerMethodField()
    category = serializers.SerializerMethodField()
    parent = serializers.UUIDField(source="parent_id", allow_null=True)
    start_date = serializers.DateField(allow_null=True)
    due_date = serializers.DateField(allow_null=True)
    estimate_point = serializers.IntegerField(allow_null=True)
    created_by = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
    archived_at = serializers.DateTimeField(allow_null=True)
    web_url = serializers.SerializerMethodField()

    def get_identifier(self, obj) -> str:
        return f"{obj.project.identifier}-{obj.sequence_id}"

    def get_project(self, obj) -> dict:
        return {"id": str(obj.project_id), "identifier": obj.project.identifier, "name": obj.project.name}

    def get_description(self, obj) -> str:
        return html_to_markdown(obj.description_html or "")

    def get_state(self, obj) -> StateSerializer(allow_null=True):
        s = obj.state
        return None if s is None else {"id": str(s.id), "name": s.name, "group": s.group, "color": s.color,
                                       "default": s.default}

    def get_assignees(self, obj) -> UserBriefSerializer(many=True):
        return [_user_brief(u) for u in obj.assignees.all()]

    def get_labels(self, obj) -> LabelSerializer(many=True):
        return [{"id": str(lb.id), "name": lb.name, "color": lb.color} for lb in obj.label.all()]

    def get_sprint(self, obj) -> RefSerializer(allow_null=True):
        return None if obj.sprint is None else {"id": str(obj.sprint.id), "name": obj.sprint.name}

    def get_category(self, obj) -> RefSerializer(allow_null=True):
        return None if obj.category is None else {"id": str(obj.category.id), "name": obj.category.name}

    def get_created_by(self, obj) -> UserBriefSerializer(allow_null=True):
        return _user_brief(obj.created_by)

    def get_web_url(self, obj) -> str:
        return _absolute(
            self.context.get("request"),
            f"/{obj.workspace.slug}/projects/{obj.project_id}/issues?issue={obj.id}",
        )


class IssueWriteSerializer(serializers.Serializer):
    """생성과 수정이 같이 쓴다. 수정은 보낸 필드만 바뀐다(PATCH).

    관계 필드는 모두 id 로 받고, 전부 **그 이슈의 프로젝트에 속한 것**이어야 한다 —
    다른 프로젝트의 상태·라벨을 붙이면 화면이 그 값을 찾지 못해 깨진다.
    """

    project = serializers.UUIDField(required=False, help_text="생성 시 필수. 수정할 수 없다")
    title = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True, help_text="마크다운")
    priority = serializers.ChoiceField(choices=["none", "urgent", "high", "medium", "low"], required=False)
    state = serializers.UUIDField(required=False, help_text="생략하면 프로젝트의 기본 상태")
    assignees = serializers.ListField(child=serializers.UUIDField(), required=False, help_text="사용자 id 목록 — 통째로 교체")
    labels = serializers.ListField(child=serializers.UUIDField(), required=False, help_text="라벨 id 목록 — 통째로 교체")
    sprint = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.UUIDField(required=False, allow_null=True)
    parent = serializers.UUIDField(required=False, allow_null=True)
    start_date = serializers.DateField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)
    estimate_point = serializers.IntegerField(required=False, allow_null=True, min_value=0)

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("제목을 입력하세요.")
        return value

    def validate(self, attrs):
        start, due = attrs.get("start_date"), attrs.get("due_date")
        if start and due and start > due:
            raise serializers.ValidationError({"due_date": "마감일이 시작일보다 앞설 수 없습니다."})
        if "description" in attrs:
            attrs["description_html"] = markdown_to_html(attrs.pop("description"))
        return attrs


class CommentSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    body = serializers.SerializerMethodField(help_text="마크다운")
    author = serializers.SerializerMethodField()
    parent = serializers.UUIDField(source="parent_id", allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()

    def get_body(self, obj) -> str:
        return html_to_markdown(obj.comment_html or "")

    def get_author(self, obj) -> UserBriefSerializer(allow_null=True):
        return _user_brief(obj.actor)


class CommentWriteSerializer(serializers.Serializer):
    body = serializers.CharField(help_text="마크다운")
    parent = serializers.UUIDField(required=False, allow_null=True, help_text="답글을 달 댓글 id")

    def validate_body(self, value):
        if not value.strip():
            raise serializers.ValidationError("내용을 입력하세요.")
        return value


# ── 문서 ────────────────────────────────────────────────────────

class SpaceSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    type = serializers.CharField(source="space_type", help_text="project | shared | personal")
    project = serializers.UUIDField(source="project_id", allow_null=True)


class DocumentListSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField()
    parent = serializers.UUIDField(source="parent_id", allow_null=True)
    is_folder = serializers.BooleanField()
    updated_at = serializers.DateTimeField()


class DocumentSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    space = serializers.UUIDField(source="space_id")
    parent = serializers.UUIDField(source="parent_id", allow_null=True)
    title = serializers.CharField()
    is_folder = serializers.BooleanField()
    content = serializers.SerializerMethodField(help_text="본문 마크다운 (머리말 없음)")
    properties = serializers.JSONField()
    labels = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
    web_url = serializers.SerializerMethodField()

    def get_content(self, obj) -> str:
        return html_to_markdown(obj.content_html or "")

    def get_labels(self, obj) -> list[str]:
        return [lb.name for lb in obj.labels.all()]

    def get_created_by(self, obj) -> UserBriefSerializer(allow_null=True):
        return _user_brief(obj.created_by)

    def get_web_url(self, obj) -> str:
        return _absolute(
            self.context.get("request"),
            f"/{obj.space.workspace.slug}/documents/space/{obj.space_id}/{obj.id}",
        )


def _validate_properties(value):
    """화면과 같은 규칙 — YAML 머리말로 오갈 수 있는 값만."""
    from apps.documents.serializers import DocumentSerializer as InternalDocumentSerializer
    return InternalDocumentSerializer().validate_properties(value)


class DocumentCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=500)
    parent = serializers.UUIDField(required=False, allow_null=True, help_text="같은 스페이스의 문서·폴더 id")
    is_folder = serializers.BooleanField(required=False, default=False)
    content = serializers.CharField(required=False, allow_blank=True, help_text="본문 마크다운")
    properties = serializers.JSONField(required=False)

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("제목을 입력하세요.")
        return value

    def validate_properties(self, value):
        return _validate_properties(value)


class DocumentUpdateSerializer(serializers.Serializer):
    """본문은 여기서 받지 않는다 — content/ 와 append/ 로 따로. 메타데이터와 본문은 반영 경로가 다르다."""

    title = serializers.CharField(max_length=500, required=False)
    parent = serializers.UUIDField(required=False, allow_null=True, help_text="옮길 곳. null 이면 최상위")
    properties = serializers.JSONField(required=False, help_text="통째로 교체")

    validate_title = DocumentCreateSerializer.validate_title

    def validate_properties(self, value):
        return _validate_properties(value)


class DocumentContentSerializer(serializers.Serializer):
    content = serializers.CharField(allow_blank=True, help_text="본문 마크다운")
