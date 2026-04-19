import uuid

from django.conf import settings
from django.db import models


class DocumentSpace(models.Model):
    """문서 스페이스 — 프로젝트 연결 또는 독립 (개인/공용)

    스페이스 유형:
      project  — 프로젝트 생성 시 자동 생성. 권한은 프로젝트 멤버십 따라감.
      personal — 유저별 개인 스페이스.
      shared   — 워크스페이스 공용 스페이스.
    """

    class SpaceType(models.TextChoices):
        PROJECT = "project", "Project"
        PERSONAL = "personal", "Personal"
        SHARED = "shared", "Shared"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        "workspaces.Workspace",
        on_delete=models.CASCADE,
        related_name="document_spaces",
    )
    project = models.OneToOneField(
        "projects.Project",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="document_space",
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="personal_spaces",
    )

    name = models.CharField(max_length=200)
    icon = models.CharField(max_length=10, blank=True, default="")
    description = models.TextField(blank=True, default="")
    space_type = models.CharField(
        max_length=10,
        choices=SpaceType.choices,
        default=SpaceType.SHARED,
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "document_spaces"
        ordering = ["space_type", "name"]

    def __str__(self):
        return f"[{self.space_type}] {self.name}"


class Document(models.Model):
    """문서 또는 폴더 — 트리 구조 (parent FK)"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    space = models.ForeignKey(
        DocumentSpace,
        on_delete=models.CASCADE,
        related_name="documents",
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="children",
    )

    title = models.CharField(max_length=500, default="제목 없음")
    icon_prop = models.JSONField(null=True, blank=True, default=None)  # { type: "lucide", name: "Box", color: "#hex" }

    content_html = models.TextField(blank=True, default="")
    yjs_state = models.BinaryField(null=True, blank=True)

    is_folder = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.SET_NULL,
        related_name="created_documents",
    )
    sort_order = models.FloatField(default=65535)

    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "documents"
        ordering = ["-is_folder", "sort_order", "created_at"]
        indexes = [
            models.Index(fields=["space", "parent", "sort_order"]),
            models.Index(fields=["space", "deleted_at"]),
        ]

    def __str__(self):
        prefix = "📁" if self.is_folder else "📄"
        return f"{prefix} {self.title}"


class DocumentIssueLink(models.Model):
    """문서 ↔ 이슈 양방향 연결"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document,
        on_delete=models.CASCADE,
        related_name="issue_links",
    )
    issue = models.ForeignKey(
        "issues.Issue",
        on_delete=models.CASCADE,
        related_name="document_links",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "document_issue_links"
        unique_together = [["document", "issue"]]


class DocumentAttachment(models.Model):
    """문서 첨부파일 — 이미지/동영상/일반 파일"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="documents/attachments/%Y/%m/")
    filename = models.CharField(max_length=500)
    file_size = models.BigIntegerField(default=0)
    content_type = models.CharField(max_length=100, blank=True, default="")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "document_attachments"
        ordering = ["-created_at"]


class DocumentComment(models.Model):
    """문서 댓글"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="document_comments")
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "document_comments"
        ordering = ["-created_at"]


class DocumentVersion(models.Model):
    """문서 버전 스냅샷 — 자동 저장 (5분) 또는 수동 저장"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document,
        on_delete=models.CASCADE,
        related_name="versions",
    )
    version_number = models.IntegerField()
    title = models.CharField(max_length=500)
    content_html = models.TextField()
    yjs_state = models.BinaryField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "document_versions"
        ordering = ["-version_number"]
        unique_together = [["document", "version_number"]]
