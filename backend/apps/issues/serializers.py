from rest_framework import serializers
from apps.accounts.serializers import UserSerializer
from apps.projects.serializers import StateSerializer
from .models import Issue, IssueComment, IssueActivity, IssueAttachment, IssueLink, IssueNodeLink, IssueRequest, IssueTemplate, Label


class LabelSerializer(serializers.ModelSerializer):
    class Meta:
        model = Label
        fields = ["id", "name", "color"]


class IssueSerializer(serializers.ModelSerializer):
    state_detail = StateSerializer(source="state", read_only=True)
    assignee_details = UserSerializer(source="assignees", many=True, read_only=True)
    label_details = LabelSerializer(source="label", many=True, read_only=True)
    created_by_detail = UserSerializer(source="created_by", read_only=True)
    sub_issues_count = serializers.SerializerMethodField()
    link_count = serializers.SerializerMethodField()
    attachment_count = serializers.SerializerMethodField()
    project_identifier = serializers.CharField(source="project.identifier", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Issue
        fields = [
            "id", "title", "description", "description_html",
            "priority", "state", "state_detail",
            "project", "project_identifier", "project_name", "workspace",
            "assignees", "assignee_details",
            "label", "label_details",
            "category", "sprint",
            "parent", "sub_issues_count", "link_count", "attachment_count",
            "sequence_id", "created_by", "created_by_detail",
            "due_date", "start_date", "estimate_point",
            "sort_order", "is_field", "created_at", "updated_at", "archived_at", "deleted_at",
        ]
        read_only_fields = ["id", "sequence_id", "created_by", "workspace", "created_at", "updated_at", "archived_at", "deleted_at"]
        # unique_together (project, sequence_id)는 Model.save()에서 자동으로 안전하게 할당되므로
        # serializer 단계 validator는 제거 — 그렇지 않으면 default=1이 이미 존재하는 경우 첫 이슈부터 실패
        validators = []

    def get_sub_issues_count(self, obj):
        # 소프트 삭제된 하위 이슈는 카운트에서 제외
        return obj.sub_issues.filter(deleted_at__isnull=True).count()

    def get_link_count(self, obj):
        return obj.links.count()

    def get_attachment_count(self, obj):
        return obj.attachments.count()

    def validate_parent(self, value):
        """parent로 자기 자신 또는 자손을 지정하는 시도를 차단.

        프론트에 검증이 있어도 race condition / 다른 클라이언트 경로 대비 서버에서도 막음.
        """
        if value is None:
            return value
        instance = self.instance
        if instance is None:
            return value  # 신규 생성: 자기 자신이 될 수 없으므로 검증 불필요
        if value.pk == instance.pk:
            raise serializers.ValidationError("이슈를 자기 자신의 하위로 만들 수 없습니다.")
        # 자손 체크: parent 후보의 조상 체인을 거슬러 올라가 instance가 나오면 순환
        seen = set()
        cur = value
        while cur is not None:
            if cur.pk in seen:
                break  # 기존 데이터에 이미 순환이 있으면 무한루프 방지
            seen.add(cur.pk)
            if cur.pk == instance.pk:
                raise serializers.ValidationError("이슈를 자신의 자손 아래로 옮길 수 없습니다.")
            cur = cur.parent
        return value

    def create(self, validated_data):
        assignees = validated_data.pop("assignees", [])
        labels = validated_data.pop("label", [])
        # state 미지정 시 프로젝트의 기본 상태 자동 주입 (메인/서브 이슈 공통 로직)
        # 우선순위: unstarted(todo) → 첫 번째 state 순
        if not validated_data.get("state"):
            from apps.projects.models import State
            project = validated_data["project"]
            validated_data["state"] = (
                State.objects.filter(project=project, group="unstarted").order_by("sequence").first()
                or State.objects.filter(project=project).order_by("sequence").first()
            )
        issue = Issue.objects.create(
            created_by=self.context["request"].user,
            workspace=validated_data["project"].workspace,
            **validated_data,
        )
        issue.assignees.set(assignees)
        issue.label.set(labels)
        return issue


class IssueSearchSerializer(serializers.ModelSerializer):
    """전역 검색용 경량 시리얼라이저 — project identifier 포함"""
    state_detail = StateSerializer(source="state", read_only=True)
    project_identifier = serializers.CharField(source="project.identifier", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Issue
        fields = [
            "id", "title", "priority", "state", "state_detail",
            "project", "project_identifier", "project_name",
            "sequence_id", "parent", "updated_at",
        ]


class IssueCommentSerializer(serializers.ModelSerializer):
    actor_detail = UserSerializer(source="actor", read_only=True)

    class Meta:
        model = IssueComment
        fields = ["id", "comment_html", "comment_json", "actor", "actor_detail", "created_at", "updated_at"]
        read_only_fields = ["id", "actor", "created_at", "updated_at"]

    def create(self, validated_data):
        return IssueComment.objects.create(
            actor=self.context["request"].user,
            issue_id=self.context["issue_id"],
            **validated_data,
        )


class IssueLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = IssueLink
        fields = ["id", "title", "url", "created_by", "created_at"]
        read_only_fields = ["id", "created_by", "created_at"]

    def create(self, validated_data):
        return IssueLink.objects.create(
            created_by=self.context["request"].user,
            issue_id=self.context["issue_id"],
            **validated_data,
        )


class IssueNodeLinkSerializer(serializers.ModelSerializer):
    """트리 경계를 넘는 이슈 간 자유 링크(그래프 노드)."""
    source_title = serializers.CharField(source="source.title", read_only=True)
    source_sequence_id = serializers.IntegerField(source="source.sequence_id", read_only=True)
    source_project_id = serializers.UUIDField(source="source.project_id", read_only=True)
    source_project_identifier = serializers.CharField(source="source.project.identifier", read_only=True)
    target_title = serializers.CharField(source="target.title", read_only=True)
    target_sequence_id = serializers.IntegerField(source="target.sequence_id", read_only=True)
    target_project_id = serializers.UUIDField(source="target.project_id", read_only=True)
    target_project_identifier = serializers.CharField(source="target.project.identifier", read_only=True)

    class Meta:
        model = IssueNodeLink
        fields = [
            "id", "source", "target", "link_type", "note",
            "source_title", "source_sequence_id", "source_project_id", "source_project_identifier",
            "target_title", "target_sequence_id", "target_project_id", "target_project_identifier",
            "created_by", "created_at",
        ]
        read_only_fields = ["id", "created_by", "created_at"]

    def validate(self, attrs):
        source = attrs.get("source")
        target = attrs.get("target")
        if source == target:
            raise serializers.ValidationError("자기 자신과는 연결할 수 없습니다.")
        # 한 쌍은 하나의 연결만 — 방향/타입 무관 중복 차단
        from django.db.models import Q
        qs = IssueNodeLink.objects.filter(
            Q(source=source, target=target) | Q(source=target, target=source)
        )
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("이미 연결된 이슈 쌍입니다. 기존 연결을 해제 후 다시 시도하세요.")
        return attrs


class IssueAttachmentSerializer(serializers.ModelSerializer):
    """
    파일 첨부 시리얼라이저
    보안 체크리스트 CK01: 허용 확장자 화이트리스트, 파일 크기 제한, 파일명 살균
    """
    uploaded_by_detail = UserSerializer(source="uploaded_by", read_only=True)

    # 허용 확장자 화이트리스트 (소문자)
    ALLOWED_EXTENSIONS = {
        # 문서
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".txt", ".csv", ".rtf", ".odt", ".ods",
        # 이미지
        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg",
        # 압축
        ".zip", ".tar", ".gz", ".7z", ".rar",
        # 기타
        ".json", ".xml", ".yaml", ".yml", ".md", ".log",
    }
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

    class Meta:
        model = IssueAttachment
        fields = ["id", "file", "filename", "size", "mime_type", "uploaded_by", "uploaded_by_detail", "created_at"]
        read_only_fields = ["id", "filename", "size", "mime_type", "uploaded_by", "created_at"]

    def validate_file(self, file_obj):
        """파일 확장자/크기 검증 — 악성파일 업로드 방지"""
        import os

        # 1) 파일 크기 검증
        if file_obj.size > self.MAX_FILE_SIZE:
            raise serializers.ValidationError(
                f"파일 크기가 {self.MAX_FILE_SIZE // (1024 * 1024)}MB를 초과합니다."
            )

        # 2) 확장자 화이트리스트 검증
        ext = os.path.splitext(file_obj.name)[1].lower()
        if ext not in self.ALLOWED_EXTENSIONS:
            raise serializers.ValidationError(
                f"허용되지 않는 파일 형식입니다: {ext}"
            )

        # 3) 이중 확장자 방지 (예: malware.php.jpg → 차단하지 않지만 .php 포함 시 차단)
        dangerous_exts = {".exe", ".bat", ".cmd", ".sh", ".ps1", ".php", ".jsp", ".asp", ".cgi", ".py", ".rb", ".pl"}
        name_lower = file_obj.name.lower()
        for dext in dangerous_exts:
            if dext in name_lower:
                raise serializers.ValidationError(
                    f"보안상 허용되지 않는 파일명입니다."
                )

        return file_obj

    def create(self, validated_data):
        import os
        import uuid

        file_obj = validated_data["file"]
        # 보안: 원본 파일명은 DB에만 저장, 실제 저장 파일명은 UUID로 변환
        original_name = file_obj.name
        ext = os.path.splitext(original_name)[1].lower()
        file_obj.name = f"{uuid.uuid4().hex}{ext}"

        return IssueAttachment.objects.create(
            issue_id=self.context["issue_id"],
            uploaded_by=self.context["request"].user,
            file=file_obj,
            filename=original_name,
            size=file_obj.size,
            mime_type=getattr(file_obj, "content_type", ""),
        )


class IssueTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = IssueTemplate
        fields = ["id", "name", "title_template", "description_html", "priority", "created_by", "created_at", "updated_at"]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def create(self, validated_data):
        return IssueTemplate.objects.create(
            project_id=self.context["project_pk"],
            created_by=self.context["request"].user,
            **validated_data,
        )


class IssueActivitySerializer(serializers.ModelSerializer):
    actor_detail = UserSerializer(source="actor", read_only=True)

    class Meta:
        model = IssueActivity
        fields = ["id", "verb", "field", "old_value", "new_value", "actor_detail", "created_at"]


class IssueRequestSerializer(serializers.ModelSerializer):
    """제출된 버그/기능 요청 — 승인 전까지 이슈와 별개로 관리."""
    submitted_by_detail = UserSerializer(source="submitted_by", read_only=True)
    reviewer_detail = UserSerializer(source="reviewer", read_only=True)
    project_identifier = serializers.CharField(source="project.identifier", read_only=True)
    approved_issue_sequence_id = serializers.IntegerField(source="approved_issue.sequence_id", read_only=True)

    class Meta:
        model = IssueRequest
        fields = [
            "id", "project", "project_identifier", "workspace",
            "kind", "status", "visibility",
            "title", "description_html", "priority", "meta",
            "submitted_by", "submitted_by_detail",
            "reviewer", "reviewer_detail", "reviewed_at",
            "approved_issue", "approved_issue_sequence_id",
            "rejected_reason",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "status", "project", "workspace", "submitted_by", "reviewer",
            "reviewed_at", "approved_issue", "rejected_reason",
            "created_at", "updated_at",
        ]
