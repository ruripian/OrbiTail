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
        super().save(*args, **kwargs)


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
