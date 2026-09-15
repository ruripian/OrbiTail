from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.workspaces.models import WorkspaceMember

import secrets

from .models import ApiToken, Webhook
from .serializers import (
    ApiTokenCreateSerializer, ApiTokenSerializer, WebhookDeliverySerializer, WebhookSerializer, WebhookWriteSerializer,
)

# 한 사람이 한 워크스페이스에서 동시에 살아 있게 둘 수 있는 토큰 수.
# 잊힌 토큰이 쌓이는 것을 막는 상한이지 보안 경계는 아니다.
MAX_ACTIVE_TOKENS_PER_USER = 20


# ══════════════════════════════════════════════════════════════════
#  토큰 관리 — 사람 세션(JWT)으로 부른다
# ══════════════════════════════════════════════════════════════════

def _membership(workspace_slug, user):
    return (
        WorkspaceMember.objects.select_related("workspace")
        .filter(workspace__slug=workspace_slug, member=user)
        .first()
    )


class ApiTokenListCreateView(APIView):
    """GET: 내 토큰. 워크스페이스 관리자는 ?all=true 로 전체 토큰.
    POST: 토큰 발급 — 응답의 `token` 은 이때 한 번만 나온다."""

    def get(self, request, workspace_slug):
        wm = _membership(workspace_slug, request.user)
        if wm is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        qs = ApiToken.objects.filter(workspace=wm.workspace).select_related("user")
        if request.query_params.get("all") == "true":
            if wm.role < WorkspaceMember.Role.ADMIN:
                return Response({"detail": "관리자만 전체 토큰을 볼 수 있습니다."},
                                status=status.HTTP_403_FORBIDDEN)
        else:
            qs = qs.filter(user=request.user)
        return Response(ApiTokenSerializer(qs, many=True).data)

    def post(self, request, workspace_slug):
        # 데모 방문자는 계정 없이 들어온다. 그 세션으로 자동화 자격증명을 만들 이유가 없다.
        if getattr(settings, "DEMO_MODE", False):
            return Response({"detail": "데모에서는 API 토큰을 만들 수 없습니다."},
                            status=status.HTTP_403_FORBIDDEN)
        wm = _membership(workspace_slug, request.user)
        if wm is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if wm.role < WorkspaceMember.Role.MEMBER:
            return Response({"detail": "게스트는 API 토큰을 만들 수 없습니다."},
                            status=status.HTTP_403_FORBIDDEN)

        s = ApiTokenCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        now = timezone.now()
        active = ApiToken.objects.filter(
            workspace=wm.workspace, user=request.user, revoked_at__isnull=True,
        ).exclude(expires_at__lte=now).count()
        if active >= MAX_ACTIVE_TOKENS_PER_USER:
            return Response(
                {"detail": f"살아 있는 토큰은 {MAX_ACTIVE_TOKENS_PER_USER}개까지입니다. 안 쓰는 토큰을 폐기하세요."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        days = s.validated_data["expires_in_days"]
        token, raw = ApiToken.issue(
            workspace=wm.workspace,
            user=request.user,
            name=s.validated_data["name"],
            scope=s.validated_data["scope"],
            expires_at=now + timedelta(days=days) if days else None,
        )
        data = ApiTokenSerializer(token).data
        data["token"] = raw
        return Response(data, status=status.HTTP_201_CREATED)


class ApiTokenRevokeView(APIView):
    """DELETE: 폐기. 본인 토큰이거나 워크스페이스 관리자. 되살릴 수 없다."""

    def delete(self, request, workspace_slug, pk):
        wm = _membership(workspace_slug, request.user)
        if wm is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        token = ApiToken.objects.filter(workspace=wm.workspace, pk=pk).first()
        if token is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if token.user_id != request.user.id and wm.role < WorkspaceMember.Role.ADMIN:
            # 남의 토큰이 있다는 사실 자체를 드러내지 않는다
            return Response(status=status.HTTP_404_NOT_FOUND)
        if token.revoked_at is None:
            token.revoked_at = timezone.now()
            token.revoked_by = request.user
            token.save(update_fields=["revoked_at", "revoked_by"])
        return Response(status=status.HTTP_204_NO_CONTENT)


# ══════════════════════════════════════════════════════════════════
#  웹훅 관리 — 워크스페이스 관리자
# ══════════════════════════════════════════════════════════════════

MAX_WEBHOOKS_PER_WORKSPACE = 20


def _admin_membership(workspace_slug, user):
    """관리자가 아니면 (None, 응답). 워크스페이스 전체의 일을 밖으로 내보내는 설정이라 관리자로 제한한다."""
    wm = _membership(workspace_slug, user)
    if wm is None:
        return None, Response(status=status.HTTP_404_NOT_FOUND)
    if wm.role < WorkspaceMember.Role.ADMIN:
        return None, Response({"detail": "워크스페이스 관리자만 웹훅을 관리할 수 있습니다."},
                              status=status.HTTP_403_FORBIDDEN)
    return wm, None


class WebhookListCreateView(APIView):
    def get(self, request, workspace_slug):
        wm, err = _admin_membership(workspace_slug, request.user)
        if err:
            return err
        qs = Webhook.objects.filter(workspace=wm.workspace).select_related("created_by")
        return Response(WebhookSerializer(qs, many=True).data)

    def post(self, request, workspace_slug):
        # 데모는 누구나 관리자다. 거기서 서버가 임의 주소로 요청을 보내게 둘 이유가 없다.
        if getattr(settings, "DEMO_MODE", False):
            return Response({"detail": "데모에서는 웹훅을 만들 수 없습니다."}, status=status.HTTP_403_FORBIDDEN)
        wm, err = _admin_membership(workspace_slug, request.user)
        if err:
            return err
        s = WebhookWriteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        missing = [f for f in ("name", "url", "events") if f not in s.validated_data]
        if missing:
            return Response({f: ["필수입니다."] for f in missing}, status=status.HTTP_400_BAD_REQUEST)
        if Webhook.objects.filter(workspace=wm.workspace).count() >= MAX_WEBHOOKS_PER_WORKSPACE:
            return Response({"detail": f"웹훅은 워크스페이스당 {MAX_WEBHOOKS_PER_WORKSPACE}개까지입니다."},
                            status=status.HTTP_400_BAD_REQUEST)
        hook = Webhook.objects.create(
            workspace=wm.workspace, created_by=request.user, secret=secrets.token_hex(32),
            name=s.validated_data["name"], url=s.validated_data["url"], events=s.validated_data["events"],
        )
        data = WebhookSerializer(hook).data
        data["secret"] = hook.secret  # 발급 응답에서만
        return Response(data, status=status.HTTP_201_CREATED)


class _WebhookLookup(APIView):
    def _get(self, request, workspace_slug, pk):
        wm, err = _admin_membership(workspace_slug, request.user)
        if err:
            return None, err
        hook = Webhook.objects.filter(workspace=wm.workspace, pk=pk).select_related("created_by").first()
        if hook is None:
            return None, Response(status=status.HTTP_404_NOT_FOUND)
        return hook, None


class WebhookDetailView(_WebhookLookup):
    def patch(self, request, workspace_slug, pk):
        hook, err = self._get(request, workspace_slug, pk)
        if err:
            return err
        s = WebhookWriteSerializer(data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        for field, value in s.validated_data.items():
            setattr(hook, field, value)
        if s.validated_data.get("is_active"):
            # 다시 켜면 실패 이력을 새로 센다 — 안 그러면 한 번만 실패해도 곧바로 다시 꺼진다
            hook.consecutive_failures, hook.disabled_reason = 0, ""
        hook.save()
        return Response(WebhookSerializer(hook).data)

    def delete(self, request, workspace_slug, pk):
        hook, err = self._get(request, workspace_slug, pk)
        if err:
            return err
        hook.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WebhookPingView(_WebhookLookup):
    """시험 발송 — 받는 쪽 설정(주소·서명 검증)을 이벤트를 기다리지 않고 확인한다."""

    def post(self, request, workspace_slug, pk):
        from .tasks import dispatch_event

        hook, err = self._get(request, workspace_slug, pk)
        if err:
            return err
        if not hook.is_active:
            return Response({"detail": "꺼진 웹훅입니다. 먼저 켜세요."}, status=status.HTTP_400_BAD_REQUEST)
        dispatch_event.delay("ping", str(hook.workspace_id), "ping", str(hook.pk), None, str(hook.pk))
        return Response({"queued": True}, status=status.HTTP_202_ACCEPTED)


class WebhookDeliveryListView(_WebhookLookup):
    def get(self, request, workspace_slug, pk):
        hook, err = self._get(request, workspace_slug, pk)
        if err:
            return err
        return Response(WebhookDeliverySerializer(hook.deliveries.order_by("-created_at")[:50], many=True).data)
