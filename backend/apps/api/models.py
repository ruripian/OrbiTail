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
