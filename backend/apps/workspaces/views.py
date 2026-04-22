from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsSuperUser
from .models import Workspace, WorkspaceMember, WorkspaceInvitation
from .serializers import (
    WorkspaceSerializer,
    WorkspaceMemberSerializer,
    WorkspaceInvitationSerializer,
    WorkspaceInvitationCreateSerializer,
)


class WorkspaceListCreateView(generics.ListCreateAPIView):
    serializer_class = WorkspaceSerializer

    def get_queryset(self):
        return Workspace.objects.filter(members__member=self.request.user)

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

        target.delete()
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
        if request.user.email != invitation.email:
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
