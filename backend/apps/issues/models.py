import uuid
from django.db import models
from django.conf import settings


class Label(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    color = models.CharField(max_length=255, default="#000000")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="labels")

    class Meta:
        db_table = "issue_labels"

    def __str__(self):
        return self.name


class Issue(models.Model):
    class Priority(models.TextChoices):
        NONE = "none", "None"
        URGENT = "urgent", "Urgent"
        HIGH = "high", "High"
        MEDIUM = "medium", "Medium"
        LOW = "low", "Low"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    description = models.JSONField(null=True, blank=True)  # rich text as JSON (tiptap/prosemirror)
    description_html = models.TextField(blank=True, default="")
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NONE)
    state = models.ForeignKey(
        "projects.State",
        on_delete=models.SET_NULL,
        null=True,
        related_name="issues",
    )
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="issues",
    )
    workspace = models.ForeignKey(
        "workspaces.Workspace",
        on_delete=models.CASCADE,
        related_name="issues",
    )
    assignees = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="assigned_issues",
    )
    label = models.ManyToManyField(Label, blank=True, related_name="issues")
    category = models.ForeignKey(
        "projects.Category",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="issues",
    )
    sprint = models.ForeignKey(
        "projects.Sprint",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="issues",
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,  # 부모 삭제(휴지통 비우기) 시 하위 이슈도 함께 제거
        null=True,
        blank=True,
        related_name="sub_issues",
    )
    sequence_id = models.IntegerField(default=1)  # human-readable ID like OUR-1
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_issues",
    )
    due_date = models.DateField(null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    estimate_point = models.IntegerField(null=True, blank=True)
    sort_order = models.FloatField(default=65535)
    # 필드(Field) 플래그 — True 면 상태가 없는 "폴더" 성격의 상위 분류.
    # 주로 장기·비정형 작업 그룹(예: "리서치", "인프라") 을 묶을 때 사용.
    # BoardView/번다운에서 제외, 상태 셀 "—" 로 표시.
    is_field = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    archived_at = models.DateTimeField(null=True, blank=True)  # 보관 — null이면 활성, 값이 있으면 보관함
    deleted_at = models.DateTimeField(null=True, blank=True)  # 소프트 삭제 — null이면 정상, 값이 있으면 휴지통

    class Meta:
        db_table = "issues"
        # sort_order가 동일한 이슈들(기본값 65535)은 sequence_id(생성 순서)로 안정 정렬
        ordering = ["sort_order", "sequence_id"]
        unique_together = [["project", "sequence_id"]]

    def __str__(self):
        return f"{self.project.identifier}-{self.sequence_id} {self.title}"

    def save(self, *args, **kwargs):
        if not self.sequence_id or self.sequence_id == 1:
            last = Issue.objects.filter(project=self.project).order_by("-sequence_id").first()
            self.sequence_id = (last.sequence_id + 1) if last else 1

        # 필드는 상태 없음 — 일반 이슈 ↔ 필드 전환 시 state 자동 정리
        if self.is_field and self.state_id is not None:
            self.state_id = None

        # ── 카테고리 상속 규칙 ────────────────────────────────
        # 1) 부모가 있는 하위 이슈는 부모의 카테고리를 강제 상속 — 다른 카테고리로 편입 불가
        # 2) 최상위 이슈의 카테고리가 변경되면 저장 후 자손 전체에 전파
        old_category_id = None
        if self.pk:
            old_category_id = type(self).objects.filter(pk=self.pk).values_list(
                "category_id", flat=True
            ).first()
        if self.parent_id:
            parent_cat = type(self).objects.filter(pk=self.parent_id).values_list(
                "category_id", flat=True
            ).first()
            self.category_id = parent_cat

        super().save(*args, **kwargs)

        if self.parent_id is None and old_category_id != self.category_id:
            self._propagate_category_to_descendants()

    def _propagate_category_to_descendants(self):
        """이 이슈의 모든 자손(재귀) 에 현재 category_id 를 일괄 전파."""
        descendant_ids: list = []
        frontier = list(type(self).objects.filter(parent_id=self.pk).values_list("id", flat=True))
        while frontier:
            descendant_ids.extend(frontier)
            frontier = list(
                type(self).objects.filter(parent_id__in=frontier).values_list("id", flat=True)
            )
        if descendant_ids:
            type(self).objects.filter(pk__in=descendant_ids).update(category_id=self.category_id)


class IssueComment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="comments")
    comment_html = models.TextField(blank=True, default="")
    comment_json = models.JSONField(null=True, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="issue_comments",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "issue_comments"
        ordering = ["created_at"]


class IssueLink(models.Model):
    """이슈에 첨부된 외부 URL 링크"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="links")
    title = models.CharField(max_length=255, blank=True, default="")
    url = models.URLField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_issue_links",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "issue_links"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.issue} — {self.url}"


class IssueNodeLink(models.Model):
    """이슈 간 그래프 링크 — 트리 구조와 독립된 자유 연결(node 기능 기반).

    사용처: 다른 트리/프로젝트의 이슈끼리 관련성 표시(블록/참조/중복 등).
    그래프 뷰는 프론트엔드 추후 구현. 여기서는 데이터 모델과 CRUD 엔드포인트만.
    """

    class LinkType(models.TextChoices):
        RELATES_TO = "relates_to", "Relates to"
        BLOCKS = "blocks", "Blocks"
        BLOCKED_BY = "blocked_by", "Blocked by"
        DUPLICATES = "duplicates", "Duplicates"
        REFERENCES = "references", "References"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.ForeignKey(
        Issue, on_delete=models.CASCADE, related_name="outgoing_node_links",
    )
    target = models.ForeignKey(
        Issue, on_delete=models.CASCADE, related_name="incoming_node_links",
    )
    link_type = models.CharField(
        max_length=20,
        choices=LinkType.choices,
        default=LinkType.RELATES_TO,
    )
    note = models.CharField(max_length=500, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_node_links",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "issue_node_links"
        ordering = ["-created_at"]
        unique_together = [["source", "target", "link_type"]]

    def __str__(self):
        return f"{self.source_id} -[{self.link_type}]-> {self.target_id}"


class IssueAttachment(models.Model):
    """이슈에 첨부된 파일 (이미지, 문서 등)"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="attachments/%Y/%m/")
    filename = models.CharField(max_length=255)
    size = models.PositiveIntegerField(default=0, help_text="파일 크기 (bytes)")
    mime_type = models.CharField(max_length=100, blank=True, default="")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="uploaded_attachments",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)  # 소프트 삭제 — 휴지통 30일 후 영구 삭제

    class Meta:
        db_table = "issue_attachments"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.issue} — {self.filename}"


class IssueTemplate(models.Model):
    """이슈 템플릿 — 반복되는 이슈 유형을 재사용 가능한 스켈레톤으로 저장

    프로젝트별로 관리되며, 이슈 생성 시 템플릿 선택으로 필드를 자동 채움
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="issue_templates"
    )
    name = models.CharField(max_length=255, help_text="템플릿 이름")
    title_template = models.CharField(max_length=255, blank=True, default="", help_text="이슈 제목 기본값")
    description_html = models.TextField(blank=True, default="", help_text="이슈 설명 기본값 (HTML)")
    priority = models.CharField(
        max_length=10,
        choices=Issue.Priority.choices,
        default=Issue.Priority.NONE,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_templates",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "issue_templates"
        ordering = ["name"]

    def __str__(self):
        return f"{self.project.identifier} — {self.name}"


class IssueRequest(models.Model):
    """제출된 요청(버그/기능) — 이슈로 편입 전 승인 대기 상태를 별도 관리.

    흐름:
      1) 멤버/외부가 /request 페이지에서 제출 → IssueRequest pending 생성
      2) 프로젝트 관리자가 승인 → Issue 로 변환 (카테고리/스프린트/담당자/상태 지정)
      3) 거절 → 사유 기록, 이력 페이지에 남음

    가시성:
      - PUBLIC: 프로젝트 멤버 누구나 조회
      - PRIVATE: 제출자 + 관리자만
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    class Kind(models.TextChoices):
        BUG = "bug", "Bug"
        FEATURE = "feature", "Feature"

    class Visibility(models.TextChoices):
        PUBLIC = "public", "Public"
        PRIVATE = "private", "Private"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="requests")
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="requests")

    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.FEATURE)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    visibility = models.CharField(max_length=10, choices=Visibility.choices, default=Visibility.PUBLIC)

    title = models.CharField(max_length=255)
    description_html = models.TextField(blank=True, default="")
    priority = models.CharField(max_length=10, choices=Issue.Priority.choices, default=Issue.Priority.MEDIUM)
    # kind 별 추가 필드(재현단계/환경/심각도 등)는 meta JSON 으로 유연 저장
    meta = models.JSONField(default=dict, blank=True)

    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="submitted_requests",
    )
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_requests",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # 승인 시 생성된 이슈 연결 — 추적 가능
    approved_issue = models.ForeignKey(
        Issue, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="source_request",
    )
    rejected_reason = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "issue_requests"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "status"]),
            models.Index(fields=["submitted_by", "status"]),
        ]

    def __str__(self):
        return f"[{self.status}] {self.title}"


class IssueActivity(models.Model):
    """Audit log for issue changes"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="activities")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="issue_activities",
    )
    verb = models.CharField(max_length=255)  # e.g. "created", "updated state"
    field = models.CharField(max_length=255, blank=True, null=True)
    old_value = models.TextField(blank=True, null=True)
    new_value = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "issue_activities"
        ordering = ["created_at"]
