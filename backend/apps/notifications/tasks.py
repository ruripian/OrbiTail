"""
알림 관련 Celery 태스크

- 30일 이상 된 알림 자동 삭제 (매일 새벽 4시)
- 알림 이메일 발송 (사용자 prefs 확인)
"""

from datetime import timedelta
import logging

from celery import shared_task
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task
def cleanup_old_notifications():
    """30일 이상 된 알림을 자동 삭제"""
    from .models import Notification

    cutoff = timezone.now() - timedelta(days=30)
    deleted, _ = Notification.objects.filter(created_at__lt=cutoff).delete()
    return f"Deleted {deleted} old notifications"


# 알림 타입별 한/영 라벨 — 메일 제목 및 본문 헤더에 사용
_TYPE_LABELS = {
    "issue_assigned": {"ko": "이슈 배정", "en": "Issue Assigned"},
    "issue_updated": {"ko": "이슈 변경", "en": "Issue Updated"},
    "comment_added": {"ko": "새 댓글", "en": "New Comment"},
    "issue_created": {"ko": "새 이슈", "en": "New Issue"},
}


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_notification_email(self, recipient_id, ntype, message, issue_id, actor_name, project_id=None):
    """알림 이메일 발송 — 전역 + 프로젝트 prefs 둘 다 확인 후 실제 전송.

    - prefs가 끄면 조용히 종료
    - 렌더 실패/SMTP 에러는 재시도(60초 간격, 최대 3회)
    """
    from .models import NotificationPreference

    User = get_user_model()
    try:
        recipient = User.objects.select_related().get(id=recipient_id)
    except User.DoesNotExist:
        return "recipient gone"

    if not recipient.email or not recipient.is_active:
        return "no email or inactive"

    project = None
    if project_id:
        from apps.projects.models import Project
        project = Project.objects.filter(id=project_id).first()

    prefs = NotificationPreference.for_user(recipient)
    if not prefs.email_allowed(ntype, project=project):
        return "opted out"

    lang = (recipient.language or "ko").lower()
    if lang not in ("ko", "en"):
        lang = "ko"

    type_label = _TYPE_LABELS.get(ntype, {}).get(lang, ntype)
    subject = f"[OrbiTail] {type_label}"

    # 이슈 딥링크 — 워크스페이스/프로젝트 정보가 필요하므로 lazy 로딩
    issue_url = settings.FRONTEND_URL
    issue_title = ""
    if issue_id:
        from apps.issues.models import Issue
        try:
            issue = Issue.objects.select_related("project", "workspace").get(id=issue_id)
            issue_title = issue.title
            issue_url = (
                f"{settings.FRONTEND_URL.rstrip('/')}/"
                f"{issue.workspace.slug}/projects/{issue.project_id}/issues/{issue.id}"
            )
        except Issue.DoesNotExist:
            pass

    ctx = {
        "type_label": type_label,
        "message": message,
        "actor_name": actor_name,
        "issue_title": issue_title,
        "issue_url": issue_url,
        "recipient_name": recipient.display_name,
        "frontend_url": settings.FRONTEND_URL.rstrip("/"),
        "settings_url": f"{settings.FRONTEND_URL.rstrip('/')}/settings/preferences",
        "lang": lang,
    }

    try:
        text_body = render_to_string("notifications/email/notification.txt", ctx)
        html_body = render_to_string("notifications/email/notification.html", ctx)
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[recipient.email],
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send(fail_silently=False)
        return f"sent to {recipient.email}"
    except Exception as exc:  # SMTP/template 등
        logger.warning("notification email failed: %s", exc)
        raise self.retry(exc=exc)
