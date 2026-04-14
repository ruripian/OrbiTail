import uuid
from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """관리자 행위 감사 로그 — 복구 불가능한 삭제/권한 변경 추적용

    actor가 null이면 시스템 자동 작업(첫 가입자 부트스트랩 등).
    target_label은 삭제 이후에도 인간이 읽을 수 있도록 스냅샷으로 보관.
    """

    class Action(models.TextChoices):
        SUPERUSER_GRANT   = "superuser_grant",   "Grant superuser"
        SUPERUSER_REVOKE  = "superuser_revoke",  "Revoke superuser"
        USER_APPROVE      = "user_approve",      "Approve user"
        USER_SUSPEND      = "user_suspend",      "Suspend user"
        USER_UNSUSPEND    = "user_unsuspend",    "Unsuspend user"
        USER_DELETE       = "user_delete",       "Delete user"
        WORKSPACE_CREATE  = "workspace_create",  "Create workspace"
        WORKSPACE_DELETE  = "workspace_delete",  "Delete workspace"
        WORKSPACE_OWNER   = "workspace_owner",   "Transfer workspace owner"

    class TargetType(models.TextChoices):
        USER      = "user",      "User"
        WORKSPACE = "workspace", "Workspace"

    id           = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor        = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="audit_logs",
    )
    actor_label  = models.CharField(max_length=255, blank=True, default="")
    action       = models.CharField(max_length=32, choices=Action.choices)
    target_type  = models.CharField(max_length=16, choices=TargetType.choices)
    target_id    = models.UUIDField(null=True, blank=True)
    target_label = models.CharField(max_length=255, blank=True, default="")
    metadata     = models.JSONField(default=dict, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "audit_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["action", "-created_at"]),
            models.Index(fields=["target_type", "-created_at"]),
        ]

    def __str__(self):
        return f"[{self.created_at:%Y-%m-%d %H:%M}] {self.actor_label or '-'} {self.action} {self.target_label}"


def log_admin_action(
    *,
    actor,
    action: str,
    target_type: str,
    target_id=None,
    target_label: str = "",
    metadata: dict | None = None,
) -> AuditLog:
    """관리자 행위 기록 헬퍼 — 모든 admin 엔드포인트에서 호출"""
    return AuditLog.objects.create(
        actor=actor if (actor and getattr(actor, "is_authenticated", False)) else None,
        actor_label=(actor.email if (actor and getattr(actor, "is_authenticated", False)) else ""),
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_label=target_label,
        metadata=metadata or {},
    )
