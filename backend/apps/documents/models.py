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
    icon_prop = models.JSONField(null=True, blank=True, default=None)  # 프로젝트 아이콘 동기화용
    description = models.TextField(blank=True, default="")
    space_type = models.CharField(
        max_length=10,
        choices=SpaceType.choices,
        default=SpaceType.SHARED,
    )
    # 추가 필드: 참여자 (personal/shared 용), 구분자 (프로젝트 identifier 와 동일 역할)
    identifier = models.CharField(max_length=24, blank=True, default="")
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="document_space_memberships",
    )
    # shared 스페이스의 공개 범위.
    #   False(기본) → 워크스페이스 모든 멤버가 접근 + 탐색 페이지 노출 + 가입 가능.
    #   True        → space.members 추가된 사람만 접근.
    # project 스페이스는 프로젝트 자체의 network 를 따름 (이 필드는 무시).
    # personal 스페이스는 항상 owner 전용.
    is_private = models.BooleanField(default=False)

    # 프로젝트 보관과 연동되는 스페이스 보관 — project-linked 스페이스의 경우 자동 동기화
    archived_at = models.DateTimeField(null=True, blank=True)
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

    # 커버 이미지 — Notion 스타일 상단 배너.
    # offset_x/offset_y: 0~100 % (이미지의 어느 지점이 컨테이너 중앙에 오도록 할지)
    # zoom: 1.0 ~ 3.0 (기본 1.0 = cover로 딱 맞음, ↑일수록 더 확대/크롭됨)
    cover_image = models.ImageField(upload_to="documents/covers/%Y/%m/", null=True, blank=True)
    cover_offset_x = models.IntegerField(default=50)
    cover_offset_y = models.IntegerField(default=50)
    cover_zoom = models.FloatField(default=1.0)
    cover_height = models.IntegerField(default=208)  # px, 120 ~ 480 권장 (h-52 ≒ 208px가 기본)

    # 작성자가 권장하는 너비 — 다른 사용자가 열었을 때 기본 너비.
    # 사용자가 그 자리에서 토글해도 본인 세션만 영향 (저장 안 함).
    PREFERRED_WIDTH_CHOICES = (("narrow", "Narrow (860px)"), ("wide", "Wide (full)"))
    preferred_width = models.CharField(max_length=8, choices=PREFERRED_WIDTH_CHOICES, default="narrow")

    # 문서 단위 글자 크기 (px) — 모든 협업자에게 동일하게 보임. 편집 권한자가 변경.
    # 본문 < H3 < H2 < H1 순서를 클라이언트가 강제.
    font_size_body = models.IntegerField(default=18)
    font_size_h3   = models.IntegerField(default=22)
    font_size_h2   = models.IntegerField(default=28)
    font_size_h1   = models.IntegerField(default=36)

    # 공개 공유 — token이 있으면 로그인 없이 /s/<token>으로 read-only 조회 가능
    share_token = models.CharField(max_length=64, unique=True, null=True, blank=True, db_index=True)
    share_expires_at = models.DateTimeField(null=True, blank=True)

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
        # 사용자 드래그 순서만 존중 — 폴더/문서 구분 없이 sort_order 순.
        # 동점일 때만 생성 시각으로 안정 정렬.
        ordering = ["sort_order", "created_at"]
        indexes = [
            models.Index(fields=["space", "parent", "sort_order"]),
            models.Index(fields=["space", "deleted_at"]),
        ]

    def __str__(self):
        prefix = "📁" if self.is_folder else "📄"
        return f"{prefix} {self.title}"


class DocumentBookmark(models.Model):
    """사용자별 문서 즐겨찾기 — 사용자/문서 unique"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="document_bookmarks",
    )
    document = models.ForeignKey(
        Document,
        on_delete=models.CASCADE,
        related_name="bookmarks",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "document_bookmarks"
        unique_together = ("user", "document")
        indexes = [models.Index(fields=["user", "-created_at"])]


class DocumentSpaceBookmark(models.Model):
    """사용자별 스페이스 즐겨찾기 — 사용자/스페이스 unique.
    문서 단위 즐겨찾기와 별개로, 자주 쓰는 스페이스를 빠르게 진입하기 위한 핀."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="document_space_bookmarks",
    )
    space = models.ForeignKey(
        DocumentSpace,
        on_delete=models.CASCADE,
        related_name="bookmarks",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "document_space_bookmarks"
        unique_together = ("user", "space")
        indexes = [models.Index(fields=["user", "-created_at"])]


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


class CommentThread(models.Model):
    """블록 단위 댓글 스레드 — 문서의 특정 텍스트 선택 구간에 앵커된 대화.

    CommentMark extension이 inline mark로 텍스트에 data-thread-id를 심고, Y.Doc 전파로
    다른 피어에게도 마크가 보인다. 스레드 레코드는 REST로 관리 (생성/해결/삭제).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="comment_threads")
    # 원본 선택 텍스트 스냅샷 — 마크가 문서 편집으로 사라지거나 위치가 드리프트해도
    # 사이드바에서 무슨 내용에 달린 댓글인지 보여주기 위함.
    anchor_text = models.CharField(max_length=500, blank=True, default="")

    resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="resolved_comment_threads",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="created_comment_threads",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "document_comment_threads"
        ordering = ["created_at"]
        indexes = [models.Index(fields=["document", "resolved"])]


class DocumentComment(models.Model):
    """문서 댓글 — thread가 있으면 블록 댓글 스레드의 구성원, 없으면 문서 전체 댓글."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="comments")
    thread = models.ForeignKey(
        CommentThread,
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name="comments",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="document_comments",
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "document_comments"
        # 스레드 내부에선 오래된 것 먼저(대화 흐름), 스레드 없는 문서-전체 댓글은 최신순 상단이라
        # view 레벨에서 필요 시 재정렬. 기본은 시간 오름차순 — 스레드 표시에 유리.
        ordering = ["created_at"]
        indexes = [models.Index(fields=["thread", "created_at"])]


class DocumentTemplate(models.Model):
    """문서 템플릿 — 빈 문서 대신 미리 정의된 구조로 시작할 수 있도록.

    범위(scope):
      built_in  — 시스템 내장 (관리자만 수정, 모든 사용자에게 노출)
      user      — 본인 전용 (owner만 조회/사용/삭제)
      workspace — 워크스페이스 공유 (멤버 전체 조회/사용, 관리자 삭제)
    """

    class Scope(models.TextChoices):
        BUILT_IN = "built_in", "Built-in"
        USER = "user", "User"
        WORKSPACE = "workspace", "Workspace"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    description = models.CharField(max_length=500, blank=True, default="")
    icon_prop = models.JSONField(null=True, blank=True, default=None)

    scope = models.CharField(max_length=16, choices=Scope.choices, default=Scope.USER)
    workspace = models.ForeignKey(
        "workspaces.Workspace",
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name="document_templates",
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name="document_templates",
    )

    content_html = models.TextField(blank=True, default="")
    sort_order = models.IntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="created_document_templates",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "document_templates"
        ordering = ["scope", "sort_order", "name"]
        indexes = [
            models.Index(fields=["scope", "workspace"]),
            models.Index(fields=["scope", "owner"]),
        ]


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
