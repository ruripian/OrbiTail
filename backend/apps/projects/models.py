import uuid
from django.db import models
from django.conf import settings


class Project(models.Model):
    class Network(models.IntegerChoices):
        PUBLIC = 0, "Public"
        SECRET = 2, "Secret"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    identifier = models.CharField(max_length=12)  # e.g. "OUR"
    description = models.TextField(blank=True, default="")
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="projects"
    )
    network = models.IntegerField(choices=Network.choices, default=Network.SECRET)
    icon_prop = models.JSONField(null=True, blank=True)  # emoji or icon data
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_projects",
    )
    # 프로젝트 리더 — 대표 책임자 표시용(권한은 ProjectMember.Role로 관리)
    lead = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="led_projects",
    )
    # 프로젝트 보관 — null이면 활성, 값이 있으면 보관됨
    archived_at = models.DateTimeField(null=True, blank=True)
    # 완료/취소 상태 이슈 자동 보관 일수 — null이면 비활성
    auto_archive_days = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "projects"
        unique_together = [["workspace", "identifier"]]

    def __str__(self):
        return f"{self.identifier} - {self.name}"


class ProjectMember(models.Model):
    class Role(models.IntegerChoices):
        VIEWER = 10, "Viewer"
        MEMBER = 15, "Member"
        ADMIN = 20, "Admin"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="members")
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_memberships",
    )
    role = models.IntegerField(choices=Role.choices, default=Role.MEMBER)
    # 세분화 권한 — 역할이 ADMIN 미만이어도 개별 부여 가능.
    # 프론트는 effective_perms로 합쳐서 가드.
    can_edit    = models.BooleanField(default=True)   # 이슈/필드 수정
    can_archive = models.BooleanField(default=False)  # 보관함 이동 (소프트)
    can_delete  = models.BooleanField(default=False)  # 휴지통 이동 (소프트 삭제)
    can_purge   = models.BooleanField(default=False)  # 휴지통에서 영구 삭제
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "project_members"
        unique_together = [["project", "member"]]

    @property
    def effective_perms(self) -> dict:
        """역할(role)이 ADMIN이면 모든 권한 자동 허용. 그 미만은 플래그 값 사용."""
        if self.role >= self.Role.ADMIN:
            return {"can_edit": True, "can_archive": True, "can_delete": True, "can_purge": True}
        return {
            "can_edit":    self.can_edit,
            "can_archive": self.can_archive,
            "can_delete":  self.can_delete,
            "can_purge":   self.can_purge,
        }


class Category(models.Model):
    """프로젝트 내 소규모 작업 단위 — 이슈를 논리적으로 그룹핑"""

    class Status(models.TextChoices):
        BACKLOG = "backlog", "Backlog"
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="categories")
    icon_prop = models.JSONField(null=True, blank=True)  # {"name": "Box", "color": "#..."} — lucide 아이콘 선택
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.BACKLOG)
    lead = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="led_categories",
    )
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "project_modules"
        ordering = ["sort_order", "-created_at"]

    def __str__(self):
        return f"{self.project.identifier} / {self.name}"


class Sprint(models.Model):
    """스프린트 — 기간 기반 이슈 묶음"""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="sprints")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    start_date = models.DateField()
    end_date = models.DateField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_sprints",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "project_cycles"
        ordering = ["-start_date"]

    def __str__(self):
        return f"{self.project.identifier} / {self.name}"


class ProjectEvent(models.Model):
    """프로젝트 캘린더 이벤트 — 이슈가 아닌 1회성/기간 일정 (회의/출장/마일스톤 등).
    캘린더 탭에만 표시됨. 프로젝트 멤버 누구나 생성/수정/삭제 가능."""

    class EventType(models.TextChoices):
        MEETING      = "meeting",      "회의"
        TRIP         = "trip",         "출장"
        DEADLINE     = "deadline",     "마감"
        PRESENTATION = "presentation", "발표"
        MILESTONE    = "milestone",    "마일스톤"
        OTHER        = "other",        "기타"

    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project     = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="events")
    title       = models.CharField(max_length=255)
    date        = models.DateField()  # 시작일
    end_date    = models.DateField(null=True, blank=True)  # 선택 (기간 이벤트)
    event_type  = models.CharField(max_length=20, choices=EventType.choices, default=EventType.OTHER)
    color       = models.CharField(max_length=7, default="#5E6AD2")  # hex
    description = models.TextField(blank=True, default="")
    # is_global=True (기본): 이 프로젝트의 모든 멤버에게 해당되는 일정.
    #   → 누구나 "내 일정" 필터에서도 보임. 사실상 participants 미지정 = 전체 선택.
    # is_global=False: 명시된 participants 에게만 해당. "내 일정"은 본인이 포함될 때만 표시.
    is_global   = models.BooleanField(default=True)
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="participating_events",
        blank=True,
    )
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="created_events",
    )
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "project_events"
        ordering = ["date"]

    def __str__(self):
        return f"{self.project.identifier} / {self.title} ({self.date})"


class State(models.Model):
    """Issue states (columns) for a project"""

    class Group(models.TextChoices):
        BACKLOG = "backlog", "Backlog"
        UNSTARTED = "unstarted", "Unstarted"
        STARTED = "started", "Started"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="states")
    color = models.CharField(max_length=255)
    group = models.CharField(max_length=20, choices=Group.choices, default=Group.BACKLOG)
    sequence = models.FloatField(default=65535)
    default = models.BooleanField(default=False)

    class Meta:
        db_table = "project_states"
        ordering = ["sequence"]

    def __str__(self):
        return f"{self.project.identifier} / {self.name}"
