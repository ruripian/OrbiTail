from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsSuperUser
from .models import Workspace, WorkspaceMember, WorkspaceInvitation, WorkspaceJoinRequest


def _notify_workspace_admins_join_request(join_request):
    """가입 신청 시 해당 워크스페이스의 Admin/Owner 들에게만 알림 발송.
    슈퍼유저(시스템 관리자)는 워크스페이스 운영 알림 흐름과 분리 — 본인이 멤버여도 제외.
    다른 워크스페이스 어드민에게도 가지 않음.
    """
    from apps.notifications.models import Notification

    workspace = join_request.workspace
    user = join_request.user
    admin_ids = list(
        WorkspaceMember.objects
        .filter(workspace=workspace, role__gte=WorkspaceMember.Role.ADMIN)
        .exclude(member=user)
        .exclude(member__is_superuser=True)   # 슈퍼유저는 워크스페이스 알림 대상 아님
        .values_list("member_id", flat=True)
    )
    if not admin_ids:
        return
    msg = f"{user.display_name}님이 '{workspace.name}' 워크스페이스 가입을 신청했습니다."
    Notification.objects.bulk_create([
        Notification(
            recipient_id=admin_id,
            actor=user,
            type=Notification.Type.JOIN_REQUESTED,
            workspace=workspace,
            message=msg,
        )
        for admin_id in admin_ids
    ])
    # WebSocket 브로드캐스트 — 어드민 클라이언트에서 즉시 뱃지 갱신
    try:
        from apps.notifications.signals import _broadcast_to_workspace
        _broadcast_to_workspace(workspace.slug, {
            "type": "notification.new",
            "notification_type": Notification.Type.JOIN_REQUESTED,
            "message": msg,
            "actor_name": user.display_name,
        })
    except Exception:
        pass


def _notify_user_join_decision(join_request, approved: bool):
    """가입 신청 처리 시 신청자에게 결과 알림."""
    from apps.notifications.models import Notification

    workspace = join_request.workspace
    actor = join_request.decided_by
    if not actor:
        return
    if approved:
        ntype = Notification.Type.JOIN_APPROVED
        msg = f"'{workspace.name}' 워크스페이스 가입이 승인되었습니다."
    else:
        ntype = Notification.Type.JOIN_REJECTED
        msg = f"'{workspace.name}' 워크스페이스 가입 신청이 거절되었습니다."
    Notification.objects.create(
        recipient=join_request.user,
        actor=actor,
        type=ntype,
        workspace=workspace,
        message=msg,
    )
from .serializers import (
    WorkspaceSerializer,
    WorkspaceMemberSerializer,
    WorkspaceInvitationSerializer,
    WorkspaceInvitationCreateSerializer,
    WorkspaceJoinRequestSerializer,
)


class WorkspaceListCreateView(generics.ListCreateAPIView):
    serializer_class = WorkspaceSerializer

    def get_queryset(self):
        return Workspace.objects.filter(members__member=self.request.user)


class WorkspacePublicListView(generics.ListAPIView):
    """공개 워크스페이스 목록 — 비로그인 회원가입 폼에서 가입할 워크스페이스를 고를 때 사용.
    민감 정보 없이 id/name/slug/member_count 만 노출.
    """
    serializer_class = WorkspaceSerializer
    permission_classes = [permissions.AllowAny]
    queryset = Workspace.objects.all()
    pagination_class = None  # 셀렉터에서 한 번에 보여줘야 함


class WorkspaceJoinableListView(generics.ListAPIView):
    """사용자가 아직 멤버가 아닌 워크스페이스 — 초대 없이 로그인 시 가입 후보 노출용.

    프론트는 사용자가 1개 멤버십도 없는 상태에서 호출. 1개면 자동 join, 여러 개면 셀렉터 표시.
    승인된(is_approved=True) 사용자만 노출 — 관리자 승인 우회 방지.
    """
    serializer_class = WorkspaceSerializer

    def get_queryset(self):
        user = self.request.user
        # 이메일 인증을 통과한 사용자만 후보 노출. 시스템 단위 승인은 더 이상 사용하지 않음.
        if not user.is_email_verified and not user.is_staff:
            return Workspace.objects.none()
        return Workspace.objects.exclude(members__member=user)


class WorkspaceJoinRequestCreateView(APIView):
    """초대 없이 워크스페이스 가입 신청 — 워크스페이스 관리자 승인 필요.

    동작:
    - 이미 멤버면 200 (already_member=True)
    - 승인 대기 중이면 200 (existing 신청 반환)
    - 그 외엔 새 PENDING 신청 생성
    슈퍼어드민(is_staff)은 즉시 멤버 추가 — 승인 절차 우회.
    """

    def post(self, request, slug):
        user = request.user
        try:
            workspace = Workspace.objects.get(slug=slug)
        except Workspace.DoesNotExist:
            return Response({"detail": "워크스페이스를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        # 이미 멤버
        if WorkspaceMember.objects.filter(workspace=workspace, member=user).exists():
            return Response({
                "already_member": True,
                "workspace_slug": workspace.slug,
                "detail": "이미 멤버입니다.",
            })

        # 이메일 미인증은 신청 차단 (이메일 본인 확인이 셀프 가입의 전제)
        if not user.is_email_verified and not user.is_staff:
            return Response(
                {"detail": "이메일 인증 후 가입 신청이 가능합니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        message = (request.data or {}).get("message", "")[:1000]
        existing = WorkspaceJoinRequest.objects.filter(
            workspace=workspace, user=user,
            status=WorkspaceJoinRequest.Status.PENDING,
        ).first()
        if existing:
            return Response(WorkspaceJoinRequestSerializer(existing).data)

        join_request = WorkspaceJoinRequest.objects.create(
            workspace=workspace, user=user, message=message,
        )
        try:
            _notify_workspace_admins_join_request(join_request)
        except Exception:
            pass
        return Response(
            WorkspaceJoinRequestSerializer(join_request).data,
            status=status.HTTP_201_CREATED,
        )


class MyJoinRequestsView(generics.ListAPIView):
    """내가 보낸 가입 신청 — 워크스페이스 셀렉트 페이지에서 진행상태 표시"""
    serializer_class = WorkspaceJoinRequestSerializer

    def get_queryset(self):
        return WorkspaceJoinRequest.objects.select_related(
            "workspace", "decided_by",
        ).filter(user=self.request.user)


class MyJoinRequestCancelView(APIView):
    """내가 보낸 PENDING 신청 취소"""

    def post(self, request, request_id):
        try:
            jr = WorkspaceJoinRequest.objects.get(id=request_id, user=request.user)
        except WorkspaceJoinRequest.DoesNotExist:
            return Response({"detail": "신청을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
        if jr.status != WorkspaceJoinRequest.Status.PENDING:
            return Response({"detail": "이미 처리된 신청입니다."}, status=status.HTTP_400_BAD_REQUEST)
        jr.status = WorkspaceJoinRequest.Status.CANCELED
        jr.decided_at = timezone.now()
        jr.save(update_fields=["status", "decided_at", "updated_at"])
        return Response(WorkspaceJoinRequestSerializer(jr).data)


class WorkspaceJoinRequestAdminListView(generics.ListAPIView):
    """워크스페이스 어드민 — 받은 가입 신청 목록.
    기본 필터: status=pending. ?status=all 이면 전체.
    """
    serializer_class = WorkspaceJoinRequestSerializer

    def get_queryset(self):
        slug = self.kwargs["slug"]
        # 어드민 권한 확인
        membership = WorkspaceMember.objects.filter(
            workspace__slug=slug, member=self.request.user,
        ).first()
        if not membership or membership.role < WorkspaceMember.Role.ADMIN:
            return WorkspaceJoinRequest.objects.none()
        qs = WorkspaceJoinRequest.objects.select_related(
            "workspace", "user", "decided_by",
        ).filter(workspace__slug=slug)
        status_param = self.request.query_params.get("status", "pending")
        if status_param != "all":
            qs = qs.filter(status=status_param)
        return qs


class WorkspaceJoinRequestDecisionView(APIView):
    """어드민 — 가입 신청 승인/거절. POST body: {"action": "approve"|"reject"}"""

    def post(self, request, slug, request_id):
        membership = WorkspaceMember.objects.filter(
            workspace__slug=slug, member=request.user,
        ).first()
        if not membership or membership.role < WorkspaceMember.Role.ADMIN:
            return Response(
                {"detail": "관리자만 가입 신청을 처리할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            jr = WorkspaceJoinRequest.objects.select_related("workspace", "user").get(
                id=request_id, workspace__slug=slug,
            )
        except WorkspaceJoinRequest.DoesNotExist:
            return Response({"detail": "신청을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        if jr.status != WorkspaceJoinRequest.Status.PENDING:
            return Response({"detail": "이미 처리된 신청입니다."}, status=status.HTTP_400_BAD_REQUEST)

        action = (request.data or {}).get("action")
        if action == "approve":
            WorkspaceMember.objects.get_or_create(
                workspace=jr.workspace, member=jr.user,
                defaults={"role": WorkspaceMember.Role.MEMBER},
            )
            jr.status = WorkspaceJoinRequest.Status.APPROVED
        elif action == "reject":
            jr.status = WorkspaceJoinRequest.Status.REJECTED
        else:
            return Response({"detail": "action 은 approve|reject 중 하나여야 합니다."},
                            status=status.HTTP_400_BAD_REQUEST)

        jr.decided_by = request.user
        jr.decided_at = timezone.now()
        jr.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])

        try:
            _notify_user_join_decision(jr, approved=(action == "approve"))
        except Exception:
            pass
        return Response(WorkspaceJoinRequestSerializer(jr).data)

    def create(self, request, *args, **kwargs):
        """워크스페이스 생성은 슈퍼어드민(is_staff 또는 is_superuser) 전용."""
        if not (request.user.is_staff or request.user.is_superuser):
            return Response(
                {"detail": "워크스페이스 생성은 슈퍼어드민만 할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().create(request, *args, **kwargs)


class WorkspaceDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = WorkspaceSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return Workspace.objects.filter(members__member=self.request.user)

    def perform_destroy(self, instance):
        """워크스페이스 삭제 — Owner 또는 슈퍼어드민(is_staff)만 가능"""
        if self.request.user.is_staff:
            instance.delete()
            return
        membership = WorkspaceMember.objects.filter(
            workspace=instance, member=self.request.user,
        ).first()
        if membership is None or membership.role != WorkspaceMember.Role.OWNER:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("워크스페이스 삭제는 소유자 또는 슈퍼어드민만 할 수 있습니다.")
        instance.delete()

    def update(self, request, *args, **kwargs):
        """워크스페이스 정보 수정은 Admin 이상만"""
        instance = self.get_object()
        membership = WorkspaceMember.objects.filter(
            workspace=instance, member=request.user,
        ).first()
        if membership is None or membership.role < WorkspaceMember.Role.ADMIN:
            return Response(
                {"detail": "워크스페이스 정보 수정은 관리자 이상만 가능합니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)


class WorkspaceMemberListView(generics.ListAPIView):
    serializer_class = WorkspaceMemberSerializer

    def get_queryset(self):
        return WorkspaceMember.objects.filter(
            workspace__slug=self.kwargs["slug"],
            workspace__members__member=self.request.user,
        )


class WorkspaceMemberDetailView(APIView):
    """워크스페이스 멤버 역할 변경(PATCH) / 제거(DELETE)

    규칙:
    - 요청자는 해당 워크스페이스 Admin 이상이어야 함
    - Owner 역할로 승격/강등은 Owner만 가능 (소유자 이전과 동일)
    - 마지막 Owner는 강등/제거 불가 (최소 1명 Owner 유지)
    - Owner 역할 부여 시: 기존 Owner는 Admin으로 자동 강등 + Workspace.owner 필드 동기화
    - 본인이 Admin인 경우에도 다른 Admin의 역할을 수정할 수 있음
      (단, Owner 승격은 Owner만, Owner 강등도 Owner만)
    """

    def _get_membership_and_check_admin(self, request, slug):
        """요청자의 멤버십 + Admin 이상 권한 확인"""
        try:
            requester_membership = WorkspaceMember.objects.select_related("workspace").get(
                workspace__slug=slug, member=request.user,
            )
        except WorkspaceMember.DoesNotExist:
            return None, Response(
                {"detail": "워크스페이스 멤버가 아닙니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if requester_membership.role < WorkspaceMember.Role.ADMIN:
            return None, Response(
                {"detail": "관리자 이상만 멤버를 관리할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return requester_membership, None

    def _get_target(self, slug, member_id):
        return WorkspaceMember.objects.select_related("workspace", "member").filter(
            workspace__slug=slug, id=member_id,
        ).first()

    def patch(self, request, slug, member_id):
        requester_membership, err = self._get_membership_and_check_admin(request, slug)
        if err:
            return err

        target = self._get_target(slug, member_id)
        if target is None:
            return Response({"detail": "멤버를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        new_role = request.data.get("role")
        if new_role is None:
            return Response({"detail": "role이 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            new_role = int(new_role)
        except (TypeError, ValueError):
            return Response({"detail": "role 값이 올바르지 않습니다."}, status=status.HTTP_400_BAD_REQUEST)

        valid_roles = {r.value for r in WorkspaceMember.Role}
        if new_role not in valid_roles:
            return Response({"detail": "role 값이 올바르지 않습니다."}, status=status.HTTP_400_BAD_REQUEST)

        workspace = requester_membership.workspace

        # Owner 관련 작업은 Owner만 가능
        is_owner_change = (
            new_role == WorkspaceMember.Role.OWNER
            or target.role == WorkspaceMember.Role.OWNER
        )
        if is_owner_change and requester_membership.role != WorkspaceMember.Role.OWNER:
            return Response(
                {"detail": "소유자 변경은 현재 소유자만 할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # 마지막 Owner 강등 방지
        if target.role == WorkspaceMember.Role.OWNER and new_role != WorkspaceMember.Role.OWNER:
            owner_count = WorkspaceMember.objects.filter(
                workspace=workspace, role=WorkspaceMember.Role.OWNER,
            ).count()
            if owner_count <= 1:
                return Response(
                    {"detail": "마지막 소유자는 강등할 수 없습니다. 먼저 다른 멤버를 소유자로 지정하세요."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Owner 승격 = 소유자 이전: 기존 Owner들은 Admin으로 강등 + Workspace.owner 이전
        if new_role == WorkspaceMember.Role.OWNER and target.role != WorkspaceMember.Role.OWNER:
            WorkspaceMember.objects.filter(
                workspace=workspace, role=WorkspaceMember.Role.OWNER,
            ).update(role=WorkspaceMember.Role.ADMIN)
            workspace.owner = target.member
            workspace.save(update_fields=["owner"])

        target.role = new_role
        target.save(update_fields=["role"])
        return Response(WorkspaceMemberSerializer(target).data)

    def delete(self, request, slug, member_id):
        requester_membership, err = self._get_membership_and_check_admin(request, slug)
        if err:
            return err

        target = self._get_target(slug, member_id)
        if target is None:
            return Response({"detail": "멤버를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        # Owner는 Owner만 제거 가능 + 마지막 Owner 보호
        if target.role == WorkspaceMember.Role.OWNER:
            if requester_membership.role != WorkspaceMember.Role.OWNER:
                return Response(
                    {"detail": "소유자를 제거하려면 소유자 권한이 필요합니다."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            owner_count = WorkspaceMember.objects.filter(
                workspace=requester_membership.workspace,
                role=WorkspaceMember.Role.OWNER,
            ).count()
            if owner_count <= 1:
                return Response(
                    {"detail": "마지막 소유자는 제거할 수 없습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # 본인 제거 금지 — 본인은 leave API(추후)나 탈퇴로 나가야 함
        if target.member_id == request.user.id:
            return Response(
                {"detail": "본인을 제거할 수 없습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target_user = target.member
        target.delete()

        # 마지막 워크스페이스 추방 = 계정 hard-delete.
        # 같은 이메일로 재가입을 허용하기 위해 row 를 완전히 제거한다.
        # 작성물(이슈/문서/댓글 등) FK 는 SET_NULL 로 두었으므로 콘텐츠는 보존되고
        # 작성자 표시만 빈 칸/익명 처리된다.
        # is_staff(슈퍼유저)는 시스템 관리자라 워크스페이스 0개여도 살려둔다.
        remaining = WorkspaceMember.objects.filter(member=target_user).count()
        if remaining == 0 and not target_user.is_staff:
            target_user.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceInvitationListCreateView(APIView):
    """워크스페이스 초대 목록 조회 + 발송 (Admin 이상만)"""

    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug, members__member=request.user)
        invitations = WorkspaceInvitation.objects.filter(workspace=workspace).order_by("-created_at")
        serializer = WorkspaceInvitationSerializer(invitations, many=True)
        return Response(serializer.data)

    def post(self, request, slug):
        # Admin 이상 권한 확인
        try:
            membership = WorkspaceMember.objects.get(
                workspace__slug=slug, member=request.user
            )
        except WorkspaceMember.DoesNotExist:
            return Response(
                {"detail": "워크스페이스 멤버가 아닙니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if membership.role < WorkspaceMember.Role.ADMIN:
            return Response(
                {"detail": "초대 권한이 없습니다. Admin 이상만 초대할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = WorkspaceInvitationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        workspace = membership.workspace

        # 이미 해당 워크스페이스 멤버인지 확인
        if WorkspaceMember.objects.filter(
            workspace=workspace, member__email=data["email"]
        ).exists():
            return Response(
                {"detail": "이미 워크스페이스 멤버입니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 기존 pending 초대가 있으면 취소 후 재발송
        WorkspaceInvitation.objects.filter(
            workspace=workspace, email=data["email"], status=WorkspaceInvitation.Status.PENDING
        ).update(status=WorkspaceInvitation.Status.REVOKED)

        # 초대 생성 (7일 유효)
        invitation = WorkspaceInvitation.objects.create(
            workspace=workspace,
            email=data["email"],
            role=data["role"],
            invited_by=request.user,
            message=data.get("message", ""),
            expires_at=timezone.now() + timedelta(days=7),
        )

        # 초대 이메일 발송 — HTML + 텍스트 멀티파트
        invite_url = f"{settings.FRONTEND_URL}/invite/{invitation.token}"
        role_label = dict(WorkspaceMember.Role.choices).get(data["role"], "Member")

        # 역할별 뱃지 색상 (HTML 템플릿용)
        role_colors = {
            10: {"bg": "#f1f5f9", "color": "#64748b", "border": "#cbd5e1"},   # guest
            15: {"bg": "#dbeafe", "color": "#2563eb", "border": "#bfdbfe"},   # member
            20: {"bg": "#ede9fe", "color": "#7c3aed", "border": "#ddd6fe"},   # admin
            25: {"bg": "#fef3c7", "color": "#d97706", "border": "#fde68a"},   # owner
        }
        rc = role_colors.get(data["role"], role_colors[15])

        context = {
            "workspace_name":    workspace.name,
            "workspace_initial": workspace.name[:1].upper() if workspace.name else "?",
            "inviter_name":      request.user.display_name,
            "recipient_email":   data["email"],
            "role_label":        role_label,
            "role_bg":           rc["bg"],
            "role_color":        rc["color"],
            "role_border":       rc["border"],
            "message":           data.get("message", ""),
            "invite_url":        invite_url,
        }
        text_body = render_to_string("emails/workspace_invitation.txt", context)
        html_body = render_to_string("emails/workspace_invitation.html", context)

        mail = EmailMultiAlternatives(
            subject=f"[OrbiTail] {workspace.name} 워크스페이스 초대",
            body=text_body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[data["email"]],
        )
        mail.attach_alternative(html_body, "text/html")
        mail.send(fail_silently=False)

        return Response(
            WorkspaceInvitationSerializer(invitation).data,
            status=status.HTTP_201_CREATED,
        )


class WorkspaceInvitationRevokeView(APIView):
    """초대 취소 (Admin 이상)"""

    def post(self, request, slug, invitation_id):
        try:
            membership = WorkspaceMember.objects.get(
                workspace__slug=slug, member=request.user
            )
        except WorkspaceMember.DoesNotExist:
            return Response(status=status.HTTP_403_FORBIDDEN)

        if membership.role < WorkspaceMember.Role.ADMIN:
            return Response(
                {"detail": "권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN
            )

        try:
            invitation = WorkspaceInvitation.objects.get(
                id=invitation_id,
                workspace=membership.workspace,
                status=WorkspaceInvitation.Status.PENDING,
            )
        except WorkspaceInvitation.DoesNotExist:
            return Response(
                {"detail": "초대를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND
            )

        invitation.status = WorkspaceInvitation.Status.REVOKED
        invitation.save()
        return Response({"detail": "초대가 취소되었습니다."})


class InvitationDetailView(APIView):
    """토큰으로 초대 정보 조회 — 인증 불필요"""
    permission_classes = [permissions.AllowAny]

    def get(self, request, token):
        try:
            invitation = WorkspaceInvitation.objects.select_related(
                "workspace", "invited_by"
            ).get(token=token)
        except WorkspaceInvitation.DoesNotExist:
            return Response(
                {"detail": "유효하지 않은 초대 링크입니다."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not invitation.is_valid():
            return Response(
                {"detail": "만료되었거나 이미 처리된 초대입니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({
            "id": str(invitation.id),
            "workspace_name": invitation.workspace.name,
            "workspace_slug": invitation.workspace.slug,
            "email": invitation.email,
            "role": invitation.role,
            "invited_by_name": invitation.invited_by.display_name,
            "message": invitation.message,
            "expires_at": invitation.expires_at.isoformat(),
        })


class AdminWorkspaceListView(generics.ListAPIView):
    """슈퍼유저용 전체 워크스페이스 목록"""
    permission_classes = [IsSuperUser]
    serializer_class = WorkspaceSerializer

    def get_queryset(self):
        qs = Workspace.objects.select_related("owner").all().order_by("-created_at")
        search = self.request.query_params.get("search", "").strip()
        if search:
            from django.db.models import Q
            qs = qs.filter(Q(name__icontains=search) | Q(slug__icontains=search))
        return qs


class AdminWorkspaceCreateView(APIView):
    """슈퍼유저가 임의 소유자를 지정해 워크스페이스를 생성.

    요청 바디: { name, slug, owner_id }
    """
    permission_classes = [IsSuperUser]

    def post(self, request):
        from apps.accounts.models import User
        from apps.audit.models import log_admin_action

        name = (request.data.get("name") or "").strip()
        slug = (request.data.get("slug") or "").strip()
        owner_id = request.data.get("owner_id")

        if not name or not slug or not owner_id:
            return Response(
                {"detail": "name, slug, owner_id 가 모두 필요합니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Workspace.objects.filter(slug=slug).exists():
            return Response({"detail": "이미 사용 중인 slug 입니다."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            owner = User.objects.get(pk=owner_id)
        except User.DoesNotExist:
            return Response({"detail": "소유자로 지정할 사용자를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        workspace = Workspace.objects.create(name=name, slug=slug, owner=owner)
        WorkspaceMember.objects.create(
            workspace=workspace, member=owner, role=WorkspaceMember.Role.OWNER,
        )

        log_admin_action(
            actor=request.user,
            action="workspace_create",
            target_type="workspace",
            target_id=workspace.id,
            target_label=workspace.name,
            metadata={"slug": workspace.slug, "owner_email": owner.email},
        )
        return Response(WorkspaceSerializer(workspace).data, status=status.HTTP_201_CREATED)


class AdminWorkspaceDeleteView(APIView):
    """슈퍼유저가 임의 워크스페이스를 삭제"""
    permission_classes = [IsSuperUser]

    def delete(self, request, slug):
        from apps.audit.models import log_admin_action
        try:
            workspace = Workspace.objects.get(slug=slug)
        except Workspace.DoesNotExist:
            return Response({"detail": "워크스페이스를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        ws_id = workspace.id
        ws_name = workspace.name
        workspace.delete()

        log_admin_action(
            actor=request.user,
            action="workspace_delete",
            target_type="workspace",
            target_id=ws_id,
            target_label=ws_name,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminWorkspaceOwnerView(APIView):
    """슈퍼유저 또는 현재 Owner 가 워크스페이스 소유자를 이관.

    요청 바디: { owner_id }
    """
    permission_classes = [IsSuperUser]

    def patch(self, request, slug):
        from apps.accounts.models import User
        from apps.audit.models import log_admin_action

        try:
            workspace = Workspace.objects.get(slug=slug)
        except Workspace.DoesNotExist:
            return Response({"detail": "워크스페이스를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        new_owner_id = request.data.get("owner_id")
        if not new_owner_id:
            return Response({"detail": "owner_id 가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            new_owner = User.objects.get(pk=new_owner_id)
        except User.DoesNotExist:
            return Response({"detail": "사용자를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        old_owner_email = workspace.owner.email if workspace.owner else ""

        # 기존 Owner들을 Admin으로 강등
        WorkspaceMember.objects.filter(
            workspace=workspace, role=WorkspaceMember.Role.OWNER,
        ).update(role=WorkspaceMember.Role.ADMIN)

        # 새 owner 의 멤버십이 없으면 생성, 있으면 OWNER로 승격
        membership, _ = WorkspaceMember.objects.get_or_create(
            workspace=workspace, member=new_owner,
            defaults={"role": WorkspaceMember.Role.OWNER},
        )
        if membership.role != WorkspaceMember.Role.OWNER:
            membership.role = WorkspaceMember.Role.OWNER
            membership.save(update_fields=["role"])

        workspace.owner = new_owner
        workspace.save(update_fields=["owner", "updated_at"])

        log_admin_action(
            actor=request.user,
            action="workspace_owner",
            target_type="workspace",
            target_id=workspace.id,
            target_label=workspace.name,
            metadata={"from": old_owner_email, "to": new_owner.email},
        )
        return Response(WorkspaceSerializer(workspace).data)


class InvitationAcceptView(APIView):
    """초대 수락 — 로그인 필수, 이메일 강제 매칭"""

    def post(self, request, token):
        try:
            invitation = WorkspaceInvitation.objects.select_related("workspace").get(
                token=token
            )
        except WorkspaceInvitation.DoesNotExist:
            return Response(
                {"detail": "유효하지 않은 초대 링크입니다."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not invitation.is_valid():
            return Response(
                {"detail": "만료되었거나 이미 처리된 초대입니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 이메일 강제 매칭 — 초대 이메일과 로그인 유저의 이메일이 일치해야 함
        # 대소문자 무시: Django normalize_email 은 도메인만 소문자화하고 local 부분은 보존하므로,
        # 초대자가 대문자 섞어 입력했을 때 가입자 이메일과 정확히 일치하지 않을 수 있음
        if request.user.email.lower() != invitation.email.lower():
            return Response(
                {
                    "detail": f"이 초대는 {invitation.email} 앞으로 발송되었습니다. "
                    f"해당 이메일 계정으로 로그인해주세요.",
                    "invited_email": invitation.email,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # 이미 멤버인지 확인
        if WorkspaceMember.objects.filter(
            workspace=invitation.workspace, member=request.user
        ).exists():
            # 이미 멤버면 초대만 accepted로 변경
            invitation.status = WorkspaceInvitation.Status.ACCEPTED
            invitation.save()
            return Response({
                "detail": "이미 해당 워크스페이스의 멤버입니다.",
                "workspace_slug": invitation.workspace.slug,
            })

        # 멤버 생성
        WorkspaceMember.objects.create(
            workspace=invitation.workspace,
            member=request.user,
            role=invitation.role,
        )

        invitation.status = WorkspaceInvitation.Status.ACCEPTED
        invitation.save()

        return Response({
            "detail": "초대를 수락했습니다.",
            "workspace_slug": invitation.workspace.slug,
        })
