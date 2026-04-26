import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

logger = logging.getLogger(__name__)
from rest_framework import generics, permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Announcement, EmailChangeToken, EmailVerificationToken, PasswordResetToken, User


def _create_join_request(user, workspace, notify_admins=True):
    """PENDING 가입 신청 생성 + (옵션) 워크스페이스 어드민에게 알림.
    이미 멤버이거나 PENDING 신청이 있으면 무시. 반환: workspace.slug 또는 None.
    """
    from apps.workspaces.models import WorkspaceMember, WorkspaceJoinRequest
    from apps.workspaces.views import _notify_workspace_admins_join_request

    if WorkspaceMember.objects.filter(workspace=workspace, member=user).exists():
        return None
    existing = WorkspaceJoinRequest.objects.filter(
        workspace=workspace, user=user,
        status=WorkspaceJoinRequest.Status.PENDING,
    ).first()
    if existing:
        return workspace.slug
    jr = WorkspaceJoinRequest.objects.create(workspace=workspace, user=user)
    if notify_admins:
        try:
            _notify_workspace_admins_join_request(jr)
        except Exception:
            pass
    return workspace.slug


def _maybe_auto_request_join(user, requested_slug=None):
    """가입 신청 자동 생성.
    1) `requested_slug` 가 주어지면 해당 워크스페이스로 신청 (사용자가 폼에서 직접 선택한 경우)
    2) 안 주어졌고 후보가 정확히 1개면 그 워크스페이스로 자동 신청
    3) 그 외엔 None — 사용자가 셀렉트 페이지에서 고르도록 위임
    """
    from apps.workspaces.models import Workspace

    if requested_slug:
        try:
            workspace = Workspace.objects.get(slug=requested_slug)
        except Workspace.DoesNotExist:
            return None
        return _create_join_request(user, workspace)

    candidates = list(Workspace.objects.exclude(members__member=user)[:2])
    if len(candidates) != 1:
        return None
    return _create_join_request(user, candidates[0])
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
                # 초대 토큰으로 가입 = 이메일 소유 증명 + 관리자 승인의 증거.
                # 멤버 생성을 accept 엔드포인트로 미루면 이메일 케이스 미스매치 등으로
                # 가입은 됐는데 멤버가 안 만들어지는 사고가 난다. 여기서 즉시 처리.
                from apps.workspaces.models import WorkspaceMember
                WorkspaceMember.objects.get_or_create(
                    workspace=invite.workspace,
                    member=user,
                    defaults={"role": invite.role},
                )
                invite.status = WorkspaceInvitation.Status.ACCEPTED
                invite.save(update_fields=["status"])
                return Response(
                    {
                        "detail": "초대 수락 완료. 바로 로그인할 수 있습니다.",
                        "email_verification_required": False,
                        "auto_activated": True,
                        # 프론트가 로그인 후 /invite/{token} 대신 워크스페이스로 직진하도록 응답에 포함.
                        # 초대는 이미 ACCEPTED 상태라 다시 /invite/{token} 으로 가면 만료 에러가 난다.
                        "workspace_slug": invite.workspace.slug,
                    },
                    status=status.HTTP_201_CREATED,
                )

        # 사용자가 폼에서 직접 고른 워크스페이스 (있으면 등록 시점부터 가입 신청 + 어드민 알림 발송)
        requested_slug = request.data.get("workspace_slug") or None

        if self._is_smtp_configured():
            # 등록 시점에 가입 신청을 미리 만들어두고 어드민에 알림 — 사용자가 이메일 인증을
            # 마치는 동안 어드민이 승인 큐에서 보고 결정할 수 있도록.
            requested_workspace_slug = _maybe_auto_request_join(user, requested_slug)

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
                    f"인증을 완료하면 워크스페이스 관리자의 가입 승인을 기다리게 됩니다.\n"
                    f"승인이 완료되면 워크스페이스에 입장할 수 있습니다.\n"
                    f"이 링크는 24시간 후 만료됩니다."
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
            )
            return Response(
                {"detail": "가입 완료. 이메일을 확인하여 인증을 완료해주세요.",
                 "email_verification_required": True,
                 "requested_workspace": requested_workspace_slug},
                status=status.HTTP_201_CREATED,
            )
        else:
            # SMTP 미설정 → 이메일 인증 자동 완료. 승인 절차는 워크스페이스 단위에서만 수행.
            user.is_email_verified = True
            user.is_approved = True
            user.is_active = True
            user.save(update_fields=["is_email_verified", "is_approved", "is_active"])
            requested_workspace_slug = _maybe_auto_request_join(user, requested_slug)
            return Response(
                {"detail": "가입 완료. 바로 로그인할 수 있습니다.",
                 "email_verification_required": False, "auto_activated": True,
                 "requested_workspace": requested_workspace_slug,
                 "auto_requested_workspace": requested_workspace_slug},  # 호환
                status=status.HTTP_201_CREATED,
            )


class CustomTokenObtainPairView(TokenObtainPairView):
    """로그인 — 분당 5회 throttle + django-axes lockout(5회 실패 시 15분 잠금).

    SimpleJWT 가 자체 인증 로직을 쓰는 탓에 axes 의 미들웨어/백엔드 자동 잠금이
    적용되지 않아, 진입 시점에 직접 is_locked 체크 + 실패 시 user_login_failed
    signal 발화로 axes 카운터를 갱신한다.
    """
    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request, *args, **kwargs):
        from axes.handlers.proxy import AxesProxyHandler
        from .lockout import lockout_response

        username = request.data.get("email") or request.data.get("username") or ""
        credentials = {"username": username}

        # 진입 시점 잠금 확인 — credentials 명시 안 함. axes 가 AXES_USERNAME_FORM_FIELD(email)로
        # request.POST 에서 직접 추출해 lookup 한다. 명시 전달 시 fallback lookup 이 안 매칭되는 이슈 회피.
        if AxesProxyHandler.is_locked(request):
            return lockout_response(request, credentials)

        response = super().post(request, *args, **kwargs)

        # 실패면 axes handler 직접 호출 — signal 우회로 카운터 확실히 증가
        if response.status_code != 200 and username:
            AxesProxyHandler.user_login_failed(
                sender=self.__class__,
                credentials=credentials,
                request=request,
            )
            if AxesProxyHandler.is_locked(request):
                return lockout_response(request, credentials)
        elif response.status_code == 200 and username:
            # 성공 시 카운터 리셋
            AxesProxyHandler.user_logged_in(
                sender=self.__class__,
                request=request,
                user=getattr(request, "user", None),
            )

        return response


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = MeSerializer
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get_object(self):
        return self.request.user

    def perform_update(self, serializer):
        # avatar 필드가 변경된 경우 기존 파일은 물리 삭제 (mediafiles 누적 방지)
        import os
        import uuid

        SENTINEL = object()
        old_avatar = serializer.instance.avatar if serializer.instance.avatar else None
        new_avatar = serializer.validated_data.get("avatar", SENTINEL)

        # 업로드 직전 파일명을 UUID 로 교체 — 같은 원본명(avatar.jpg) 이 여러 유저에서
        # 충돌하거나 덮어쓰이지 않도록 보장
        if new_avatar is not SENTINEL and new_avatar is not None and hasattr(new_avatar, "name"):
            ext = os.path.splitext(new_avatar.name)[1].lower() or ".jpg"
            new_avatar.name = f"{uuid.uuid4().hex}{ext}"

        serializer.save()
        if new_avatar is not SENTINEL and old_avatar and old_avatar != new_avatar:
            try:
                old_avatar.delete(save=False)
            except Exception as exc:
                logger.warning("avatar 구파일 삭제 실패 user=%s: %s", serializer.instance.pk, exc)



class IconUploadView(APIView):
    """사용자 지정 아이콘 업로드 — 프로젝트/카테고리/스페이스 등 아이콘 선택기에서 공용으로 사용.

    요청: multipart/form-data, field=file (이미지 파일, 5MB 이하)
    응답: { "url": "/media/icons/<uuid>.jpg" }

    저장 파일은 업로더 ID 메타 없이 media 에 놓이고, icon_prop JSON({type:"image", url}) 으로 참조됨.
    화이트리스트 확장자만 허용하고 MIME 시작 패턴만 가볍게 검증 (실제 유효 이미지 검증은 Pillow).
    """
    parser_classes = [MultiPartParser]

    MAX_SIZE = 5 * 1024 * 1024  # 5MB
    ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"}

    def post(self, request):
        import os
        import uuid
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile

        file_obj = request.FILES.get("file")
        if file_obj is None:
            return Response({"detail": "file 필드가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)

        if file_obj.size > self.MAX_SIZE:
            return Response(
                {"detail": f"이미지는 {self.MAX_SIZE // (1024 * 1024)}MB 이하만 업로드할 수 있습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ext = os.path.splitext(file_obj.name)[1].lower()
        if ext not in self.ALLOWED_EXTS:
            return Response({"detail": "허용되지 않는 이미지 형식입니다."}, status=status.HTTP_400_BAD_REQUEST)

        # MIME 은 환경 따라 들쭉날쭉하므로 image/ 로 시작하거나 비어 있으면 통과
        ct = getattr(file_obj, "content_type", "") or ""
        if ct and not ct.startswith("image/"):
            return Response({"detail": "이미지 파일만 업로드할 수 있습니다."}, status=status.HTTP_400_BAD_REQUEST)

        # 랜덤 파일명으로 저장 — 원본명은 보존하지 않음 (추후 추적 필요 없음)
        name = f"icons/{uuid.uuid4().hex}{ext}"
        saved_path = default_storage.save(name, ContentFile(file_obj.read()))
        url = settings.MEDIA_URL + saved_path

        return Response({"url": url}, status=status.HTTP_201_CREATED)


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
        # 이메일 인증 = 본인 확인 + 활성화. 시스템 단위 관리자 승인 단계 제거,
        # 승인은 워크스페이스 단위(WorkspaceJoinRequest)에서만 수행한다.
        user.is_email_verified = True
        user.is_approved = True
        user.is_active = True
        user.save(update_fields=["is_email_verified", "is_approved", "is_active"])

        token_obj.is_used = True
        token_obj.save(update_fields=["is_used"])

        auto_requested = _maybe_auto_request_join(user)
        if auto_requested:
            detail = "이메일 인증이 완료되었습니다. 워크스페이스 관리자 승인을 기다려 주세요."
        else:
            detail = "이메일 인증이 완료되었습니다. 로그인 후 워크스페이스에 가입 신청해 주세요."
        return Response({
            "detail": detail,
            "auto_requested_workspace": auto_requested,
        })


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


