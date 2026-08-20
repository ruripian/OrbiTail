"""데모 모드 진입 API.

프론트는 부팅 시 status 를 물어 데모 배포인지 확인하고, 방문자가
"데모 시작" 을 누르면 session 을 호출해 샌드박스와 토큰을 함께 받는다.
로그인 화면을 거치지 않는다.
"""
import hashlib

from django.conf import settings
from django.utils import timezone
from datetime import timedelta

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.serializers import MeSerializer

from .models import DemoSandbox
from .sandbox import create_sandbox


def _client_hash(request) -> str:
    """rate limit 용 클라이언트 식별자. 원본 IP 는 저장하지 않는다.

    Caddy → nginx → daphne 순으로 프록시를 거치므로 REMOTE_ADDR 은 항상
    nginx 다. X-Forwarded-For 의 맨 앞이 원 클라이언트지만 위조 가능하므로,
    이 값은 남용을 완전히 막는 수단이 아니라 실수로 인한 폭주를 줄이는
    수준으로만 쓴다.
    """
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    raw = forwarded.split(",")[0].strip() or request.META.get("REMOTE_ADDR", "")
    return hashlib.sha256(f"{settings.SECRET_KEY}:{raw}".encode()).hexdigest()


class DemoStatusView(APIView):
    """이 배포가 데모인지 알려준다. 데모가 아니면 enabled=false 만 돌려준다."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response({
            "enabled": settings.DEMO_MODE,
            "ttl_hours": settings.DEMO_SANDBOX_TTL_HOURS if settings.DEMO_MODE else None,
        })


class DemoSessionView(APIView):
    """샌드박스를 만들고 그 방문자 계정의 JWT 를 발급한다."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        if not settings.DEMO_MODE:
            return Response(
                {"detail": "데모 모드가 아닙니다."},
                status=status.HTTP_404_NOT_FOUND,
            )

        client_hash = _client_hash(request)
        window_start = timezone.now() - timedelta(minutes=settings.DEMO_RATE_WINDOW_MINUTES)
        recent = DemoSandbox.objects.filter(
            client_hash=client_hash, created_at__gte=window_start
        ).count()
        if recent >= settings.DEMO_MAX_SANDBOXES_PER_CLIENT:
            return Response(
                {"detail": "잠시 후 다시 시도해 주세요. 데모 세션을 너무 자주 만들었습니다."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        sandbox = create_sandbox(client_hash=client_hash)
        refresh = RefreshToken.for_user(sandbox.user)
        return Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": MeSerializer(sandbox.user).data,
            "expires_at": sandbox.created_at + timedelta(hours=settings.DEMO_SANDBOX_TTL_HOURS),
        }, status=status.HTTP_201_CREATED)
