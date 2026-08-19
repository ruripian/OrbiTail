from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

from apps.accounts.models import User
from apps.workspaces.models import Workspace, WorkspaceMember
from .models import Project, ProjectMember, Category, Sprint, State, ProjectEvent, SavedFilter


def _project_readable_q(user):
    """프로젝트 읽기 권한 Q 필터 — 멤버이거나 PUBLIC 프로젝트.

    Personal 프로젝트(kind=personal)는 owner 본인에게만 노출.
    타인의 Personal 은 멤버십 자체가 없어 자연 차단되지만,
    명시 가드로 향후 멤버 추가 정책 변경 시에도 안전.
    """
    base = Q(members__member=user) | Q(network=Project.Network.PUBLIC)
    return base & (Q(kind=Project.Kind.NORMAL) | Q(owner=user))


def _project_readable_via_project_q(user):
    """프로젝트 하위 개체(Category, Sprint 등)용 읽기 권한 Q 필터"""
    base = Q(project__members__member=user) | Q(project__network=Project.Network.PUBLIC)
    return base & (Q(project__kind=Project.Kind.NORMAL) | Q(project__owner=user))
from .serializers import (
    ProjectSerializer,
    ProjectMemberSerializer,
    ProjectMemberCreateSerializer,
    CategorySerializer,
    SprintSerializer,
    StateSerializer,
    ProjectEventSerializer,
    SavedFilterSerializer,
)


class ProjectListCreateView(generics.ListCreateAPIView):
    serializer_class = ProjectSerializer

    def get_queryset(self):
        qs = Project.objects.filter(
            workspace__slug=self.kwargs["workspace_slug"],
        ).filter(
            _project_readable_q(self.request.user)
        ).distinct()
        # 사이드바/프로젝트 목록에는 NORMAL 만 노출 — Personal 은 마이 페이지 전용.
        # ?include_personal=true 가 명시되면 본인 Personal 도 포함(향후 디버그/관리 용도).
        if self.request.query_params.get("include_personal") != "true":
            qs = qs.filter(kind=Project.Kind.NORMAL)
        # 기본: 보관되지 않은 프로젝트만 반환. ?archived=true 시 보관된 프로젝트도 포함
        if self.request.query_params.get("archived") != "true":
            qs = qs.filter(archived_at__isnull=True)
        # ?member_only=true → 본인이 멤버인 프로젝트만. public 이라도 미가입이면 제외.
        if self.request.query_params.get("member_only") == "true":
            qs = qs.filter(members__member=self.request.user)
        return qs

    def get_serializer_context(self):
        # lead 검증 시 workspace가 필요하므로 context에 주입
        ctx = super().get_serializer_context()
        try:
            ctx["workspace"] = Workspace.objects.get(slug=self.kwargs["workspace_slug"])
        except Workspace.DoesNotExist:
            pass
        return ctx

    def perform_create(self, serializer):
        # workspace를 URL slug로 조회하여 자동 주입 — 프론트에서 workspace ID를 전송할 필요 없음
        workspace = get_object_or_404(Workspace, slug=self.kwargs["workspace_slug"])
        serializer.save(workspace=workspace, created_by=self.request.user)


class ProjectDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ProjectSerializer

    def get_queryset(self):
        return Project.objects.filter(
            workspace__slug=self.kwargs["workspace_slug"],
        ).filter(
            _project_readable_q(self.request.user)
        ).distinct()

    def update(self, request, *args, **kwargs):
        """수정은 프로젝트 멤버만 가능"""
        obj = self.get_object()
        if not ProjectMember.objects.filter(project=obj, member=request.user).exists():
            return Response({"detail": "프로젝트 멤버만 수정할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """삭제는 프로젝트 멤버만 가능"""
        obj = self.get_object()
        if not ProjectMember.objects.filter(project=obj, member=request.user).exists():
            return Response({"detail": "프로젝트 멤버만 삭제할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class ProjectIdentifierCheckView(APIView):
    """프로젝트 식별자 중복 검사 — GET ?identifier=ABC
       같은 워크스페이스 내 동일 식별자가 있는지 확인.
       exclude 파라미터로 현재 프로젝트를 제외할 수 있음 (수정 시). """

    def get(self, request, workspace_slug):
        identifier = request.query_params.get("identifier", "").strip().upper()
        exclude_id = request.query_params.get("exclude")
        if not identifier:
            return Response({"available": False, "reason": "empty"})

        qs = Project.objects.filter(
            workspace__slug=workspace_slug,
            identifier=identifier,
        )
        if exclude_id:
            qs = qs.exclude(pk=exclude_id)

        available = not qs.exists()
        return Response({"available": available, "identifier": identifier})


class ProjectArchiveView(APIView):
    """프로젝트 보관(POST) / 보관 해제(DELETE)"""

    def _get_project(self, request, workspace_slug, pk):
        return get_object_or_404(
            Project,
            pk=pk,
            workspace__slug=workspace_slug,
            members__member=request.user,
        )

    def post(self, request, workspace_slug, pk):
        project = self._get_project(request, workspace_slug, pk)
        if project.archived_at:
            return Response({"detail": "이미 보관된 프로젝트입니다."}, status=status.HTTP_400_BAD_REQUEST)
        project.archived_at = timezone.now()
        project.save(update_fields=["archived_at"])
        return Response(ProjectSerializer(project).data)

    def delete(self, request, workspace_slug, pk):
        project = self._get_project(request, workspace_slug, pk)
        if not project.archived_at:
            return Response({"detail": "보관되지 않은 프로젝트입니다."}, status=status.HTTP_400_BAD_REQUEST)
        project.archived_at = None
        project.save(update_fields=["archived_at"])
        return Response(ProjectSerializer(project).data)


# ── 프로젝트 탐색 / 참가 / 나가기 ──

class ProjectDiscoverView(generics.ListAPIView):
    """워크스페이스 내 공개 프로젝트 중 아직 참가하지 않은 프로젝트 목록"""
    serializer_class = ProjectSerializer

    def get_queryset(self):
        return Project.objects.filter(
            workspace__slug=self.kwargs["workspace_slug"],
            network=Project.Network.PUBLIC,
            archived_at__isnull=True,
        ).exclude(
            members__member=self.request.user,
        )


class ProjectJoinView(APIView):
    """공개 프로젝트에 즉시 MEMBER(참여)로 합류 — 편집 가능한 일반 멤버가 된다.

    탐색의 '참여'로만 호출된다. '보기'는 멤버십을 만들지 않고 공개 열람만 하므로
    이 엔드포인트를 거치지 않는다(PUBLIC 프로젝트는 비멤버도 조회 가능).
    """

    def post(self, request, workspace_slug, pk):
        project = get_object_or_404(
            Project,
            pk=pk,
            workspace__slug=workspace_slug,
            network=Project.Network.PUBLIC,
            archived_at__isnull=True,
        )
        # 이미 멤버인지 확인
        if ProjectMember.objects.filter(project=project, member=request.user).exists():
            return Response({"detail": "이미 참가한 프로젝트입니다."}, status=status.HTTP_400_BAD_REQUEST)

        pm = ProjectMember.objects.create(
            project=project,
            member=request.user,
            role=ProjectMember.Role.MEMBER,
        )
        return Response(ProjectMemberSerializer(pm).data, status=status.HTTP_201_CREATED)


class ProjectLeaveView(APIView):
    """프로젝트에서 본인 나가기 — 마지막 ADMIN이면 거부"""

    def post(self, request, workspace_slug, pk):
        pm = get_object_or_404(
            ProjectMember,
            project_id=pk,
            project__workspace__slug=workspace_slug,
            member=request.user,
        )
        # 마지막 ADMIN이면 나가기 불가
        if pm.role == ProjectMember.Role.ADMIN:
            admin_count = ProjectMember.objects.filter(
                project_id=pk, role=ProjectMember.Role.ADMIN,
            ).count()
            if admin_count <= 1:
                return Response(
                    {"detail": "마지막 관리자는 프로젝트를 나갈 수 없습니다. 다른 멤버를 관리자로 지정해주세요."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        pm.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── 프로젝트 멤버 관리 ──

class ProjectMemberListCreateView(generics.ListCreateAPIView):
    """프로젝트 멤버 목록 조회 / 추가"""

    def get_serializer_class(self):
        if self.request.method == "POST":
            return ProjectMemberCreateSerializer
        return ProjectMemberSerializer

    def get_queryset(self):
        return ProjectMember.objects.filter(
            project_id=self.kwargs["project_pk"],
        ).filter(
            _project_readable_via_project_q(self.request.user)
        ).distinct().select_related("member")

    def create(self, request, *args, **kwargs):
        serializer = ProjectMemberCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        project = get_object_or_404(Project, pk=self.kwargs["project_pk"])

        # 요청자가 프로젝트 Admin인지 확인
        requester_membership = ProjectMember.objects.filter(
            project=project, member=request.user, role=ProjectMember.Role.ADMIN,
        ).first()
        if not requester_membership:
            return Response(
                {"detail": "프로젝트 관리자만 멤버를 추가할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # 대상 유저가 워크스페이스 멤버인지 확인
        member = get_object_or_404(User, pk=serializer.validated_data["member_id"])
        if not WorkspaceMember.objects.filter(workspace=project.workspace, member=member).exists():
            return Response(
                {"detail": "워크스페이스 멤버만 프로젝트에 추가할 수 있습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 중복 방지
        pm, created = ProjectMember.objects.get_or_create(
            project=project,
            member=member,
            defaults={"role": serializer.validated_data.get("role", ProjectMember.Role.MEMBER)},
        )
        if not created:
            return Response(
                {"detail": "이미 프로젝트 멤버입니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(ProjectMemberSerializer(pm).data, status=status.HTTP_201_CREATED)


class ProjectMemberDetailView(generics.RetrieveUpdateDestroyAPIView):
    """프로젝트 멤버 역할 변경 / 제거

    보호 규칙:
    - Admin만 역할 변경/제거 가능
    - 마지막 Admin을 강등/제거하면 거부
    - 리더(Project.lead)인 멤버를 제거하면 lead=null로 자동 해제
      (또는 거부하고 먼저 lead 변경하도록 강제 — 정책 선택)
      → 본 구현은 자동 null 해제 방식
    """
    serializer_class = ProjectMemberSerializer

    def get_queryset(self):
        return ProjectMember.objects.filter(
            project_id=self.kwargs["project_pk"],
            project__members__member=self.request.user,
        ).select_related("member", "project")

    def _check_admin(self):
        """요청자가 프로젝트 Admin인지 확인"""
        return ProjectMember.objects.filter(
            project_id=self.kwargs["project_pk"],
            member=self.request.user,
            role=ProjectMember.Role.ADMIN,
        ).exists()

    def update(self, request, *args, **kwargs):
        if not self._check_admin():
            return Response(
                {"detail": "프로젝트 관리자만 역할을 변경할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        target = self.get_object()
        new_role = request.data.get("role", target.role)
        try:
            new_role = int(new_role)
        except (TypeError, ValueError):
            return Response({"detail": "role 값이 올바르지 않습니다."}, status=status.HTTP_400_BAD_REQUEST)

        # 마지막 Admin 강등 방지
        if target.role == ProjectMember.Role.ADMIN and new_role != ProjectMember.Role.ADMIN:
            admin_count = ProjectMember.objects.filter(
                project_id=self.kwargs["project_pk"], role=ProjectMember.Role.ADMIN,
            ).count()
            if admin_count <= 1:
                return Response(
                    {"detail": "마지막 관리자는 강등할 수 없습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self._check_admin():
            return Response(
                {"detail": "프로젝트 관리자만 멤버를 제거할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        target = self.get_object()

        # 마지막 Admin 제거 방지
        if target.role == ProjectMember.Role.ADMIN:
            admin_count = ProjectMember.objects.filter(
                project_id=self.kwargs["project_pk"], role=ProjectMember.Role.ADMIN,
            ).count()
            if admin_count <= 1:
                return Response(
                    {"detail": "마지막 관리자는 제거할 수 없습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # 리더인 멤버를 제거하면 lead=null로 자동 해제
        project = target.project
        if project.lead_id == target.member_id:
            project.lead = None
            project.save(update_fields=["lead"])

        return super().destroy(request, *args, **kwargs)


# ── 카테고리 관리 ──

class CategoryListCreateView(generics.ListCreateAPIView):
    serializer_class = CategorySerializer

    def get_queryset(self):
        return Category.objects.filter(
            project_id=self.kwargs["project_pk"],
        ).filter(
            _project_readable_via_project_q(self.request.user)
        ).distinct()

    def perform_create(self, serializer):
        serializer.save(project_id=self.kwargs["project_pk"])


class CategoryDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CategorySerializer

    def get_queryset(self):
        return Category.objects.filter(
            project_id=self.kwargs["project_pk"],
        ).filter(
            _project_readable_via_project_q(self.request.user)
        ).distinct()


class CategoryReorderView(generics.GenericAPIView):
    """카테고리 순서 변경 — POST { "order": ["id1", "id2", ...] }"""
    def post(self, request, *args, **kwargs):
        order = request.data.get("order", [])
        for idx, cat_id in enumerate(order):
            Category.objects.filter(
                id=cat_id, project_id=self.kwargs["project_pk"]
            ).update(sort_order=idx * 10000)
        return Response({"ok": True})


# ── 스프린트 관리 ──

class SprintListCreateView(generics.ListCreateAPIView):
    serializer_class = SprintSerializer

    def get_queryset(self):
        return Sprint.objects.filter(
            project_id=self.kwargs["project_pk"],
        ).filter(
            _project_readable_via_project_q(self.request.user)
        ).distinct()

    def perform_create(self, serializer):
        serializer.save(
            project_id=self.kwargs["project_pk"],
            created_by=self.request.user,
        )


class SprintDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = SprintSerializer

    def get_queryset(self):
        return Sprint.objects.filter(
            project_id=self.kwargs["project_pk"],
        ).filter(
            _project_readable_via_project_q(self.request.user)
        ).distinct()


class SprintStartView(APIView):
    """스프린트 시작 — draft → active.

    지라와 같은 규칙으로 **활성 스프린트는 한 번에 하나**만 둔다. 두 개가 동시에 활성이면
    "지금 하는 일"이 무엇인지가 흐려지고 번다운도 의미를 잃는다.
    """

    def post(self, request, workspace_slug, project_pk, pk):
        sprint = get_object_or_404(Sprint, pk=pk, project_id=project_pk)
        if sprint.status != Sprint.Status.DRAFT:
            return Response(
                {"detail": "예정 상태의 스프린트만 시작할 수 있습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        active = Sprint.objects.filter(
            project_id=project_pk, status=Sprint.Status.ACTIVE,
        ).exclude(pk=pk).first()
        if active:
            return Response(
                {"detail": f'이미 진행 중인 스프린트가 있습니다: "{active.name}". 먼저 완료해 주세요.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        sprint.status = Sprint.Status.ACTIVE
        sprint.save(update_fields=["status"])
        return Response(SprintSerializer(sprint).data)


class SprintCompleteView(APIView):
    """스프린트 완료 — active → completed. 남은 미완료 이슈를 어디로 보낼지 함께 정한다.

    body: { "move_to": "<sprint_id>" | "backlog" }
      - sprint_id : 그 스프린트로 이관(보통 다음 예정 스프린트)
      - backlog   : 스프린트에서 떼어냄(sprint=null)

    미완료 이슈를 그대로 두면 끝난 스프린트에 매달린 채 목록에서 사라진다
    (완료된 스프린트의 이슈는 기본 목록에서 제외되므로). 그래서 완료 시 반드시 처리한다.
    """

    def post(self, request, workspace_slug, project_pk, pk):
        sprint = get_object_or_404(Sprint, pk=pk, project_id=project_pk)
        if sprint.status != Sprint.Status.ACTIVE:
            return Response(
                {"detail": "진행 중인 스프린트만 완료할 수 있습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from apps.issues.models import Issue

        # 미완료 = 상태 그룹이 completed/cancelled 가 아닌 것
        unfinished = Issue.objects.filter(
            sprint=sprint, deleted_at__isnull=True, archived_at__isnull=True,
        ).exclude(state__group__in=["completed", "cancelled"])

        move_to = request.data.get("move_to") or "backlog"
        target_sprint = None
        if move_to != "backlog":
            target_sprint = Sprint.objects.filter(
                pk=move_to, project_id=project_pk,
            ).exclude(pk=pk).first()
            if not target_sprint:
                return Response(
                    {"detail": "옮길 스프린트를 찾을 수 없습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        moved = unfinished.count()
        unfinished.update(sprint=target_sprint)

        sprint.status = Sprint.Status.COMPLETED
        sprint.save(update_fields=["status"])
        return Response({
            **SprintSerializer(sprint).data,
            "moved_issues": moved,
            "moved_to": str(target_sprint.id) if target_sprint else "backlog",
        })


# ── 상태 관리 ──

class StateListCreateView(generics.ListCreateAPIView):
    serializer_class = StateSerializer

    def get_queryset(self):
        return State.objects.filter(
            project_id=self.kwargs["project_pk"],
        ).filter(
            _project_readable_via_project_q(self.request.user)
        ).distinct()

    def perform_create(self, serializer):
        serializer.save(project_id=self.kwargs["project_pk"])


class StateDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = StateSerializer

    def get_queryset(self):
        return State.objects.filter(
            project_id=self.kwargs["project_pk"],
        ).filter(
            _project_readable_via_project_q(self.request.user)
        ).distinct()


# ── 프로젝트 캘린더 이벤트 ──

def _ws_broadcast_event(project_id, event):
    """프로젝트 이벤트 변경 broadcast — SECRET 프로젝트는 멤버 한정 그룹.

    project_id 로 한 번 조회해 network 와 workspace 결정.
    """
    from apps.notifications.signals import _broadcast_to_project
    try:
        project = (
            Project.objects
            .select_related("workspace")
            .only("id", "network", "workspace__slug")
            .get(id=project_id)
        )
    except Project.DoesNotExist:
        return
    _broadcast_to_project(project, event)


class ProjectEventListCreateView(generics.ListCreateAPIView):
    """프로젝트 멤버 전체가 공유하는 캘린더 이벤트.
    ?from=YYYY-MM-DD&to=YYYY-MM-DD 로 날짜 범위 필터 가능."""
    serializer_class = ProjectEventSerializer
    pagination_class = None  # 캘린더는 전체 이벤트 필요 — PAGE_SIZE(50) 으로 잘리면 표시 누락

    def get_queryset(self):
        qs = ProjectEvent.objects.filter(
            project_id=self.kwargs["project_pk"],
        ).filter(
            _project_readable_via_project_q(self.request.user)
        ).distinct().select_related("created_by")
        date_from = self.request.query_params.get("from")
        date_to = self.request.query_params.get("to")
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        return qs

    def perform_create(self, serializer):
        event = serializer.save(
            project_id=self.kwargs["project_pk"],
            created_by=self.request.user,
        )
        _ws_broadcast_event(self.kwargs["project_pk"], {
            "type": "event.created",
            "project_id": str(self.kwargs["project_pk"]),
        })


class ProjectEventDetailView(generics.RetrieveUpdateDestroyAPIView):
    """이벤트 상세 / 수정 / 삭제 — 읽기는 PUBLIC 프로젝트도 가능, 수정/삭제는 멤버만."""
    serializer_class = ProjectEventSerializer

    def get_queryset(self):
        return ProjectEvent.objects.filter(
            project_id=self.kwargs["project_pk"],
        ).filter(
            _project_readable_via_project_q(self.request.user)
        ).distinct().select_related("created_by")

    def perform_update(self, serializer):
        serializer.save()
        _ws_broadcast_event(self.kwargs["project_pk"], {
            "type": "event.updated",
            "project_id": str(self.kwargs["project_pk"]),
        })

    def perform_destroy(self, instance):
        project_pk = str(instance.project_id)
        instance.delete()
        _ws_broadcast_event(project_pk, {
            "type": "event.deleted",
            "project_id": project_pk,
        })


class SavedFilterListCreateView(generics.ListCreateAPIView):
    """저장된 필터 프리셋 — 현재 사용자 본인 것만 CRUD"""
    serializer_class = SavedFilterSerializer
    pagination_class = None

    def get_queryset(self):
        return SavedFilter.objects.filter(
            project_id=self.kwargs["project_pk"],
            user=self.request.user,
        )

    def perform_create(self, serializer):
        serializer.save(
            project_id=self.kwargs["project_pk"],
            user=self.request.user,
        )


class SavedFilterDetailView(generics.RetrieveUpdateDestroyAPIView):
    """저장된 필터 프리셋 단건 수정/삭제"""
    serializer_class = SavedFilterSerializer

    def get_queryset(self):
        return SavedFilter.objects.filter(
            project_id=self.kwargs["project_pk"],
            user=self.request.user,
        )
