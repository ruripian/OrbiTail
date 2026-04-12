"""
알림 시그널 — 이슈 변경/댓글/담당자 배정 시 알림 자동 생성 + WebSocket 브로드캐스트

트리거:
  1. IssueActivity post_save → 이슈 담당자에게 변경 알림 + WS 브로드캐스트
  2. IssueComment post_save → 이슈 담당자 + 생성자에게 댓글 알림 + WS 브로드캐스트
  3. Issue m2m_changed (assignees) → 새로 배정된 담당자에게 알림
"""

from django.db.models.signals import post_save, m2m_changed
from django.dispatch import receiver
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

from apps.issues.models import Issue, IssueActivity, IssueComment
from .models import Notification


def _get_channel_layer():
    """channel layer를 안전하게 가져오는 헬퍼"""
    try:
        return get_channel_layer()
    except Exception:
        return None


def _broadcast_to_workspace(workspace_slug, event):
    """워크스페이스 그룹에 WebSocket 이벤트 브로드캐스트"""
    channel_layer = _get_channel_layer()
    if not channel_layer:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            f"workspace_{workspace_slug}",
            event,
        )
    except Exception:
        # Redis 연결 실패 등 — 알림 생성은 계속 진행
        pass


def _issue_breadcrumb(issue) -> str:
    """이슈 표시명 — 부모가 있으면 'Parent → Title' 한 줄로.

    한 단계만 표시(조부모까지는 안 감) — 메시지 길이 트레이드오프.
    parent FK는 lazy 로드되므로 호출 측에서 select_related 필수 아님.
    """
    if issue.parent_id and issue.parent:
        return f"{issue.parent.title} → {issue.title}"
    return issue.title


def _create_notifications(recipients, actor, issue, ntype, message):
    """알림 일괄 생성 헬퍼 — actor 본인은 제외, WebSocket으로 실시간 전달.

    추가로 각 수신자의 prefs를 확인해 이메일 발송 태스크를 큐에 적재.
    prefs 체크는 Celery 태스크 안에서 다시 한번 — 큐 적재 후 사용자가 끄는 경우 대비.
    """
    targets = [u for u in recipients if u.id != actor.id]
    if not targets:
        return

    Notification.objects.bulk_create([
        Notification(
            recipient=user,
            actor=actor,
            type=ntype,
            issue=issue,
            workspace=issue.workspace,
            message=message,
        )
        for user in targets
    ])

    # WebSocket 알림 브로드캐스트
    _broadcast_to_workspace(issue.workspace.slug, {
        "type": "notification.new",
        "notification_type": ntype,
        "message": message,
        "issue_id": str(issue.id),
        "project_id": str(issue.project_id),
        "actor_name": actor.display_name,
    })

    # 이메일 발송 — Celery 태스크로 위임 (실패해도 인앱 알림은 보존)
    from .tasks import send_notification_email
    project_id = str(issue.project_id) if issue else None
    for user in targets:
        try:
            send_notification_email.delay(
                recipient_id=str(user.id),
                ntype=ntype,
                message=message,
                issue_id=str(issue.id) if issue else None,
                actor_name=actor.display_name,
                project_id=project_id,
            )
        except Exception:
            # 브로커 다운 등 — 인앱 알림 흐름은 막지 않음
            pass


@receiver(post_save, sender=IssueActivity)
def notify_on_issue_activity(sender, instance, created, **kwargs):
    """이슈 변경 시 담당자들에게 알림 + WebSocket 브로드캐스트"""
    if not created:
        return

    activity = instance
    issue = activity.issue
    actor = activity.actor

    if not actor:
        return

    # WebSocket: 이슈 업데이트 이벤트 (모든 워크스페이스 멤버에게)
    _broadcast_to_workspace(issue.workspace.slug, {
        "type": "issue.updated",
        "issue_id": str(issue.id),
        "project_id": str(issue.project_id),
        "field": activity.field,
        "actor_name": actor.display_name,
    })

    # 이슈 담당자 목록
    assignees = list(issue.assignees.all())
    if not assignees:
        return

    # 변경 내용을 메시지로 구성 — 프로젝트 + 부모 컨텍스트 포함
    field = activity.field or activity.verb
    breadcrumb = _issue_breadcrumb(issue)
    project_name = issue.project.name
    if activity.new_value:
        message = f"{actor.display_name}님이 {project_name}에서 '{breadcrumb}'의 {field}을(를) 변경했습니다."
    else:
        message = f"{actor.display_name}님이 {project_name}에서 '{breadcrumb}'을(를) 업데이트했습니다."

    _create_notifications(
        recipients=assignees,
        actor=actor,
        issue=issue,
        ntype=Notification.Type.ISSUE_UPDATED,
        message=message,
    )


@receiver(post_save, sender=IssueComment)
def notify_on_comment(sender, instance, created, **kwargs):
    """댓글 작성 시 이슈 담당자 + 생성자에게 알림"""
    if not created:
        return

    comment = instance
    issue = comment.issue
    actor = comment.actor

    # 알림 대상: 이슈 담당자 + 이슈 생성자 (중복 제거)
    recipients_ids = set(issue.assignees.values_list("id", flat=True))
    if issue.created_by_id:
        recipients_ids.add(issue.created_by_id)

    from django.contrib.auth import get_user_model
    User = get_user_model()
    recipients = list(User.objects.filter(id__in=recipients_ids))

    message = (
        f"{actor.display_name}님이 {issue.project.name}에서 "
        f"'{_issue_breadcrumb(issue)}'에 댓글을 남겼습니다."
    )

    _create_notifications(
        recipients=recipients,
        actor=actor,
        issue=issue,
        ntype=Notification.Type.COMMENT_ADDED,
        message=message,
    )


@receiver(post_save, sender=Issue)
def notify_on_issue_created(sender, instance, created, **kwargs):
    """프로젝트 새 이슈 — 해당 프로젝트의 `email_issue_created` 구독자에게 알림.

    프로젝트별 opt-in 이라 기본 동작은 비활성. 일반 이슈 생성과 무관하게 동작.
    """
    if not created:
        return
    issue = instance
    actor = issue.created_by
    if not actor:
        return

    from .models import ProjectNotificationPreference
    subscribers_qs = (
        ProjectNotificationPreference.objects
        .filter(project=issue.project, email_issue_created=True, muted=False)
        .exclude(user=actor)
        .select_related("user")
    )
    recipients = [p.user for p in subscribers_qs if p.user.is_active]
    if not recipients:
        return

    if issue.parent_id and issue.parent:
        message = (
            f"{actor.display_name}님이 {issue.project.name}에서 "
            f"'{issue.parent.title}' 아래에 새 이슈 '{issue.title}'을(를) 생성했습니다."
        )
    else:
        message = (
            f"{actor.display_name}님이 {issue.project.name}에 "
            f"새 이슈 '{issue.title}'을(를) 생성했습니다."
        )
    _create_notifications(
        recipients=recipients,
        actor=actor,
        issue=issue,
        ntype=Notification.Type.ISSUE_CREATED,
        message=message,
    )


@receiver(m2m_changed, sender=Issue.assignees.through)
def notify_on_assignee_added(sender, instance, action, pk_set, **kwargs):
    """이슈에 담당자가 추가되면 해당 담당자에게 알림"""
    if action != "post_add" or not pk_set:
        return

    issue = instance

    # actor 추론: 가장 최근 activity의 actor, 없으면 이슈 생성자
    latest_activity = (
        IssueActivity.objects.filter(issue=issue)
        .order_by("-created_at")
        .first()
    )
    actor = latest_activity.actor if latest_activity else issue.created_by
    if not actor:
        return

    from django.contrib.auth import get_user_model
    User = get_user_model()
    new_assignees = list(User.objects.filter(id__in=pk_set))

    message = (
        f"{actor.display_name}님이 {issue.project.name}에서 "
        f"'{_issue_breadcrumb(issue)}'에 담당자로 배정했습니다."
    )

    _create_notifications(
        recipients=new_assignees,
        actor=actor,
        issue=issue,
        ntype=Notification.Type.ISSUE_ASSIGNED,
        message=message,
    )
