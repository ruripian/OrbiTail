from datetime import timedelta

from celery import shared_task
from django.utils import timezone


@shared_task
def permanently_delete_trashed_projects():
    """휴지통에서 보관 기간이 지난 프로젝트를 영구 삭제한다 — 이슈·문서 스페이스가 함께 지워진다."""
    from apps.projects.models import Project

    cutoff = timezone.now() - timedelta(days=Project.TRASH_RETENTION_DAYS)
    expired = Project.all_objects.filter(deleted_at__lte=cutoff)
    count = 0
    for project in expired:
        # 하나씩 지운다 — 문서 스페이스를 지우는 pre_delete 시그널이 프로젝트마다 돌아야 한다
        project.delete()
        count += 1
    return f"Deleted {count} trashed projects"
