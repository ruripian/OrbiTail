import uuid
from django.db import models
from django.conf import settings
from django.utils import timezone


class Workspace(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True, max_length=255)
    # 워크스페이스 소개/용도 — General 설정 탭에서 편집. 빈 문자열 허용.
    description = models.TextField(blank=True, default="")
    logo = models.ImageField(upload_to="workspace_logos/", blank=True, null=True)
    # owner 가 계정 삭제될 수 있으므로 SET_NULL — 워크스페이스는 다른 어드민이 운영 지속.
    # 운영상 마지막 owner 가 사라지면 다른 멤버를 owner 로 승격해야 함.
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="owned_workspaces",
    )
    # 우선순위별 색상 커스터마이징 (워크스페이스 단위)
    # 구조: {"urgent": "#ff4444", "high": "#ff4db8", "medium": "#f5c400", "low": "#aaff00", "none": "#6b7080"}
    # 빈 dict = 프론트엔드 tokens.css 기본값 사용
    priority_colors = models.JSONField(default=dict, blank=True)
    # 브랜드 색 — 워크스페이스 아바타/액센트 등 보조 사용. CSS color (hex/hsl).
    # 빈 문자열 = 프론트엔드 토큰의 --primary 사용
    brand_color = models.CharField(max_length=32, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workspaces"

    def __str__(self):
        return self.name


class WorkspaceMember(models.Model):
    class Role(models.IntegerChoices):
        GUEST = 10, "Guest"
        MEMBER = 15, "Member"
        ADMIN = 20, "Admin"
        OWNER = 25, "Owner"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="members")
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workspace_memberships",
    )
    role = models.IntegerField(choices=Role.choices, default=Role.MEMBER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "workspace_members"
        unique_together = [["workspace", "member"]]

    def __str__(self):
        return f"{self.member.email} in {self.workspace.name}"


class WorkspaceInvitation(models.Model):
    """워크스페이스 이메일 초대 — 이메일 강제 매칭 방식"""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        REVOKED = "revoked", "Revoked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="invitations"
    )
    # 초대 대상 이메일 — 이 이메일로 가입한 유저만 수락 가능
    email = models.EmailField()
    token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    # 초대 시 부여할 역할 (WorkspaceMember.Role과 동일한 값 사용)
    role = models.IntegerField(
        choices=WorkspaceMember.Role.choices, default=WorkspaceMember.Role.MEMBER
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="sent_invitations",
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    message = models.TextField(blank=True, default="")
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "workspace_invitations"
        # 같은 워크스페이스에 같은 이메일로 중복 pending 초대 방지
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "email"],
                condition=models.Q(status="pending"),
                name="unique_pending_invitation",
            )
        ]

    def is_valid(self):
        """만료되지 않았고 아직 pending 상태인지 확인"""
        return self.status == self.Status.PENDING and self.expires_at > timezone.now()

    def __str__(self):
        return f"Invite {self.email} → {self.workspace.name} ({self.status})"


class WorkspaceJoinRequest(models.Model):
    """초대 없이 사용자가 직접 워크스페이스 가입을 신청 — 워크스페이스 관리자 승인이 필요.

    - 초대(WorkspaceInvitation)는 관리자가 먼저 발송한 후 사용자가 수락 (push)
    - 가입 신청(WorkspaceJoinRequest)은 사용자가 먼저 신청한 후 관리자가 승인 (pull)
    승인되면 WorkspaceMember(role=MEMBER)가 생성되고 신청은 APPROVED 상태로 마무리.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELED = "canceled", "Canceled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="join_requests"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="join_requests",
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    message = models.TextField(blank=True, default="")
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="decided_join_requests",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workspace_join_requests"
        # 같은 사용자가 같은 워크스페이스에 동시에 여러 pending 신청 못함
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user"],
                condition=models.Q(status="pending"),
                name="unique_pending_join_request",
            )
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"JoinRequest {self.user.email} → {self.workspace.name} ({self.status})"


class Team(models.Model):
    """워크스페이스 안의 멤버 그룹.

    - 한 워크스페이스 안에 여러 팀, 멤버는 여러 팀 소속 가능
    - 비공개 옵션 없음(이번 정책): 팀 정보(이름/멤버) 는 워크스페이스 멤버 누구나 조회 가능.
      단 사이드바 자동 노출은 "본인이 멤버인 팀" 으로 한정 — 탐색 페이지는 별도 phase.
    - 이슈/PE 접근권은 Team role 과 무관: 비공개 프로젝트 이슈는 그 프로젝트 멤버에게만,
      PE 는 본인에게만. Team admin 권한은 팀 관리(이름/멤버/색 편집) 한정.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="teams",
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default="")
    # 캘린더 chip 색 / 팀 아바타 배경에 사용. 빈 문자열 = 토큰 default.
    color = models.CharField(max_length=32, blank=True, default="")
    # 다른 도메인(프로젝트/문서스페이스)과 일관된 아이콘 prop ({type, name, color})
    icon_prop = models.JSONField(null=True, blank=True, default=None)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="created_teams",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "teams"
        ordering = ["name"]
        # 같은 워크스페이스 안 팀 이름 중복 방지 — 사이드바/멘션 모호성 회피
        unique_together = [["workspace", "name"]]
        indexes = [models.Index(fields=["workspace"])]

    def __str__(self):
        return f"Team[{self.workspace.slug}] {self.name}"


class TeamMember(models.Model):
    """팀 멤버십.

    role:
      - MEMBER: 팀 일원 (이름/멤버 조회, 본인 정보)
      - ADMIN:  + 팀 이름/색/멤버 편집 권한
    이슈/PE 접근권은 ProjectMember / PE.user 정책이 결정 — 여기 role 과 무관.

    title 은 role 과 무관한 **표시 전용** 직책이다("프론트엔드", "PM").
    권한 판정에 절대 쓰지 말 것 — 권한은 role 하나로만 결정한다.
    """

    class Role(models.IntegerChoices):
        MEMBER = 15, "Member"
        ADMIN = 20, "Admin"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name="members",
    )
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="team_memberships",
    )
    role = models.IntegerField(choices=Role.choices, default=Role.MEMBER)
    # 표시 전용 직책. 빈 문자열 = 미지정.
    title = models.CharField(max_length=50, blank=True, default="")
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="added_team_members",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "team_members"
        unique_together = [["team", "member"]]
        indexes = [models.Index(fields=["member"])]

    def __str__(self):
        return f"{self.member.email} in {self.team.name}"


class WorkspaceActivity(models.Model):
    """워크스페이스 관리 기록 — 누가 언제 무엇을 관리했나.

    관리자는 문서·이슈 내용을 보지 않고도 비공개 프로젝트·스페이스를 관리할 수 있다. 그 대신 관리 동작은
    전부 여기 남는다 — 특히 "관리자가 비공개 스페이스에 자기를 멤버로 추가했다" 같은 일이 나중에 보여야 한다.
    내용 변경(이슈 수정 등)은 기록하지 않는다. 그건 각 이슈·문서의 이력이 맡는다.

    target_label 은 대상이 지워진 뒤에도 무엇이었는지 읽을 수 있게 남기는 스냅샷이다.
    """

    class Action(models.TextChoices):
        PROJECT_TRASHED = "project.trashed"
        PROJECT_RESTORED = "project.restored"
        PROJECT_PURGED = "project.purged"
        PROJECT_ARCHIVED = "project.archived"
        PROJECT_UNARCHIVED = "project.unarchived"
        PROJECT_LEAD_CHANGED = "project.lead_changed"
        PROJECT_MEMBER_ADDED = "project.member_added"
        PROJECT_MEMBER_REMOVED = "project.member_removed"
        PROJECT_MEMBER_ROLE = "project.member_role"
        SPACE_VISIBILITY = "space.visibility"
        SPACE_ARCHIVED = "space.archived"
        SPACE_UNARCHIVED = "space.unarchived"
        SPACE_DELETED = "space.deleted"
        SPACE_MEMBER_ADDED = "space.member_added"
        SPACE_MEMBER_REMOVED = "space.member_removed"
        SPACE_MEMBER_ROLE = "space.member_role"
        PERSONAL_SPACE_DELETED = "space.personal_deleted"
        MEMBER_ROLE = "member.role"
        MEMBER_REMOVED = "member.removed"
        INVITATION_SENT = "invitation.sent"
        INVITATION_REVOKED = "invitation.revoked"
        JOIN_APPROVED = "join.approved"
        JOIN_REJECTED = "join.rejected"
        TEAM_DELETED = "team.deleted"
        API_TOKEN_CREATED = "api_token.created"
        API_TOKEN_REVOKED = "api_token.revoked"
        WEBHOOK_CREATED = "webhook.created"
        WEBHOOK_UPDATED = "webhook.updated"
        WEBHOOK_DELETED = "webhook.deleted"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="activities")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name="+")
    actor_label = models.CharField(max_length=255, blank=True, default="")
    action = models.CharField(max_length=40, choices=Action.choices)
    target_type = models.CharField(max_length=20, blank=True, default="")
    target_id = models.UUIDField(null=True, blank=True)
    target_label = models.CharField(max_length=255, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "workspace_activities"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "-created_at"]), models.Index(fields=["workspace", "action"])]


def log_workspace_activity(workspace, actor, action, *, target=None, target_type="", target_label="", **metadata):
    """관리 기록 한 줄. 실패해도 관리 동작 자체를 되돌리지 않는다 — 기록은 부수 효과다."""
    try:
        if target is not None:
            target_type = target_type or target._meta.model_name
            target_label = target_label or str(getattr(target, "name", None) or getattr(target, "title", None) or target)
        return WorkspaceActivity.objects.create(
            workspace_id=getattr(workspace, "pk", workspace),
            actor=actor if getattr(actor, "is_authenticated", False) else None,
            actor_label=(actor.display_name or actor.email) if getattr(actor, "is_authenticated", False) else "",
            action=action,
            target_type=target_type,
            target_id=getattr(target, "pk", None),
            target_label=target_label[:255],
            metadata=metadata,
        )
    except Exception:
        return None
