import uuid

from django.conf import settings
from django.db import models


class DemoSandbox(models.Model):
    """방문자 1명분의 격리된 데모 공간.

    데모 모드에서 방문자가 "데모 시작"을 누르면 샌드박스가 하나 생긴다.
    샌드박스는 전용 유저 몇 명(방문자 본인 + 동료 역할 더미)과 그들이 소유한
    워크스페이스로 이루어지며, 다른 방문자의 샌드박스와 완전히 분리된다.

    정리(24시간 경과분 삭제)는 apps.demo.tasks.purge_expired_sandboxes 가 한다.
    Workspace.owner 가 SET_NULL 이라 유저를 지워도 워크스페이스가 남으므로,
    삭제 순서를 지키기 위해 소유 워크스페이스를 명시적으로 들고 있는다.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # 방문자 본인 계정. 삭제 시 샌드박스 레코드도 함께 사라진다.
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="demo_sandbox",
    )

    # 이 샌드박스에 속한 모든 유저의 이메일 도메인.
    # "visitor@<hex>.demo.invalid" 처럼 샌드박스마다 고유하게 발급해,
    # 정리 시 동료 더미 계정까지 정확히 골라낼 수 있게 한다.
    email_domain = models.CharField(max_length=100, unique=True)

    # 이 샌드박스가 만든 워크스페이스. 유저보다 먼저 지워야 한다.
    workspaces = models.ManyToManyField(
        "workspaces.Workspace",
        related_name="demo_sandboxes",
        blank=True,
    )

    # 세션 생성 rate limit 용 — 원본 IP 가 아니라 해시만 보관한다.
    client_hash = models.CharField(max_length=64, blank=True, default="", db_index=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    last_seen_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "demo_sandboxes"

    def __str__(self):
        return f"sandbox {self.email_domain}"
