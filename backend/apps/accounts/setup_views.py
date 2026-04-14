from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions, serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User
from .serializers import MeSerializer


class SetupStatusView(APIView):
    """
    서버 초기 설정 완료 여부 반환.
    유저가 한 명이라도 존재하면 설정 완료로 간주한다.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({"is_complete": User.objects.exists()})


class SetupInputSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=50)
    last_name = serializers.CharField(max_length=50)
    display_name = serializers.CharField(max_length=100)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)
    timezone = serializers.CharField(max_length=100, default="Asia/Seoul")


class SetupView(APIView):
    """
    최초 슈퍼어드민을 생성한다.
    워크스페이스는 셋업 후 별도 페이지에서 생성한다.
    이미 유저가 존재하면 403을 반환하여 재실행을 차단한다.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        # 이미 유저가 있으면 재실행 불가
        if User.objects.exists():
            return Response(
                {"detail": "Setup has already been completed."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = SetupInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # 슈퍼어드민 생성 — 이메일 인증/승인 절차 불필요하므로 모든 플래그 활성화
        user = User.objects.create_superuser(
            email=data["email"],
            password=data["password"],
            first_name=data["first_name"],
            last_name=data["last_name"],
            display_name=data["display_name"],
            timezone=data["timezone"],
        )

        # 셋업 완료 즉시 JWT 토큰 발급 → 프론트에서 자동 로그인 처리
        refresh = RefreshToken.for_user(user)
        return Response({
            "detail": "Setup complete.",
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": MeSerializer(user).data,
        }, status=status.HTTP_201_CREATED)
