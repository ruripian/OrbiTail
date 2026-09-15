"""모델 변경 → 웹훅 이벤트.

시그널로 잡는 이유: 이슈·문서는 화면(내부 API)·공개 API·협업 서버 저장·일괄 처리 등 여러 길로
바뀐다. 뷰마다 발송을 붙이면 새 경로가 생길 때 반드시 빠뜨린다.

**합치기**: 한 번의 조작이 저장을 여러 번 일으킨다(이슈 생성 후 담당자·라벨 지정, 편집 중인 문서의
몇 초마다 저장). 첫 변경에 발송을 예약하고 창이 닫힐 때까지 온 변경은 그 한 건에 흡수한다. 발송 시점에
최신 상태를 읽으므로 내용은 빠지지 않는다. 삭제는 대상이 곧 안 보이게 되므로 그 자리에서 내용을 떠 둔다.

웹훅이 하나도 없는 워크스페이스에서는 조회 한 번으로 끝난다.
"""
from django.core.cache import cache
from django.db import transaction
from django.db.models.signals import m2m_changed, post_save
from django.dispatch import receiver

from apps.documents.models import Document
from apps.issues.models import Issue, IssueComment

ISSUE_WINDOW_SECONDS = 5
# 편집 중인 문서는 협업 서버가 몇 초마다 저장한다 — 그대로 보내면 받는 쪽이 감당하지 못한다
DOCUMENT_WINDOW_SECONDS = 60


def _has_hooks(workspace_id) -> bool:
    from .models import Webhook
    return Webhook.objects.filter(workspace_id=workspace_id, is_active=True).exists()


def _dispatch(event, workspace_id, object_type, object_id, *, countdown=0, snapshot=None):
    from .tasks import dispatch_event

    args = (event, str(workspace_id), object_type, str(object_id), snapshot)
    # 트랜잭션이 되돌려지면 일어나지 않은 일을 알리게 된다 — 커밋된 뒤에 예약한다
    transaction.on_commit(lambda: dispatch_event.apply_async(args, countdown=countdown))


def _coalesced(key, window, fire):
    """창 안에서 처음 온 변경만 발송을 예약한다."""
    if cache.add(key, 1, timeout=window):
        fire()


@receiver(post_save, sender=Issue, dispatch_uid="webhooks_issue_saved")
def issue_saved(sender, instance, created, update_fields=None, **kwargs):
    if not _has_hooks(instance.workspace_id):
        return
    key = f"webhook:issue:{instance.pk}"
    if created:
        # 생성 직후 담당자·라벨 지정이 이어진다 — 창을 열어 두고 그 뒤에 한 번에 보낸다
        cache.set(key, 1, timeout=ISSUE_WINDOW_SECONDS)
        _dispatch("issue.created", instance.workspace_id, "issue", instance.pk, countdown=ISSUE_WINDOW_SECONDS)
        return
    if instance.deleted_at is not None:
        if update_fields and "deleted_at" in update_fields:
            from .v1.serializers import IssueSerializer
            _dispatch("issue.deleted", instance.workspace_id, "issue", instance.pk,
                      snapshot={"id": str(instance.pk), **{k: IssueSerializer(instance).data[k]
                                                           for k in ("identifier", "title", "project")}})
        return
    _coalesced(key, ISSUE_WINDOW_SECONDS, lambda: _dispatch(
        "issue.updated", instance.workspace_id, "issue", instance.pk, countdown=ISSUE_WINDOW_SECONDS,
    ))


@receiver(m2m_changed, sender=Issue.assignees.through, dispatch_uid="webhooks_issue_assignees")
@receiver(m2m_changed, sender=Issue.label.through, dispatch_uid="webhooks_issue_labels")
def issue_relations_changed(sender, instance, action, **kwargs):
    if action not in ("post_add", "post_remove", "post_clear") or not isinstance(instance, Issue):
        return
    issue_saved(Issue, instance, created=False)


@receiver(post_save, sender=IssueComment, dispatch_uid="webhooks_comment_created")
def comment_created(sender, instance, created, **kwargs):
    if not created:
        return
    workspace_id = Issue.objects.filter(pk=instance.issue_id).values_list("workspace_id", flat=True).first()
    if workspace_id and _has_hooks(workspace_id):
        _dispatch("comment.created", workspace_id, "comment", instance.pk)


@receiver(post_save, sender=Document, dispatch_uid="webhooks_document_saved")
def document_saved(sender, instance, created, update_fields=None, **kwargs):
    workspace_id = instance.space.workspace_id
    if not _has_hooks(workspace_id):
        return
    key = f"webhook:document:{instance.pk}"
    if created:
        cache.set(key, 1, timeout=ISSUE_WINDOW_SECONDS)
        _dispatch("document.created", workspace_id, "document", instance.pk, countdown=ISSUE_WINDOW_SECONDS)
        return
    if instance.deleted_at is not None:
        if update_fields and "deleted_at" in update_fields:
            _dispatch("document.deleted", workspace_id, "document", instance.pk, snapshot={
                "id": str(instance.pk), "title": instance.title, "space": str(instance.space_id),
            })
        return
    _coalesced(key, DOCUMENT_WINDOW_SECONDS, lambda: _dispatch(
        "document.updated", workspace_id, "document", instance.pk, countdown=DOCUMENT_WINDOW_SECONDS,
    ))
