from datetime import timedelta

from celery import shared_task
from django.utils import timezone


@shared_task
def auto_archive_completed_issues():
    """
    auto_archive_days가 설정된 프로젝트에서
    완료/취소 상태인 이슈를 소프트 삭제(보관)한다.
    매일 새벽 3시에 실행된다.
    """
    from apps.projects.models import Project
    from apps.issues.models import Issue

    projects = Project.objects.filter(
        auto_archive_days__isnull=False,
        archived_at__isnull=True,
    )
    now = timezone.now()
    total = 0

    for project in projects:
        cutoff = now - timedelta(days=project.auto_archive_days)
        count = Issue.objects.filter(
            project=project,
            state__group__in=["completed", "cancelled"],
            updated_at__lte=cutoff,
            deleted_at__isnull=True,
        ).update(deleted_at=now)
        total += count

    return f"Archived {total} issues"


@shared_task
def auto_complete_expired_sprints():
    """
    종료일(end_date)이 지난 active 스프린트를 자동으로 completed 상태로 변경한다.
    매일 새벽 3시 30분에 실행된다.
    """
    from apps.projects.models import Sprint

    today = timezone.now().date()
    count = Sprint.objects.filter(
        status="active",
        end_date__lt=today,
    ).update(status="completed")

    return f"Completed {count} expired sprints"


TRASH_RETENTION_DAYS = 30  # 휴지통 보관 기간 (일)


@shared_task
def permanently_delete_trashed_issues():
    """
    소프트 삭제(deleted_at) 후 30일이 경과한 이슈를 영구 삭제한다.
    첨부파일도 디스크에서 함께 제거.
    매일 새벽 4시에 실행된다.
    """
    from apps.issues.models import Issue, IssueAttachment

    cutoff = timezone.now() - timedelta(days=TRASH_RETENTION_DAYS)
    expired = Issue.objects.filter(
        deleted_at__isnull=False,
        deleted_at__lte=cutoff,
    )
    count = expired.count()

    # 첨부파일 디스크 삭제
    for att in IssueAttachment.objects.filter(issue__in=expired).iterator():
        if att.file:
            att.file.delete(save=False)

    # 이슈 영구 삭제 (CASCADE로 댓글/활동/링크/첨부 DB 레코드 함께 삭제)
    expired.delete()

    return f"Permanently deleted {count} trashed issues"
