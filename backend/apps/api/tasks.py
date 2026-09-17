"""웹훅 이벤트 만들기 · 발송 · 재시도."""
import hashlib
import hmac
import json
import time
import uuid
from datetime import timedelta

from celery import shared_task
from django.utils import timezone
from django.utils import translation
from django.utils.translation import gettext

from .webhook_http import WebhookTargetError, post_json

# 끝내 실패하기까지의 재시도 간격(초). 받는 쪽이 잠깐 내려간 정도는 넘기고, 오래 죽어 있으면 포기한다.
RETRY_DELAYS = [60, 300, 1800, 7200]
# 연속으로 끝내 실패한 발송이 이만큼 쌓이면 웹훅을 끈다
DISABLE_AFTER_FAILURES = 20
DELIVERY_RETENTION_DAYS = 30


def _payload_for(webhook, event, object_type, object_id, snapshot):
    """만든 사람이 볼 수 있는 대상이면 v1 과 같은 모양의 data 를, 아니면 None."""
    from apps.documents.models import Document
    from apps.issues.models import Issue, IssueComment
    from apps.workspaces.models import WorkspaceMember

    from .v1 import serializers as s
    from .v1.access import accessible_spaces, readable_projects

    user = webhook.created_by
    if not user.is_active or user.is_suspended or not WorkspaceMember.objects.filter(
        workspace_id=webhook.workspace_id, member=user, role__gte=WorkspaceMember.Role.MEMBER,
    ).exists():
        return None

    if object_type == "ping":
        return {"message": gettext("The OrbiTail webhook is connected.")}

    if object_type == "issue":
        issue = (
            Issue.objects.filter(pk=object_id, project__in=readable_projects(user, webhook.workspace))
            .select_related("project", "workspace", "state", "sprint", "category", "created_by")
            .prefetch_related("assignees", "label")
            .first()
        )
        if issue is None:
            return None
        if event == "issue.deleted":
            return snapshot
        if issue.deleted_at is not None:
            return None  # 알리기 전에 지워졌다 — deleted 이벤트가 따로 간다
        return s.IssueSerializer(issue).data

    if object_type == "comment":
        comment = IssueComment.objects.filter(pk=object_id).select_related("actor", "issue").first()
        if comment is None or not readable_projects(user, webhook.workspace).filter(pk=comment.issue.project_id).exists():
            return None
        issue = comment.issue
        return {
            **s.CommentSerializer(comment).data,
            "issue": {"id": str(issue.id), "identifier": f"{issue.project.identifier}-{issue.sequence_id}",
                      "title": issue.title},
        }

    if object_type == "document":
        doc = (
            Document.objects.filter(pk=object_id, space__in=accessible_spaces(user, webhook.workspace))
            .select_related("space", "space__workspace", "created_by")
            .prefetch_related("labels")
            .first()
        )
        if doc is None:
            return None
        if event == "document.deleted":
            return snapshot
        if doc.deleted_at is not None:
            return None
        return s.DocumentSerializer(doc).data
    return None


@shared_task
def dispatch_event(event, workspace_id, object_type, object_id, snapshot=None, webhook_id=None):
    """구독 중인 웹훅마다 발송 건을 만들고 보낸다. data 는 **이 시점의 최신 상태**로 만든다 —
    짧은 시간에 여러 번 바뀐 것을 한 번으로 합쳐 보내기 때문이다."""
    from .models import Webhook, WebhookDelivery

    hooks = Webhook.objects.filter(workspace_id=workspace_id, is_active=True).select_related("created_by", "workspace")
    if webhook_id:
        hooks = hooks.filter(pk=webhook_id)
    for hook in hooks:
        if event != "ping" and event not in hook.events:
            continue
        data = _payload_for(hook, event, object_type, object_id, snapshot)
        if data is None:
            continue
        delivery_id = uuid.uuid4()
        WebhookDelivery.objects.create(
            id=delivery_id, webhook=hook, event=event,
            payload={
                "id": str(delivery_id),
                "event": event,
                "created_at": timezone.now().isoformat(),
                "workspace": {"id": str(hook.workspace_id), "slug": hook.workspace.slug},
                "data": data,
            },
        )
        deliver.delay(str(delivery_id))


def sign(secret: str, timestamp: str, body: bytes) -> str:
    """받는 쪽 검증: HMAC-SHA256(secret, f"{timestamp}.{body}") 을 X-OrbiTail-Signature 와 비교.
    타임스탬프를 서명에 넣어 가로챈 요청을 나중에 다시 보내는 것을 받는 쪽이 거를 수 있게 한다."""
    return hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


@shared_task
def deliver(delivery_id):
    from .models import Webhook, WebhookDelivery

    delivery = WebhookDelivery.objects.select_related("webhook").filter(pk=delivery_id).first()
    if delivery is None or delivery.status != WebhookDelivery.Status.PENDING:
        return
    hook = delivery.webhook
    if not hook.is_active:
        delivery.status, delivery.error = WebhookDelivery.Status.FAILED, gettext("This webhook is turned off.")
        delivery.save(update_fields=["status", "error"])
        return

    body = json.dumps(delivery.payload, ensure_ascii=False, separators=(",", ":")).encode()
    timestamp = str(int(time.time()))
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "OrbiTail-Webhooks/1",
        "X-OrbiTail-Event": delivery.event,
        "X-OrbiTail-Delivery": str(delivery.id),
        "X-OrbiTail-Timestamp": timestamp,
        "X-OrbiTail-Signature": "sha256=" + sign(hook.secret, timestamp, body),
    }

    delivery.attempts += 1
    retryable = True
    # 전달 기록·꺼짐 사유는 설정 화면에 보인다 — 웹훅을 만든 사람의 언어로 남긴다
    from apps.accounts.models import user_language
    lang = user_language(hook.created_by)
    try:
        with translation.override(lang):
            code, text = post_json(hook.url, body, headers)
        delivery.response_status, delivery.response_body, delivery.error = code, text, ""
        ok = 200 <= code < 300
    except WebhookTargetError as exc:
        # 주소 자체가 막힌 경우는 기다려도 풀리지 않는다
        delivery.error, ok, retryable = str(exc)[:300], False, False
    except OSError as exc:
        with translation.override(lang):
            delivery.error, ok = (gettext("Connection failed: %(error)s") % {"error": exc})[:300], False

    if ok:
        delivery.status, delivery.delivered_at = WebhookDelivery.Status.SUCCESS, timezone.now()
        delivery.save()
        if hook.consecutive_failures:
            Webhook.objects.filter(pk=hook.pk).update(consecutive_failures=0)
        return

    if retryable and delivery.attempts <= len(RETRY_DELAYS):
        delivery.save()
        deliver.apply_async((str(delivery.id),), countdown=RETRY_DELAYS[delivery.attempts - 1])
        return

    delivery.status = WebhookDelivery.Status.FAILED
    delivery.save()
    hook.consecutive_failures += 1
    fields = ["consecutive_failures"]
    if hook.consecutive_failures >= DISABLE_AFTER_FAILURES:
        hook.is_active = False
        with translation.override(lang):
            hook.disabled_reason = gettext(
                "Turned off automatically after %(count)s failed deliveries in a row."
            ) % {"count": hook.consecutive_failures}
        fields += ["is_active", "disabled_reason"]
    hook.save(update_fields=fields)


@shared_task
def prune_webhook_deliveries():
    from .models import WebhookDelivery

    cutoff = timezone.now() - timedelta(days=DELIVERY_RETENTION_DAYS)
    deleted, _ = WebhookDelivery.objects.filter(created_at__lt=cutoff).delete()
    return f"Deleted {deleted} webhook deliveries"
