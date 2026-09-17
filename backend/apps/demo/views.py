"""데모 모드 진입 API.

프론트는 부팅 시 status 를 물어 데모 배포인지 확인하고, 방문자가
"데모 시작" 을 누르면 session 을 호출해 샌드박스와 토큰을 함께 받는다.
로그인 화면을 거치지 않는다.
"""
import hashlib

from django.conf import settings
from django.utils import timezone
from django.utils.translation import gettext
from datetime import timedelta

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.serializers import MeSerializer

from apps.core.client_ip import client_ip

from .models import DemoSandbox
from .sandbox import create_sandbox


def _client_hash(request) -> str:
    """rate limit 용 클라이언트 식별자. 원본 IP 는 저장하지 않는다.

    예전에는 X-Forwarded-For 의 맨 앞을 썼는데, 그 값은 클라이언트가 위조할 수
    있어 헤더만 바꿔 보내면 발급 제한을 넘을 수 있었다. 이제 스로틀·axes 와
    같은 client_ip 를 쓴다(TRUSTED_PROXY_COUNT 기준).
    """
    raw = client_ip(request)
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
                {"detail": gettext("Demo mode is not enabled.")},
                status=status.HTTP_404_NOT_FOUND,
            )

        client_hash = _client_hash(request)
        window_start = timezone.now() - timedelta(minutes=settings.DEMO_RATE_WINDOW_MINUTES)
        recent = DemoSandbox.objects.filter(
            client_hash=client_hash, created_at__gte=window_start
        ).count()
        if recent >= settings.DEMO_MAX_SANDBOXES_PER_CLIENT:
            return Response(
                {"detail": gettext("Too many demo sessions were started. Please try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        sandbox = create_sandbox(client_hash=client_hash)
        # 샌드박스 계정은 모델 기본 언어로 만들어진다 — 데모를 연 화면의 언어로 맞춘다
        from apps.accounts.models import request_language
        type(sandbox.user).objects.filter(email__endswith="@" + sandbox.email_domain).update(language=request_language())
        sandbox.user.refresh_from_db(fields=["language"])
        refresh = RefreshToken.for_user(sandbox.user)
        return Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": MeSerializer(sandbox.user).data,
            "expires_at": sandbox.created_at + timedelta(hours=settings.DEMO_SANDBOX_TTL_HOURS),
        }, status=status.HTTP_201_CREATED)


class DemoSessionCheckView(APIView):
    """들고 온 토큰이 지금도 살아 있는 데모 세션인지 서버가 판정한다.

    프론트가 localStorage 의 플래그만 보고 판단하면, 그 값이 서버 상태와
    어긋났을 때(샌드박스가 이미 지워졌다거나, 데모 전환 이전 세션이 남아
    있다거나) 갈 곳 없는 화면에 갇힌다. 판정 주체를 서버로 옮긴다.

    토큰이 없거나 만료됐으면 JWTAuthentication 이 401 을 낸다. 프론트는
    200 + valid=true 가 아닌 모든 경우를 "세션 없음" 으로 취급하면 된다.
    """

    authentication_classes = [JWTAuthentication]
    permission_classes = [AllowAny]

    def get(self, request):
        user = request.user
        sandbox = getattr(user, "demo_sandbox", None) if user.is_authenticated else None
        if sandbox is None:
            return Response({"valid": False})
        return Response({
            "valid": True,
            "expires_at": sandbox.created_at + timedelta(hours=settings.DEMO_SANDBOX_TTL_HOURS),
        })
