"""공개 API 통합 토큰.

토큰은 **발급한 사람 + 워크스페이스**에 묶인다(GitHub·Linear 의 개인 토큰 방식).
토큰으로 들어온 요청은 발급자 본인으로 처리되므로, 기존 권한 규칙(프로젝트 멤버십,
문서 스페이스 접근)을 그대로 따르고 발급자의 권한을 넘을 수 없다.
별도의 봇 계정을 두지 않은 이유: 봇에게 무엇을 보여줄지 정하는 공유 모델이 새로 필요해진다.

토큰 원문은 저장하지 않는다. 발급 응답에서 한 번만 보여 주고 SHA-256 지문만 남긴다.
원문이 32바이트 난수라 느린 해시(bcrypt 등)가 필요 없다 — 사전 대입이 성립하지 않는다.
"""
import hashlib
import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

TOKEN_PREFIX = "orbt_"


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class ApiToken(models.Model):
    class Scope(models.TextChoices):
        READ = "read", "Read"
        # write 는 read 를 포함한다
        WRITE = "write", "Read & write"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="api_tokens",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="api_tokens",
    )
    name = models.CharField(max_length=100)
    # 목록에서 어느 토큰인지 알아보게 하는 앞부분. 이것만으로는 인증할 수 없다.
    prefix = models.CharField(max_length=16)
    token_hash = models.CharField(max_length=64, unique=True)
    scope = models.CharField(max_length=8, choices=Scope.choices, default=Scope.READ)
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # 폐기는 행을 지우지 않고 표시만 한다 — "언제 누가 끊었나"가 남아야 한다
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )

    class Meta:
        db_table = "api_tokens"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "user"])]

    def __str__(self):
        return f"{self.name} ({self.prefix}…)"

    @classmethod
    def issue(cls, *, workspace, user, name: str, scope: str, expires_at=None) -> tuple["ApiToken", str]:
        """토큰을 만들고 (행, 원문) 을 돌려준다. 원문은 이 순간에만 존재한다."""
        raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
        token = cls.objects.create(
            workspace=workspace, user=user, name=name, scope=scope, expires_at=expires_at,
            prefix=raw[: len(TOKEN_PREFIX) + 6], token_hash=hash_token(raw),
        )
        return token, raw

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and self.expires_at <= timezone.now()

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and not self.is_expired


class Webhook(models.Model):
    """워크스페이스에서 일어난 일을 외부 주소로 알린다.

    토큰과 같은 원칙: 웹훅은 **만든 사람의 눈**으로 본다. 그 사람이 볼 수 없는 프로젝트·문서의
    이벤트는 보내지 않는다. 만든 사람이 워크스페이스를 떠나면 아무것도 보내지 않는다.
    """

    class Event(models.TextChoices):
        ISSUE_CREATED = "issue.created"
        ISSUE_UPDATED = "issue.updated"
        ISSUE_DELETED = "issue.deleted"
        COMMENT_CREATED = "comment.created"
        DOCUMENT_CREATED = "document.created"
        DOCUMENT_UPDATED = "document.updated"
        DOCUMENT_DELETED = "document.deleted"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="webhooks")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="webhooks")
    name = models.CharField(max_length=100)
    url = models.URLField(max_length=500)
    # 서명용 비밀값. 서명을 만들어야 하므로 토큰과 달리 원문을 둔다. 발급 응답에서만 보여 준다.
    secret = models.CharField(max_length=64)
    events = models.JSONField(default=list)
    is_active = models.BooleanField(default=True)
    # 연속으로 끝내 실패한 발송 수. 받는 쪽이 사라진 웹훅이 재시도로 큐를 계속 채우지 않게 상한에서 끈다.
    consecutive_failures = models.PositiveIntegerField(default=0)
    disabled_reason = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "webhooks"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} → {self.url}"


class WebhookDelivery(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending"
        SUCCESS = "success"
        FAILED = "failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    webhook = models.ForeignKey(Webhook, on_delete=models.CASCADE, related_name="deliveries")
    event = models.CharField(max_length=32)
    payload = models.JSONField()
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    response_status = models.PositiveSmallIntegerField(null=True, blank=True)
    # 받는 쪽 응답 앞부분 — 왜 실패했는지 화면에서 볼 수 있게. 길게 두지 않는다.
    response_body = models.CharField(max_length=1000, blank=True, default="")
    error = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "webhook_deliveries"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["webhook", "-created_at"])]
