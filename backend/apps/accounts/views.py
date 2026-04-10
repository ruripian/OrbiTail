from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Announcement, EmailChangeToken, EmailVerificationToken, PasswordResetToken, User
from .serializers import (
    AnnouncementSerializer,
    CustomTokenObtainPairSerializer,
    EmailChangeRequestSerializer,
    EmailChangeVerifySerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    UserSerializer,
    VerifyEmailSerializer,
)


class RegisterView(generics.CreateAPIView):
    """회원가입 — 분당 5회 제한 (브루트포스 방지)"""
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def _is_smtp_configured(self):
        """SMTP가 설정되어 있는지 확인 (console backend = 미설정)"""
        return settings.EMAIL_BACKEND != "django.core.mail.backends.console.EmailBackend"

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        # 초대 토큰 유효성 검증 — 일치하면 즉시 활성화(관리자 승인 우회)
        # 초대 자체가 관리자 승인의 증거이고, 링크 수신 = 이메일 소유 증명
        invite_token = request.data.get("invite_token")
        if invite_token:
            from apps.workspaces.models import WorkspaceInvitation
            invite = WorkspaceInvitation.objects.filter(
                token=invite_token,
                email__iexact=user.email,
                status=WorkspaceInvitation.Status.PENDING,
                expires_at__gt=timezone.now(),
            ).first()
            if invite:
                user.is_email_verified = True
                user.is_approved = True
                user.is_active = True
                user.save(update_fields=["is_email_verified", "is_approved", "is_active"])
                return Response(
                    {"detail": "초대 수락 완료. 바로 로그인할 수 있습니다.", "email_verification_required": False, "auto_activated": True},
                    status=status.HTTP_201_CREATED,
                )

        if self._is_smtp_configured():
            # SMTP 설정됨 → 인증 메일 발송
            token_obj = EmailVerificationToken.objects.create(
                user=user,
                expires_at=timezone.now() + timedelta(hours=24),
            )
            verify_url = f"{settings.FRONTEND_URL}/auth/verify-email?token={token_obj.token}"
            send_mail(
                subject="[OrbiTail] 이메일 인증 안내",
                message=(
                    f"안녕하세요, {user.display_name}님.\n\n"
                    f"OrbiTail 에 가입하신 것을 환영합니다.\n"
                    f"아래 링크를 클릭하여 이메일 인증을 완료해주세요.\n\n"
                    f"{verify_url}\n\n"
                    f"인증 완료 후 관리자 승인을 거쳐 계정이 활성화됩니다.\n"
                    f"이 링크는 24시간 후 만료됩니다."
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
            )
            return Response(
                {"detail": "가입 완료. 이메일을 확인하여 인증을 완료해주세요.", "email_verification_required": True},
                status=status.HTTP_201_CREATED,
            )
        else:
            # SMTP 미설정 → 이메일 인증 자동 완료, 관리자 승인만 대기
            user.is_email_verified = True
            user.save(update_fields=["is_email_verified"])
            return Response(
                {"detail": "가입 완료. 관리자 승인 후 로그인할 수 있습니다.", "email_verification_required": False},
                status=status.HTTP_201_CREATED,
            )


class CustomTokenObtainPairView(TokenObtainPairView):
    """로그인 — 분당 5회 제한 (대입 공격 방어)"""
    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class DeleteAccountView(APIView):
    """계정 탈퇴 — 비밀번호 재확인 후 소프트 삭제

    - deleted_at 설정 + is_active=False → 로그인 불가
    - 이메일을 무효화(접두사 + 기존 이메일)하여 동일 이메일로 재가입 허용
    - 실제 DB 레코드는 남겨 참조 무결성(작성한 이슈/댓글 등)을 유지
    """

    def delete(self, request):
        user = request.user
        password = request.data.get("password")

        if not password:
            return Response(
                {"detail": "비밀번호를 입력해주세요."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not user.check_password(password):
            return Response(
                {"detail": "비밀번호가 올바르지 않습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from django.utils import timezone as _tz
        now = _tz.now()
        # 이메일 충돌 방지: deleted_{timestamp}_{original} 형태로 마스킹 (재가입 허용)
        masked_email = f"deleted_{int(now.timestamp())}_{user.email}"[:254]

        user.deleted_at = now
        user.is_active = False
        user.email = masked_email
        user.save(update_fields=["deleted_at", "is_active", "email", "updated_at"])

        return Response({"detail": "계정이 삭제되었습니다."}, status=status.HTTP_200_OK)


class ChangePasswordView(APIView):
    """현재 비밀번호 확인 후 새 비밀번호로 변경"""

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(serializer.validated_data["current_password"]):
            return Response(
                {"detail": "현재 비밀번호가 올바르지 않습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(serializer.validated_data["new_password"])
        user.save()
        return Response({"detail": "비밀번호가 변경되었습니다."})


class EmailChangeRequestView(APIView):
    """새 이메일로 인증 링크 발송 — 기존 미사용 토큰 무효화 후 신규 생성"""

    def post(self, request):
        serializer = EmailChangeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        new_email = serializer.validated_data["new_email"]
        user = request.user

        # 기존 미사용 토큰 일괄 삭제
        EmailChangeToken.objects.filter(user=user, is_used=False).delete()

        token_obj = EmailChangeToken.objects.create(
            user=user,
            new_email=new_email,
            expires_at=timezone.now() + timedelta(hours=24),
        )

        verify_url = f"{settings.FRONTEND_URL}/email-change/verify?token={token_obj.token}"
        send_mail(
            subject="[OrbiTail] 이메일 변경 인증",
            message=(
                f"안녕하세요, {user.display_name}님.\n\n"
                f"아래 링크를 클릭하여 이메일 변경을 완료하세요.\n\n"
                f"{verify_url}\n\n"
                f"이 링크는 24시간 후 만료됩니다.\n"
                f"본인이 요청하지 않은 경우 이 메일을 무시하세요."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[new_email],
        )

        return Response({"detail": "인증 메일을 발송했습니다."})


class EmailChangeVerifyView(APIView):
    """토큰 검증 후 이메일 변경 완료 — 새 JWT 발급"""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = EmailChangeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            token_obj = EmailChangeToken.objects.select_related("user").get(
                token=serializer.validated_data["token"],
                is_used=False,
            )
        except EmailChangeToken.DoesNotExist:
            return Response(
                {"detail": "유효하지 않은 토큰입니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not token_obj.is_valid():
            return Response(
                {"detail": "만료된 토큰입니다. 이메일 변경을 다시 요청해주세요."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = token_obj.user
        user.email = token_obj.new_email
        user.save()

        token_obj.is_used = True
        token_obj.save()

        # 이메일이 변경됐으므로 새 JWT 발급
        refresh = RefreshToken.for_user(user)
        return Response({
            "detail": "이메일이 변경되었습니다.",
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user).data,
        })


class VerifyEmailView(APIView):
    """회원가입 후 초기 이메일 인증"""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            token_obj = EmailVerificationToken.objects.select_related("user").get(
                token=serializer.validated_data["token"],
                is_used=False,
            )
        except EmailVerificationToken.DoesNotExist:
            return Response({"detail": "유효하지 않은 토큰입니다."}, status=status.HTTP_400_BAD_REQUEST)

        if not token_obj.is_valid():
            return Response({"detail": "만료된 토큰입니다."}, status=status.HTTP_400_BAD_REQUEST)

        user = token_obj.user
        user.is_email_verified = True
        user.save()

        token_obj.is_used = True
        token_obj.save()

        # 어드민에게 알림을 보낼 수도 있음 (현재는 생략)

        return Response({"detail": "이메일 인증이 완료되었습니다. 관리자 승인 후 이용 가능합니다."})


class PasswordResetRequestView(APIView):
    """비밀번호 찾기 메일 발송 — 분당 5회 제한"""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"]
        # 보안: 이메일 존재 여부와 무관하게 동일한 응답 반환 (열거 공격 방지)
        generic_msg = "해당 이메일로 비밀번호 재설정 안내가 발송됩니다."

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response({"detail": generic_msg})

        PasswordResetToken.objects.filter(user=user, is_used=False).delete()

        token_obj = PasswordResetToken.objects.create(
            user=user,
            expires_at=timezone.now() + timedelta(hours=1),
        )

        reset_url = f"{settings.FRONTEND_URL}/auth/reset-password?token={token_obj.token}"
        send_mail(
            subject="[OrbiTail] 비밀번호 재설정",
            message=(
                f"안녕하세요, {user.display_name}님.\n\n"
                f"아래 링크를 클릭하여 비밀번호를 재설정하세요.\n\n"
                f"{reset_url}\n\n"
                f"이 링크는 1시간 후 만료됩니다."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )

        return Response({"detail": generic_msg})


class PasswordResetConfirmView(APIView):
    """토큰 이용한 비밀번호 재설정"""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            token_obj = PasswordResetToken.objects.select_related("user").get(
                token=serializer.validated_data["token"],
                is_used=False,
            )
        except PasswordResetToken.DoesNotExist:
            return Response({"detail": "유효하지 않은 토큰입니다."}, status=status.HTTP_400_BAD_REQUEST)

        if not token_obj.is_valid():
            return Response({"detail": "만료된 토큰입니다."}, status=status.HTTP_400_BAD_REQUEST)

        user = token_obj.user
        user.set_password(serializer.validated_data["new_password"])
        user.save()

        token_obj.is_used = True
        token_obj.save()

        return Response({"detail": "비밀번호가 성공적으로 변경되었습니다."})


class AdminUserListView(generics.ListAPIView):
    """슈퍼어드민용 전체 사용자 목록"""
    permission_classes = [permissions.IsAdminUser]
    serializer_class = UserSerializer

    def get_queryset(self):
        qs = User.objects.all().order_by("-created_at")
        status_param = self.request.query_params.get("status")
        if status_param == "pending":
            # 이메일 인증까지 마친 대기자 (혹은 그냥 이메일 인증 안 했어도 관리자가 볼 수 있게 하려면 조건 조절 가능)
            qs = qs.filter(is_email_verified=True, is_approved=False)
        elif status_param == "approved":
            qs = qs.filter(is_approved=True)
        return qs


class AdminUserApproveView(APIView):
    """사용자 가입 승인"""
    permission_classes = [permissions.IsAdminUser]

    def post(self, request, pk):
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({"detail": "사용자를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        if user.is_approved:
            return Response({"detail": "이미 승인된 사용자입니다."}, status=status.HTTP_400_BAD_REQUEST)

        user.is_approved = True
        user.is_active = True
        user.save()
        
        login_url = f"{settings.FRONTEND_URL}/auth/login"
        send_mail(
            subject="[OrbiTail] 계정 승인 완료 안내",
            message=(
                f"안녕하세요, {user.display_name}님.\n\n"
                f"관리자가 OrbiTail 계정을 승인했습니다.\n"
                f"이제 로그인하여 이용할 수 있습니다.\n\n"
                f"로그인 주소: {login_url}"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )

        return Response({"detail": "사용자가 승인되었습니다."})


class AnnouncementListCreateView(generics.ListCreateAPIView):
    """공지/업데이트 목록 + 생성. is_published=True 만 반환. 작성은 staff 만."""
    serializer_class = AnnouncementSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        qs = Announcement.objects.all()
        if not self.request.user.is_staff:
            qs = qs.filter(is_published=True)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class AnnouncementDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = AnnouncementSerializer
    queryset = Announcement.objects.all()

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [permissions.IsAuthenticated()]
        return [permissions.IsAdminUser()]


class AnnouncementUnreadCountView(APIView):
    """현재 사용자가 안 읽은 공지 개수"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = Announcement.objects.filter(is_published=True)
        last_seen = request.user.last_seen_announcement
        if last_seen:
            qs = qs.filter(created_at__gt=last_seen.created_at)
        return Response({"unread": qs.count()})


class AnnouncementMarkSeenView(APIView):
    """가장 최근 공지를 본 것으로 표시"""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        latest = Announcement.objects.filter(is_published=True).first()
        if latest:
            request.user.last_seen_announcement = latest
            request.user.save(update_fields=["last_seen_announcement"])
        return Response({"detail": "ok"})


