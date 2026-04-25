import uuid
from django.db import models
from django.conf import settings
from django.utils import timezone


class Workspace(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True, max_length=255)
    logo = models.ImageField(upload_to="workspace_logos/", blank=True, null=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
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
        on_delete=models.CASCADE,
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
