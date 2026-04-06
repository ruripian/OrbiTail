import os
from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

app = Celery("ouroboros")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# 주기적 태스크 — 매일 새벽 3시에 완료/취소 이슈 자동 보관
app.conf.beat_schedule = {
    "auto-archive-completed-issues": {
        "task": "apps.issues.tasks.auto_archive_completed_issues",
        "schedule": crontab(hour=3, minute=0),
    },
    # 종료일 지난 스프린트 자동 완료 — 매일 새벽 3시 30분
    "auto-complete-expired-sprints": {
        "task": "apps.issues.tasks.auto_complete_expired_sprints",
        "schedule": crontab(hour=3, minute=30),
    },
    # 30일 이상 된 알림 자동 삭제 — 매일 새벽 4시
    "cleanup-old-notifications": {
        "task": "apps.notifications.tasks.cleanup_old_notifications",
        "schedule": crontab(hour=4, minute=0),
    },
    # 휴지통 30일 경과 이슈 영구 삭제 — 매일 새벽 4시 30분
    "permanently-delete-trashed-issues": {
        "task": "apps.issues.tasks.permanently_delete_trashed_issues",
        "schedule": crontab(hour=4, minute=30),
    },
}
