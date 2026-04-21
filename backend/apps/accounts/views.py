from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Announcement, EmailChangeToken, EmailVerificationToken, PasswordResetToken, User
from .permissions import IsSuperUser, IsWorkspaceAdminOrSuperUser
from .serializers import (
    AdminUserSerializer,
    AnnouncementSerializer,
    CustomTokenObtainPairSerializer,
    EmailChangeRequestSerializer,
    EmailChangeVerifySerializer,
    MeSerializer,
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

        # 첫 가입자 부트스트랩 — 시스템에 슈퍼유저가 0명이면 이 계정을 즉시 슈퍼유저로 승격.
        # `createsuperuser` 없이 웹 가입만으로 초기 관리자 계정 셋업이 가능하도록 하는 장치.
        if not User.objects.filter(is_superuser=True).exclude(pk=user.pk).exists():
            user.is_superuser = True
            user.is_staff = True
            user.is_active = True
            user.is_approved = True
            user.is_email_verified = True
            user.save(update_fields=[
                "is_superuser", "is_staff", "is_active",
                "is_approved", "is_email_verified",
            ])
            return Response(
                {"detail": "첫 관리자 계정으로 등록되었습니다. 바로 로그인할 수 있습니다.",
                 "email_verification_required": False, "auto_activated": True, "bootstrap_superuser": True},
                status=status.HTTP_201_CREATED,
            )

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
    serializer_class = MeSerializer
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get_object(self):
        return self.request.user

    def perform_update(self, serializer):
        # avatar 필드가 변경된 경우 기존 파일은 물리 삭제 (mediafiles 누적 방지)
        SENTINEL = object()
        old_avatar = serializer.instance.avatar if serializer.instance.avatar else None
        new_avatar = serializer.validated_data.get("avatar", SENTINEL)
        serializer.save()
        if new_avatar is not SENTINEL and old_avatar and old_avatar != new_avatar:
            try:
                old_avatar.delete(save=False)
            except Exception:
                pass


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
            "user": MeSerializer(user).data,
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
    """관리자 페이지용 전체 사용자 목록 — 워크스페이스 관리자 이상 접근 가능.

    슈퍼유저만 볼 수 있는 플래그(is_superuser 등)는 Serializer 레벨에서 read-only로 노출되며,
    실제 권한 변경 엔드포인트에서 별도 가드.
    """
    permission_classes = [IsWorkspaceAdminOrSuperUser]
    serializer_class = AdminUserSerializer

    def get_queryset(self):
        qs = User.objects.all().order_by("-created_at")
        status_param = self.request.query_params.get("status")
        search = self.request.query_params.get("search", "").strip()
        if status_param == "pending":
            qs = qs.filter(is_email_verified=True, is_approved=False)
        elif status_param == "approved":
            qs = qs.filter(is_approved=True)
        elif status_param == "suspended":
            qs = qs.filter(is_suspended=True)
        elif status_param == "superusers":
            qs = qs.filter(is_superuser=True)
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(email__icontains=search) |
                Q(display_name__icontains=search) |
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search)
            )
        return qs


class AdminUserApproveView(APIView):
    """사용자 가입 승인 — 워크스페이스 관리자 이상"""
    permission_classes = [IsWorkspaceAdminOrSuperUser]

    def post(self, request, pk):
        from apps.audit.models import log_admin_action
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({"detail": "사용자를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        if user.is_approved:
            return Response({"detail": "이미 승인된 사용자입니다."}, status=status.HTTP_400_BAD_REQUEST)

        user.is_approved = True
        user.is_active = True
        user.save()

        log_admin_action(
            actor=request.user,
            action="user_approve",
            target_type="user",
            target_id=user.id,
            target_label=user.email,
        )

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


class AdminUserSuperuserView(APIView):
    """슈퍼유저 권한 부여/회수 — 슈퍼유저만"""
    permission_classes = [IsSuperUser]

    def patch(self, request, pk):
        from apps.audit.models import log_admin_action
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({"detail": "사용자를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        new_value = request.data.get("is_superuser")
        if new_value is None:
            return Response({"detail": "is_superuser 값이 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)
        new_value = bool(new_value)

        # 본인 강등 금지 — 실수로 전체 접근을 잃는 것을 방지
        if user.pk == request.user.pk and not new_value:
            return Response(
                {"detail": "본인의 슈퍼유저 권한은 해제할 수 없습니다. 다른 슈퍼유저가 대신 진행해야 합니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 마지막 슈퍼유저 강등 방지
        if not new_value and user.is_superuser:
            other_count = User.objects.filter(is_superuser=True).exclude(pk=user.pk).count()
            if other_count == 0:
                return Response(
                    {"detail": "마지막 슈퍼유저는 강등할 수 없습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if user.is_superuser == new_value:
            return Response(AdminUserSerializer(user).data)

        user.is_superuser = new_value
        if new_value:
            # 슈퍼유저는 staff 권한과 활성화 상태도 자동 부여
            user.is_staff = True
            user.is_active = True
            user.is_approved = True
        user.save()

        log_admin_action(
            actor=request.user,
            action="superuser_grant" if new_value else "superuser_revoke",
            target_type="user",
            target_id=user.id,
            target_label=user.email,
        )
        return Response(AdminUserSerializer(user).data)


class AdminUserSuspendView(APIView):
    """사용자 일시 정지/해제 — 슈퍼유저만. 다른 슈퍼유저는 정지할 수 없음."""
    permission_classes = [IsSuperUser]

    def patch(self, request, pk):
        from apps.audit.models import log_admin_action
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({"detail": "사용자를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        if user.pk == request.user.pk:
            return Response({"detail": "본인을 정지할 수 없습니다."}, status=status.HTTP_400_BAD_REQUEST)
        if user.is_superuser:
            return Response(
                {"detail": "슈퍼유저는 정지할 수 없습니다. 먼저 슈퍼유저 권한을 해제하세요."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_value = bool(request.data.get("is_suspended"))
        user.is_suspended = new_value
        user.is_active = not new_value
        user.save(update_fields=["is_suspended", "is_active", "updated_at"])

        log_admin_action(
            actor=request.user,
            action="user_suspend" if new_value else "user_unsuspend",
            target_type="user",
            target_id=user.id,
            target_label=user.email,
        )
        return Response(AdminUserSerializer(user).data)


class AdminUserDeleteView(APIView):
    """사용자 하드 삭제 — 슈퍼유저만. 생성한 이슈 등은 CASCADE 관계에 따라 삭제됨."""
    permission_classes = [IsSuperUser]

    def delete(self, request, pk):
        from apps.audit.models import log_admin_action
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({"detail": "사용자를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        if user.pk == request.user.pk:
            return Response({"detail": "본인은 삭제할 수 없습니다."}, status=status.HTTP_400_BAD_REQUEST)
        if user.is_superuser:
            return Response(
                {"detail": "슈퍼유저는 삭제할 수 없습니다. 먼저 슈퍼유저 권한을 해제하세요."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        snapshot_email = user.email
        snapshot_id = user.id
        user.delete()

        log_admin_action(
            actor=request.user,
            action="user_delete",
            target_type="user",
            target_id=snapshot_id,
            target_label=snapshot_email,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


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


