"""만료된 데모 샌드박스 정리."""
import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import DemoSandbox
from .sandbox import delete_sandbox

logger = logging.getLogger(__name__)


@shared_task
def purge_expired_sandboxes() -> int:
    """TTL 이 지난 샌드박스를 통째로 삭제하고 삭제 건수를 돌려준다.

    데모 모드가 꺼져 있어도 돈다. 데모를 끈 뒤에도 남은 샌드박스는
    정리돼야 하기 때문이다.

    샌드박스마다 개별 트랜잭션으로 지운다(delete_sandbox 가 atomic).
    하나가 실패해도 나머지 정리는 계속된다.
    """
    cutoff = timezone.now() - timedelta(hours=settings.DEMO_SANDBOX_TTL_HOURS)
    expired = DemoSandbox.objects.filter(created_at__lt=cutoff)

    deleted = 0
    for sandbox in expired.iterator():
        try:
            delete_sandbox(sandbox)
            deleted += 1
        except Exception:
            logger.exception("데모 샌드박스 삭제 실패: %s", sandbox.email_domain)

    if deleted:
        logger.info("만료된 데모 샌드박스 %d개 삭제", deleted)
    return deleted
