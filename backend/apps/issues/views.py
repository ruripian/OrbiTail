from datetime import timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import generics, filters, status
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from .models import Issue, IssueComment, IssueActivity, IssueAttachment, IssueLink, IssueNodeLink, IssueRequest, IssueTemplate, Label
from .serializers import (
    IssueSerializer,
    IssueSearchSerializer,
    IssueCommentSerializer,
    IssueActivitySerializer,
    IssueAttachmentSerializer,
    IssueLinkSerializer,
    IssueNodeLinkSerializer,
    IssueRequestSerializer,
    IssueTemplateSerializer,
    LabelSerializer,
)


def _ws_broadcast(workspace_slug, event):
    """이슈 변경 사항을 워크스페이스 WebSocket 그룹에 브로드캐스트.
    queryset.update() 등 post_save 시그널을 타지 않는 작업에서 직접 호출."""
    try:
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(f"workspace_{workspace_slug}", event)
    except Exception:
        pass


def _actor_color(user) -> str:
    """변경자 색 — recently-changed strip 표시용. user.id 기반 deterministic hue."""
    if user is None:
        return ""
    explicit = getattr(user, "brand_color", "") or ""
    if explicit:
        return explicit
    h = abs(hash(str(getattr(user, "id", "")))) % 360
    return f"hsl({h}, 70%, 55%)"


def _get_effective_perms(user, project_id):
    """유저의 프로젝트 멤버십을 조회하고 effective_perms를 반환.
    멤버가 아니면 None, 멤버이면 {"can_edit":..., "can_archive":..., ...} dict."""
    from apps.projects.models import ProjectMember
    try:
        pm = ProjectMember.objects.get(project_id=project_id, member=user)
        return pm.effective_perms
    except ProjectMember.DoesNotExist:
        return None


def _check_perm(user, project_id, perm_key):
    """특정 권한 키(can_edit/can_archive/can_delete/can_purge)를 확인.
    Returns: (has_perm: bool, error_response: Response | None)"""
    perms = _get_effective_perms(user, project_id)
    if perms is None:
        return False, Response(
            {"detail": "프로젝트 멤버만 접근할 수 있습니다."},
            status=status.HTTP_403_FORBIDDEN,
        )
    if not perms.get(perm_key, False):
        return False, Response(
            {"detail": f"이 작업에 대한 권한이 없습니다. ({perm_key})"},
            status=status.HTTP_403_FORBIDDEN,
        )
    return True, None


class IssueListCreateView(generics.ListCreateAPIView):
    serializer_class = IssueSerializer
    pagination_class = None  # 캘린더/타임라인 등 전체 이슈 필요 — 페이지네이션 해제
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["state", "state__group", "priority", "assignees", "label", "category", "sprint"]
    search_fields = ["title"]
    ordering_fields = ["sort_order", "created_at", "updated_at", "priority", "sequence_id"]

    def get_queryset(self):
        from apps.projects.models import Project, ProjectMember
        # ?include_sub_issues=true → 하위 이슈까지 포함 (타임라인 계층 뷰용)
        include_children = self.request.query_params.get("include_sub_issues") == "true"
        base_filter = {
            "project_id": self.kwargs["project_pk"],
            "deleted_at__isnull": True,
            "archived_at__isnull": True,
        }
        if not include_children:
            base_filter["parent"] = None
        qs = (
            Issue.objects.filter(**base_filter)
            .filter(
                Q(project__members__member=self.request.user) |
                Q(project__network=Project.Network.PUBLIC)
            )
            .distinct()
            .prefetch_related("assignees", "label")
            .select_related("state", "created_by")
        )

        # 스프린트 필터가 명시적으로 지정되지 않은 경우,
        # 완료/취소된 스프린트에 속한 이슈를 기본 목록에서 제외
        if "sprint" not in self.request.query_params:
            qs = qs.filter(
                Q(sprint__isnull=True) |
                Q(sprint__status__in=["draft", "active"])
            )
        return qs

    def create(self, request, *args, **kwargs):
        """이슈 생성은 can_edit 권한 필요"""
        ok, err = _check_perm(request.user, self.kwargs["project_pk"], "can_edit")
        if not ok:
            return err
        return super().create(request, *args, **kwargs)


class IssueDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = IssueSerializer

    def get_queryset(self):
        from apps.projects.models import Project
        return (
            Issue.objects.filter(
                project_id=self.kwargs["project_pk"],
                deleted_at__isnull=True,
            )
            .filter(
                Q(project__members__member=self.request.user) |
                Q(project__network=Project.Network.PUBLIC)
            )
            .distinct()
            .prefetch_related("assignees", "label")
            .select_related("state", "created_by")
        )

    def update(self, request, *args, **kwargs):
        ok, err = _check_perm(request.user, self.kwargs["project_pk"], "can_edit")
        if not ok:
            return err
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        ok, err = _check_perm(request.user, self.kwargs["project_pk"], "can_delete")
        if not ok:
            return err
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        # 소프트 삭제: 모든 깊이의 하위 이슈 포함
        now = timezone.now()
        descendant_ids = IssueArchiveView._collect_descendant_ids(instance.id)
        if descendant_ids:
            Issue.objects.filter(id__in=descendant_ids, deleted_at__isnull=True).update(deleted_at=now)
        instance.deleted_at = now
        instance.save(update_fields=["deleted_at"])

    def perform_update(self, serializer):
        old = serializer.instance
        old_sprint_id = old.sprint_id
        # 저장 전 추적 필드 값 캡처 (스칼라 필드만)
        old_values = {
            "title":    old.title,
            "priority": old.priority,
            "state":    str(old.state_id) if old.state_id else "",
        }
        updated = serializer.save()
        new_values = {
            "title":    updated.title,
            "priority": updated.priority,
            "state":    str(updated.state_id) if updated.state_id else "",
        }
        # 변경된 필드에 대한 활동 로그를 일괄 생성
        activities = [
            IssueActivity(
                issue=updated,
                actor=self.request.user,
                verb="updated",
                field=field,
                old_value=old_val or None,
                new_value=new_values[field] or None,
            )
            for field, old_val in old_values.items()
            if old_val != new_values[field]
        ]
        if activities:
            IssueActivity.objects.bulk_create(activities)

        # 스프린트(sprint) 변경 시 하위 이슈도 동일 스프린트로 자동 배정
        if updated.sprint_id != old_sprint_id:
            updated.sub_issues.filter(deleted_at__isnull=True).update(sprint=updated.sprint)


class IssueCommentListCreateView(generics.ListCreateAPIView):
    serializer_class = IssueCommentSerializer

    def get_queryset(self):
        return IssueComment.objects.filter(issue_id=self.kwargs["issue_pk"])

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["issue_id"] = self.kwargs["issue_pk"]
        return context


class IssueCommentDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = IssueCommentSerializer

    def get_queryset(self):
        return IssueComment.objects.filter(
            issue_id=self.kwargs["issue_pk"],
            actor=self.request.user,
        )


class IssueActivityListView(generics.ListAPIView):
    serializer_class = IssueActivitySerializer

    def get_queryset(self):
        return IssueActivity.objects.filter(issue_id=self.kwargs["issue_pk"])


class WorkspaceRecentIssuesView(generics.ListAPIView):
    """워크스페이스 전체에서 최근 수정된 이슈 10개 — 대시보드용"""
    serializer_class = IssueSerializer

    def get_queryset(self):
        from apps.projects.models import Project
        return (
            Issue.objects.filter(
                workspace__slug=self.kwargs["workspace_slug"],
                parent=None,
                deleted_at__isnull=True,
                archived_at__isnull=True,
            )
            .filter(
                Q(project__members__member=self.request.user) |
                Q(project__network=Project.Network.PUBLIC)
            )
            .distinct()
            .prefetch_related("assignees", "label")
            .select_related("state", "created_by", "project")
            .order_by("-updated_at")[:10]
        )


class WorkspaceIssueSearchView(generics.ListAPIView):
    """워크스페이스 전체 이슈 검색 — Cmd+K 전역 검색용

    쿼리 파라미터:
      ?search=키워드  — 이슈 제목 부분 일치 (icontains)
      최대 20개 반환, 최신 수정 순
    """
    serializer_class = IssueSearchSerializer

    def get_queryset(self):
        from apps.projects.models import Project
        qs = (
            Issue.objects.filter(
                workspace__slug=self.kwargs["workspace_slug"],
                deleted_at__isnull=True,
                archived_at__isnull=True,
            )
            .filter(
                Q(project__members__member=self.request.user) |
                Q(project__network=Project.Network.PUBLIC)
            )
            .distinct()
            .prefetch_related("assignees", "label")
            .select_related("state", "created_by", "project")
            .order_by("-updated_at")
        )
        search = self.request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(title__icontains=search)

        # 고급 필터 — 프론트 Cmd+K에서 파싱된 구문 파라미터
        priority = self.request.query_params.get("priority")
        if priority:
            qs = qs.filter(priority=priority)
        state_group = self.request.query_params.get("state_group")
        if state_group:
            qs = qs.filter(state__group=state_group)
        assignee = self.request.query_params.get("assignee")
        if assignee == "me":
            qs = qs.filter(assignees=self.request.user)
        elif assignee:
            qs = qs.filter(assignees__id=assignee)

        return qs[:20]


class IssueRestoreView(generics.GenericAPIView):
    """소프트 삭제된 이슈를 휴지통에서 복구"""
    serializer_class = IssueSerializer

    def get_queryset(self):
        return Issue.objects.filter(
            project_id=self.kwargs["project_pk"],
            project__members__member=self.request.user,
            deleted_at__isnull=False,  # 삭제된 것만 조회 가능
        )

    def post(self, request, *args, **kwargs):
        instance = self.get_object()
        saved_at = instance.deleted_at
        # 모든 깊이의 하위 이슈도 복구 (같은 deleted_at 시점 기준)
        descendant_ids = IssueArchiveView._collect_descendant_ids(instance.id)
        if descendant_ids:
            Issue.objects.filter(id__in=descendant_ids, deleted_at=saved_at).update(deleted_at=None)
        instance.deleted_at = None
        instance.save(update_fields=["deleted_at"])
        return Response(IssueSerializer(instance, context={"request": request}).data)


class IssueTrashListView(generics.ListAPIView):
    """프로젝트의 소프트 삭제된 이슈 목록 (휴지통)"""
    serializer_class = IssueSerializer

    def get_queryset(self):
        return (
            Issue.objects.filter(
                project_id=self.kwargs["project_pk"],
                project__members__member=self.request.user,
                deleted_at__isnull=False,
            )
            .prefetch_related("assignees", "label")
            .select_related("state", "created_by")
            .order_by("-deleted_at")
        )


class IssueHardDeleteView(generics.DestroyAPIView):
    """소프트 삭제된 이슈를 영구 삭제 (되돌릴 수 없음)"""
    serializer_class = IssueSerializer

    def get_queryset(self):
        return Issue.objects.filter(
            project_id=self.kwargs["project_pk"],
            project__members__member=self.request.user,
            deleted_at__isnull=False,
        )

    def destroy(self, request, *args, **kwargs):
        ok, err = _check_perm(request.user, self.kwargs["project_pk"], "can_purge")
        if not ok:
            return err
        return super().destroy(request, *args, **kwargs)


class IssueArchiveListView(generics.ListAPIView):
    """프로젝트의 보관된 이슈 목록 — ?category=&sprint= 필터 지원"""
    serializer_class = IssueSerializer

    def get_queryset(self):
        qs = (
            Issue.objects.filter(
                project_id=self.kwargs["project_pk"],
                project__members__member=self.request.user,
                archived_at__isnull=False,
                deleted_at__isnull=True,
            )
            .prefetch_related("assignees", "label")
            .select_related("state", "created_by")
            .order_by("-archived_at")
        )
        # 카테고리/스프린트 필터
        category = self.request.query_params.get("category")
        sprint = self.request.query_params.get("sprint")
        if category:
            qs = qs.filter(category_id=category)
        if sprint:
            qs = qs.filter(sprint_id=sprint)
        return qs


class IssueArchiveView(APIView):
    """이슈 보관 (POST) / 보관 해제 (DELETE) — 모든 깊이의 하위 이슈 포함"""

    @staticmethod
    def _collect_descendant_ids(issue_id):
        """재귀적으로 모든 하위 이슈 ID를 수집"""
        ids = []
        children = Issue.objects.filter(parent_id=issue_id, deleted_at__isnull=True).values_list("id", flat=True)
        for child_id in children:
            ids.append(child_id)
            ids.extend(IssueArchiveView._collect_descendant_ids(child_id))
        return ids

    def post(self, request, workspace_slug, project_pk, pk):
        """이슈를 보관함으로 이동 (모든 하위 이슈 포함)"""
        ok, err = _check_perm(request.user, project_pk, "can_archive")
        if not ok:
            return err
        issue = get_object_or_404(
            Issue,
            pk=pk,
            project_id=project_pk,
            deleted_at__isnull=True,
        )
        if issue.archived_at:
            return Response({"detail": "이미 보관된 이슈입니다."}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.now()
        issue.archived_at = now
        issue.save(update_fields=["archived_at"])
        # 모든 깊이의 하위 이슈도 함께 보관
        descendant_ids = self._collect_descendant_ids(issue.id)
        if descendant_ids:
            Issue.objects.filter(id__in=descendant_ids, archived_at__isnull=True).update(archived_at=now)
        _ws_broadcast(workspace_slug, {
            "type": "issue.archived",
            "issue_id": str(pk),
            "project_id": str(project_pk),
            "actor_color": _actor_color(request.user),
        })
        return Response(IssueSerializer(issue, context={"request": request}).data)

    def delete(self, request, workspace_slug, project_pk, pk):
        """보관된 이슈를 활성 상태로 복원 (모든 하위 이슈 포함)"""
        ok, err = _check_perm(request.user, project_pk, "can_archive")
        if not ok:
            return err
        issue = get_object_or_404(
            Issue,
            pk=pk,
            project_id=project_pk,
            archived_at__isnull=False,
            deleted_at__isnull=True,
        )
        saved_at = issue.archived_at
        issue.archived_at = None
        issue.save(update_fields=["archived_at"])
        descendant_ids = self._collect_descendant_ids(issue.id)
        if descendant_ids:
            Issue.objects.filter(id__in=descendant_ids, archived_at=saved_at).update(archived_at=None)
        _ws_broadcast(workspace_slug, {
            "type": "issue.archived",
            "issue_id": str(pk),
            "project_id": str(project_pk),
            "actor_color": _actor_color(request.user),
        })
        return Response(IssueSerializer(issue, context={"request": request}).data)


class IssueDuplicateView(APIView):
    """이슈 딥카피 — 하위 이슈 포함 전체 복제 (ID만 새로 생성)"""

    def _copy_issue(self, original, new_parent, request):
        """이슈 1개를 복제하고 하위 이슈도 재귀적으로 복제"""
        new_issue = Issue(
            title=original.title,
            description=original.description,
            description_html=original.description_html,
            priority=original.priority,
            state=original.state,
            project=original.project,
            workspace=original.workspace,
            category=original.category,
            sprint=original.sprint,
            parent=new_parent,
            due_date=original.due_date,
            start_date=original.start_date,
            estimate_point=original.estimate_point,
            sort_order=original.sort_order,
            created_by=request.user,
        )
        new_issue.save()
        # M2M 필드 복사
        new_issue.assignees.set(original.assignees.all())
        new_issue.label.set(original.label.all())
        # 하위 이슈 재귀 복제
        for child in original.sub_issues.filter(deleted_at__isnull=True, archived_at__isnull=True):
            self._copy_issue(child, new_issue, request)
        return new_issue

    def post(self, request, workspace_slug, project_pk, pk):
        original = get_object_or_404(
            Issue,
            pk=pk,
            project_id=project_pk,
            project__members__member=request.user,
            deleted_at__isnull=True,
        )
        new_issue = self._copy_issue(original, original.parent, request)
        return Response(
            IssueSerializer(new_issue, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class SubIssueListCreateView(generics.ListCreateAPIView):
    """특정 이슈의 하위 이슈 목록 조회 및 생성"""
    serializer_class = IssueSerializer

    def get_queryset(self):
        return (
            Issue.objects.filter(
                parent_id=self.kwargs["issue_pk"],
                project_id=self.kwargs["project_pk"],
                deleted_at__isnull=True,
                archived_at__isnull=True,
            )
            .prefetch_related("assignees", "label")
            .select_related("state", "created_by")
        )

    def perform_create(self, serializer):
        # 부모 이슈에서 project 주입, 클라이언트는 project를 별도로 전송해야 함
        parent = Issue.objects.get(
            id=self.kwargs["issue_pk"],
            project_id=self.kwargs["project_pk"],
        )
        serializer.save(parent=parent)


class IssueLinkListCreateView(generics.ListCreateAPIView):
    """이슈에 첨부된 외부 링크 목록 조회 및 생성"""
    serializer_class = IssueLinkSerializer

    def get_queryset(self):
        return IssueLink.objects.filter(issue_id=self.kwargs["issue_pk"])

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["issue_id"] = self.kwargs["issue_pk"]
        return context


class IssueLinkDetailView(generics.RetrieveUpdateDestroyAPIView):
    """이슈 링크 단건 수정/삭제 — 생성자 본인만 가능"""
    serializer_class = IssueLinkSerializer

    def get_queryset(self):
        return IssueLink.objects.filter(
            issue_id=self.kwargs["issue_pk"],
            created_by=self.request.user,
        )


class IssueNodeLinkListCreateView(generics.ListCreateAPIView):
    """이슈 간 그래프 링크 — 목록/생성.

    이슈 트리 경계를 넘는 자유 연결 (node 기능).
    조회: 이 이슈가 source/target 인 링크. 본인이 멤버인 프로젝트의 이슈만.
    생성: 이 URL 의 project_pk 에 대해 can_edit 권한 필요.
    """
    serializer_class = IssueNodeLinkSerializer

    def get_queryset(self):
        issue_id = self.kwargs["issue_pk"]
        # source 또는 target 어느 한쪽이라도 본인 멤버 프로젝트면 조회 가능
        return (
            IssueNodeLink.objects.filter(
                Q(source_id=issue_id) | Q(target_id=issue_id)
            )
            .filter(
                Q(source__project__members__member=self.request.user) |
                Q(target__project__members__member=self.request.user)
            )
            .distinct()
            .select_related("source", "target", "source__project", "target__project")
        )

    def create(self, request, *args, **kwargs):
        ok, err = _check_perm(request.user, self.kwargs["project_pk"], "can_edit")
        if not ok:
            return err
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class IssueNodeLinkDetailView(generics.RetrieveDestroyAPIView):
    """노드 링크 단건 조회/삭제. source 프로젝트의 멤버여야 접근 가능."""
    serializer_class = IssueNodeLinkSerializer
    lookup_field = "pk"

    def get_queryset(self):
        slug = self.kwargs["workspace_slug"]
        # 워크스페이스 스코프 + source 프로젝트 멤버 체크
        return (
            IssueNodeLink.objects.filter(source__workspace__slug=slug)
            .filter(source__project__members__member=self.request.user)
            .distinct()
            .select_related("source", "target", "source__project", "target__project")
        )

    def destroy(self, request, *args, **kwargs):
        link = self.get_object()
        ok, err = _check_perm(request.user, link.source.project_id, "can_edit")
        if not ok:
            return err
        return super().destroy(request, *args, **kwargs)


class ProjectNodeGraphView(APIView):
    """프로젝트 범위 노드 그래프 — 같은 프로젝트 꼭지 아래 이슈들 간 연결망.

    범위:
      - 노드: 해당 프로젝트에 속한 이슈
      - 엣지: 해당 프로젝트 이슈가 source 인 수동 node-link (프로젝트 경계를 넘는 링크 포함)
              + include_label_edges=true 인 경우 라벨 공유 자동 엣지(프로젝트 내부)
    """
    def get(self, request, workspace_slug, project_pk):
        include_label_edges = request.query_params.get("include_label_edges", "true").lower() != "false"
        manual_only = request.query_params.get("manual_only", "false").lower() == "true"
        # 부모-자식(sub-issue) 트리 엣지 — 기본 포함. Obsidian 스타일 기본 그래프에서 트리 구조 시각화.
        include_parent_edges = request.query_params.get("include_parent_edges", "true").lower() != "false"

        node_map = {}

        def add_node(issue, labels=None):
            nid = str(issue.id)
            if nid in node_map:
                if labels:
                    node_map[nid]["labels"] = labels
                return
            state_group = getattr(issue.state, "group", None) if issue.state_id and issue.state else None
            node_map[nid] = {
                "id": nid,
                "title": issue.title,
                "sequence_id": issue.sequence_id,
                "project_id": str(issue.project_id) if issue.project_id else None,
                "project_identifier": issue.project.identifier if issue.project_id else None,
                "state_group": state_group,
                "labels": labels or [],
                "external": str(issue.project_id) != str(project_pk),
                "category_id": str(issue.category_id) if issue.category_id else None,
                "is_field": bool(getattr(issue, "is_field", False)),
            }

        edge_data = []

        # 1) 프로젝트 내부 이슈 전체 — 노드로 추가. 고립된 이슈도 그래프에 표시.
        from .models import Issue
        project_issues = (
            Issue.objects
            .filter(project_id=project_pk, deleted_at__isnull=True, archived_at__isnull=True)
            .prefetch_related("label")
            .select_related("project", "state")
        )
        label_to_issues = {}
        for iss in project_issues:
            labels = list(iss.label.all())
            add_node(iss, labels=[{"id": str(l.id), "name": l.name, "color": l.color} for l in labels])
            for lbl in labels:
                label_to_issues.setdefault(str(lbl.id), []).append((str(iss.id), lbl))

            # 2) 부모-자식 트리 엣지
            if include_parent_edges and iss.parent_id:
                edge_data.append({
                    "id": f"parent:{iss.id}",
                    "source": str(iss.parent_id),
                    "target": str(iss.id),
                    "link_type": "parent",
                    "note": "",
                })

        # 3) 수동 node-link 엣지 (프로젝트 경계 넘는 링크 포함 → 외부 이슈 노드 추가)
        manual_edges = IssueNodeLink.objects.filter(
            source__project_id=project_pk,
        ).select_related(
            "source", "target", "source__project", "target__project",
            "source__state", "target__state",
        )
        for e in manual_edges:
            add_node(e.source)
            add_node(e.target)
            edge_data.append({
                "id": str(e.id),
                "source": str(e.source_id),
                "target": str(e.target_id),
                "link_type": e.link_type,
                "note": e.note,
            })

        # 4) 라벨 공유 자동 엣지 — manual_only 면 제외
        if include_label_edges and not manual_only:
            seen = set()
            for lbl_id, entries in label_to_issues.items():
                if len(entries) < 2:
                    continue
                for (a_id, a_lbl), (b_id, _b_lbl) in zip(entries, entries[1:]):
                    key = tuple(sorted([a_id, b_id, lbl_id]))
                    if key in seen:
                        continue
                    seen.add(key)
                    edge_data.append({
                        "id": f"label:{lbl_id}:{a_id}:{b_id}",
                        "source": a_id,
                        "target": b_id,
                        "link_type": "shared_label",
                        "note": a_lbl.name,
                        "label_id": lbl_id,
                        "label_color": a_lbl.color,
                    })

        return Response({
            "nodes": list(node_map.values()),
            "edges": edge_data,
        })


class WorkspaceNodeGraphView(APIView):
    """워크스페이스 전체 노드 링크 + 관련 이슈 요약 — 그래프 뷰 전용.

    응답:
    {
      "nodes": [{ id, title, sequence_id, project_id, project_identifier, state_group }, ...],
      "edges": [{ id, source, target, link_type, note }, ...]
    }
    """
    def get(self, request, workspace_slug):
        """그래프 데이터 + 라벨 기반 자동 클러스터 edge 포함.

        query params:
          include_label_edges=true|false (default true) — 같은 라벨을 공유하는 이슈들 사이에
            link_type='shared_label' 로 간주 edge 를 추가해 라벨 기반 클러스터 시각화 지원.
          manual_only=true — 수동 node-link 만 반환 (auto cluster 제외).
        """
        include_label_edges = request.query_params.get("include_label_edges", "true").lower() != "false"
        manual_only = request.query_params.get("manual_only", "false").lower() == "true"

        node_map = {}

        def add_node(issue, labels=None):
            nid = str(issue.id)
            if nid in node_map:
                return
            state_group = None
            if issue.state_id and issue.state:
                state_group = getattr(issue.state, "group", None)
            node_map[nid] = {
                "id": nid,
                "title": issue.title,
                "sequence_id": issue.sequence_id,
                "project_id": str(issue.project_id) if issue.project_id else None,
                "project_identifier": issue.project.identifier if issue.project_id else None,
                "state_group": state_group,
                "labels": labels or [],
                "is_field": bool(getattr(issue, "is_field", False)),
            }

        # 수동 node-links
        edges = IssueNodeLink.objects.filter(
            source__workspace__slug=workspace_slug,
        ).select_related(
            "source", "target", "source__project", "target__project",
            "source__state", "target__state",
        )

        edge_data = []
        for e in edges:
            add_node(e.source)
            add_node(e.target)
            edge_data.append({
                "id": str(e.id),
                "source": str(e.source_id),
                "target": str(e.target_id),
                "link_type": e.link_type,
                "note": e.note,
            })

        if not manual_only:
            # 그래프에 보일 수 있도록 워크스페이스 내 라벨이 있는 이슈를 모두 포함
            from .models import Issue, Label
            issues_with_labels = (
                Issue.objects
                .filter(workspace__slug=workspace_slug, deleted_at__isnull=True, archived_at__isnull=True)
                .prefetch_related("label")
                .select_related("project", "state")
            )
            label_to_issues = {}
            issue_labels = {}
            for iss in issues_with_labels:
                labels = list(iss.label.all())
                if not labels:
                    continue
                add_node(iss, labels=[{"id": str(l.id), "name": l.name, "color": l.color} for l in labels])
                issue_labels[str(iss.id)] = labels
                for lbl in labels:
                    label_to_issues.setdefault(str(lbl.id), []).append((str(iss.id), lbl))

            if include_label_edges:
                # 같은 라벨을 공유하는 이슈들 사이에 가벼운 자동 edge 생성 (중복 제거)
                seen = set()
                for lbl_id, entries in label_to_issues.items():
                    if len(entries) < 2:
                        continue
                    # 완전 그래프를 피하기 위해 연쇄만 연결 (i ↔ i+1)
                    for (a_id, a_lbl), (b_id, _b_lbl) in zip(entries, entries[1:]):
                        key = tuple(sorted([a_id, b_id, lbl_id]))
                        if key in seen:
                            continue
                        seen.add(key)
                        edge_data.append({
                            "id": f"label:{lbl_id}:{a_id}:{b_id}",
                            "source": a_id,
                            "target": b_id,
                            "link_type": "shared_label",
                            "note": a_lbl.name,
                            "label_id": lbl_id,
                            "label_color": a_lbl.color,
                        })

        return Response({
            "nodes": list(node_map.values()),
            "edges": edge_data,
        })


class IssueAttachmentListCreateView(generics.ListCreateAPIView):
    """이슈 첨부파일 목록 조회 및 업로드"""
    serializer_class = IssueAttachmentSerializer
    # multipart/form-data 업로드를 위해 parser 별도 설정 불필요 (DRF 기본 지원)

    def get_queryset(self):
        return IssueAttachment.objects.filter(issue_id=self.kwargs["issue_pk"])

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["issue_id"] = self.kwargs["issue_pk"]
        return context


class IssueAttachmentDetailView(generics.DestroyAPIView):
    """이슈 첨부파일 삭제 — 업로더 본인만 가능"""
    serializer_class = IssueAttachmentSerializer

    def get_queryset(self):
        return IssueAttachment.objects.filter(
            issue_id=self.kwargs["issue_pk"],
            uploaded_by=self.request.user,
        )


class WorkspaceMyIssuesView(generics.ListAPIView):
    """내가 배정된 이슈 — 워크스페이스 홈용 (완료/취소 제외)

    프론트에서 state_detail 기준으로 그룹핑하여 표시.
    완료(completed)/취소(cancelled) 그룹은 제외하여 "할 일" 중심으로 보여줌.
    """
    serializer_class = IssueSerializer

    def get_queryset(self):
        return (
            Issue.objects.filter(
                workspace__slug=self.kwargs["workspace_slug"],
                assignees=self.request.user,
                deleted_at__isnull=True,
                archived_at__isnull=True,
            )
            .exclude(state__group__in=["completed", "cancelled"])
            .select_related("state", "created_by", "project")
            .prefetch_related("assignees", "label")
            .order_by("state__sequence", "-updated_at")
        )


class IssueBulkUpdateView(APIView):
    """이슈 일괄 업데이트 — 상태/우선순위/담당자/라벨 일괄 변경

    PATCH /api/workspaces/:slug/projects/:id/issues/bulk/
    Body: { issue_ids: [uuid], updates: { state?, priority?, assignees?, label? } }
    """

    def patch(self, request, workspace_slug, project_pk):
        ok, err = _check_perm(request.user, project_pk, "can_edit")
        if not ok:
            return err

        issue_ids = request.data.get("issue_ids", [])
        updates = request.data.get("updates", {})

        if not issue_ids or not updates:
            return Response({"detail": "issue_ids와 updates가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)

        issues = Issue.objects.filter(
            id__in=issue_ids,
            project_id=project_pk,
            project__members__member=request.user,
            deleted_at__isnull=True,
        )

        if issues.count() != len(issue_ids):
            return Response({"detail": "일부 이슈를 찾을 수 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

        # M2M 필드 분리
        assignees = updates.pop("assignees", None)
        labels = updates.pop("label", None)

        # 스칼라 필드 일괄 업데이트
        if updates:
            issues.update(**updates)

        # M2M 필드 개별 처리
        if assignees is not None:
            for issue in issues:
                issue.assignees.set(assignees)
        if labels is not None:
            for issue in issues:
                issue.label.set(labels)

        # 활동 로그 일괄 생성
        activities = []
        for field, value in {**updates, **({"assignees": assignees} if assignees else {}), **({"label": labels} if labels else {})}.items():
            for issue in issues:
                activities.append(IssueActivity(
                    issue=issue, actor=request.user, verb="updated",
                    field=field, new_value=str(value),
                ))
        if activities:
            IssueActivity.objects.bulk_create(activities)

        _ws_broadcast(workspace_slug, {
            "type": "issue.bulk_updated",
            "project_id": str(project_pk),
            "actor_color": _actor_color(request.user),
        })
        return Response({"detail": f"{issues.count()}개 이슈가 업데이트되었습니다."})


class IssueBulkDeleteView(APIView):
    """이슈 일괄 소프트 삭제

    POST /api/workspaces/:slug/projects/:id/issues/bulk-delete/
    Body: { issue_ids: [uuid] }
    """

    def post(self, request, workspace_slug, project_pk):
        ok, err = _check_perm(request.user, project_pk, "can_delete")
        if not ok:
            return err

        issue_ids = request.data.get("issue_ids", [])
        if not issue_ids:
            return Response({"detail": "issue_ids가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        updated = Issue.objects.filter(
            id__in=issue_ids,
            project_id=project_pk,
            project__members__member=request.user,
            deleted_at__isnull=True,
        ).update(deleted_at=now)

        # 하위 이슈도 함께 소프트 삭제
        Issue.objects.filter(
            parent_id__in=issue_ids,
            deleted_at__isnull=True,
        ).update(deleted_at=now)

        _ws_broadcast(workspace_slug, {
            "type": "issue.bulk_deleted",
            "project_id": str(project_pk),
            "actor_color": _actor_color(request.user),
        })
        return Response({"detail": f"{updated}개 이슈가 삭제되었습니다."})


class ProjectIssueStatsView(APIView):
    """프로젝트 이슈 통계 — 대시보드 차트용

    응답 구조:
      by_state:    [{state_id, state_name, group, color, count}]
      by_priority: [{priority, count}]
      over_time:   [{date, created, completed}]  # 최근 30일
      by_assignee: [{user_id, display_name, avatar, count}]
    """

    def get(self, request, workspace_slug, project_pk):
        from apps.projects.models import Project
        # 필드(Field) 이슈는 상태/진척 개념이 없어 통계에서 제외.
        base_qs = Issue.objects.filter(
            project_id=project_pk,
            deleted_at__isnull=True,
            is_field=False,
        ).filter(
            Q(project__members__member=request.user) |
            Q(project__network=Project.Network.PUBLIC)
        ).distinct()

        # 1) 상태별 이슈 수 (state가 NULL인 이슈는 "미분류"로 처리)
        by_state = list(
            base_qs.filter(state__isnull=False)
            .values("state__id", "state__name", "state__group", "state__color")
            .annotate(count=Count("id"))
            .order_by("state__sequence")
        )
        by_state_data = [
            {
                "state_id": str(row["state__id"]),
                "state_name": row["state__name"],
                "group": row["state__group"],
                "color": row["state__color"],
                "count": row["count"],
            }
            for row in by_state
        ]
        # 미분류(state=NULL) 이슈 카운트 추가
        unassigned_count = base_qs.filter(state__isnull=True).count()
        if unassigned_count > 0:
            by_state_data.append({
                "state_id": "none",
                "state_name": "Unassigned",
                "group": "backlog",
                "color": "#9ca3af",
                "count": unassigned_count,
            })

        # 2) 우선순위별 이슈 수
        by_priority = list(
            base_qs.values("priority")
            .annotate(count=Count("id"))
            .order_by("priority")
        )

        # 3) 최근 30일 일별 생성/완료 추이
        thirty_days_ago = timezone.now() - timedelta(days=30)
        created_per_day = dict(
            base_qs.filter(created_at__gte=thirty_days_ago)
            .annotate(date=TruncDate("created_at"))
            .values("date")
            .annotate(count=Count("id"))
            .values_list("date", "count")
        )
        # 완료 = state group이 'completed'인 활동 로그 기준
        completed_per_day = dict(
            IssueActivity.objects.filter(
                issue__project_id=project_pk,
                issue__deleted_at__isnull=True,
                field="state",
                created_at__gte=thirty_days_ago,
            )
            .filter(
                new_value__in=list(
                    Issue.objects.filter(project_id=project_pk)
                    .values_list("state__id", flat=True)
                    .filter(state__group="completed")
                    .distinct()
                )
            )
            .annotate(date=TruncDate("created_at"))
            .values("date")
            .annotate(count=Count("id"))
            .values_list("date", "count")
        )
        over_time = []
        for i in range(30):
            d = (timezone.now() - timedelta(days=29 - i)).date()
            over_time.append({
                "date": d.isoformat(),
                "created": created_per_day.get(d, 0),
                "completed": completed_per_day.get(d, 0),
            })

        # 4) 담당자별 이슈 수
        from apps.accounts.serializers import UserSerializer
        by_assignee_raw = (
            base_qs.filter(assignees__isnull=False)
            .values("assignees__id", "assignees__display_name", "assignees__avatar")
            .annotate(count=Count("id"))
            .order_by("-count")[:10]
        )
        by_assignee = [
            {
                "user_id": str(row["assignees__id"]),
                "display_name": row["assignees__display_name"],
                "avatar": row["assignees__avatar"] or "",
                "count": row["count"],
            }
            for row in by_assignee_raw
        ]

        return Response({
            "by_state": by_state_data,
            "by_priority": by_priority,
            "over_time": over_time,
            "by_assignee": by_assignee,
        })


class LabelListCreateView(generics.ListCreateAPIView):
    serializer_class = LabelSerializer

    def get_queryset(self):
        return Label.objects.filter(project_id=self.kwargs["project_pk"])

    def perform_create(self, serializer):
        serializer.save(project_id=self.kwargs["project_pk"])


class LabelDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = LabelSerializer

    def get_queryset(self):
        return Label.objects.filter(project_id=self.kwargs["project_pk"])


class IssueTemplateListCreateView(generics.ListCreateAPIView):
    """이슈 템플릿 목록 조회 및 생성"""
    serializer_class = IssueTemplateSerializer

    def get_queryset(self):
        return IssueTemplate.objects.filter(project_id=self.kwargs["project_pk"])

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["project_pk"] = self.kwargs["project_pk"]
        return ctx


class IssueTemplateDetailView(generics.RetrieveUpdateDestroyAPIView):
    """이슈 템플릿 단건 조회/수정/삭제"""
    serializer_class = IssueTemplateSerializer

    def get_queryset(self):
        return IssueTemplate.objects.filter(project_id=self.kwargs["project_pk"])


class IssueDocumentLinksView(APIView):
    """이슈에 연결된 문서 목록 (역방향 조회)"""

    def get(self, request, workspace_slug, project_pk, pk):
        from apps.documents.models import DocumentIssueLink
        links = DocumentIssueLink.objects.filter(
            issue_id=pk,
            issue__project_id=project_pk,
        ).select_related("document")
        data = [
            {
                "id": str(link.id),
                "document_id": str(link.document_id),
                "document_title": link.document.title,
                "document_icon_prop": link.document.icon_prop,
                "space_id": str(link.document.space_id),
                "created_at": link.created_at.isoformat(),
            }
            for link in links
        ]
        return Response(data)


# ══════════════════════════════════════════════════════════════════
#  IssueRequest — 제출된 버그/기능 요청 큐
# ══════════════════════════════════════════════════════════════════

def _can_review_request(user, project) -> bool:
    """요청 승인/거절 가능 여부. 프로젝트의 request_review_policy 에 따라 결정.
       - all: 프로젝트 멤버 누구나 가능
       - admin: can_edit 권한이 있는 멤버만
    """
    from apps.projects.models import ProjectMember, Project
    try:
        pm = ProjectMember.objects.get(project=project, member=user)
    except ProjectMember.DoesNotExist:
        return False
    if project.request_review_policy == Project.RequestReviewPolicy.ADMIN:
        return bool(pm.effective_perms.get("can_edit", False))
    return True


class IssueRequestListCreateView(generics.ListCreateAPIView):
    """요청 목록 조회 + 신규 제출.

    가시성:
      - public: 프로젝트 멤버 누구나 조회
      - private: 제출자 본인 + can_edit 멤버만 조회
    필터: ?status=pending|approved|rejected
    """
    serializer_class = IssueRequestSerializer
    pagination_class = None

    def get_queryset(self):
        from apps.projects.models import Project
        project_pk = self.kwargs["project_pk"]
        user = self.request.user

        try:
            project = Project.objects.get(pk=project_pk, members__member=user)
        except Project.DoesNotExist:
            return IssueRequest.objects.none()

        perms = _get_effective_perms(user, project_pk) or {}
        can_edit = bool(perms.get("can_edit", False))

        qs = IssueRequest.objects.filter(project_id=project_pk).select_related(
            "submitted_by", "reviewer", "project", "approved_issue"
        )
        # 비공개 요청은 제출자 or can_edit 만
        if not can_edit:
            qs = qs.filter(Q(visibility="public") | Q(submitted_by=user))

        status_filter = self.request.query_params.get("status")
        if status_filter in {"pending", "approved", "rejected"}:
            qs = qs.filter(status=status_filter)
        return qs

    def perform_create(self, serializer):
        from apps.projects.models import Project
        project = Project.objects.get(pk=self.kwargs["project_pk"])
        serializer.save(
            project=project,
            workspace=project.workspace,
            submitted_by=self.request.user,
        )


class IssueRequestApproveView(APIView):
    """요청 승인 → Issue 로 변환.

    Body: { state, category?, sprint?, assignees?[], label?[], start_date?, due_date?, estimate_point? }
    """
    def post(self, request, workspace_slug, project_pk, pk):
        from apps.projects.models import Project
        try:
            project = Project.objects.select_related("workspace").get(pk=project_pk)
        except Project.DoesNotExist:
            return Response({"detail": "프로젝트를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        if not _can_review_request(request.user, project):
            return Response(
                {"detail": "요청 승인 권한이 없습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        req = get_object_or_404(IssueRequest, pk=pk, project_id=project_pk)
        if req.status != IssueRequest.Status.PENDING:
            return Response({"detail": "이미 처리된 요청입니다."}, status=status.HTTP_400_BAD_REQUEST)

        state_id = request.data.get("state")
        if not state_id:
            # 명시하지 않으면 프로젝트 기본 상태(unstarted) 사용
            from apps.projects.models import State
            default_state = (
                State.objects.filter(project=project, group="unstarted").order_by("sequence").first()
                or State.objects.filter(project=project).order_by("sequence").first()
            )
            if default_state is None:
                return Response({"detail": "프로젝트에 상태가 없어 이슈를 생성할 수 없습니다."}, status=400)
            state_id = default_state.id

        issue = Issue.objects.create(
            title=req.title,
            description_html=req.description_html,
            priority=req.priority,
            state_id=state_id,
            project=project,
            workspace=project.workspace,
            category_id=request.data.get("category") or None,
            sprint_id=request.data.get("sprint") or None,
            start_date=request.data.get("start_date") or None,
            due_date=request.data.get("due_date") or None,
            estimate_point=request.data.get("estimate_point") or None,
            created_by=req.submitted_by,  # 제출자를 생성자로 기록
        )
        assignee_ids = request.data.get("assignees") or []
        if assignee_ids:
            issue.assignees.set(assignee_ids)
        label_ids = request.data.get("label") or []
        # 자동 라벨 — 프로젝트에 bug/enhancement 라벨 있으면 kind 기준 첨부
        auto_name = "bug" if req.kind == IssueRequest.Kind.BUG else "enhancement"
        auto_label = Label.objects.filter(project=project, name__iexact=auto_name).first()
        if auto_label:
            label_ids = list({*label_ids, str(auto_label.id)})
        if label_ids:
            issue.label.set(label_ids)

        # 요청 상태 업데이트
        req.status = IssueRequest.Status.APPROVED
        req.reviewer = request.user
        req.reviewed_at = timezone.now()
        req.approved_issue = issue
        req.save(update_fields=["status", "reviewer", "reviewed_at", "approved_issue", "updated_at"])

        return Response({
            "request": IssueRequestSerializer(req, context={"request": request}).data,
            "issue": IssueSerializer(issue, context={"request": request}).data,
        })


class IssueRequestRejectView(APIView):
    """요청 거절 — 사유(선택) 저장하고 상태를 rejected 로."""
    def post(self, request, workspace_slug, project_pk, pk):
        from apps.projects.models import Project
        try:
            project = Project.objects.get(pk=project_pk)
        except Project.DoesNotExist:
            return Response({"detail": "프로젝트를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        if not _can_review_request(request.user, project):
            return Response({"detail": "요청 거절 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)

        req = get_object_or_404(IssueRequest, pk=pk, project_id=project_pk)
        if req.status != IssueRequest.Status.PENDING:
            return Response({"detail": "이미 처리된 요청입니다."}, status=status.HTTP_400_BAD_REQUEST)

        req.status = IssueRequest.Status.REJECTED
        req.reviewer = request.user
        req.reviewed_at = timezone.now()
        req.rejected_reason = (request.data.get("reason") or "").strip()
        req.save(update_fields=["status", "reviewer", "reviewed_at", "rejected_reason", "updated_at"])

        return Response(IssueRequestSerializer(req, context={"request": request}).data)


class IssueRequestDeleteView(APIView):
    """요청 삭제 — 제출자 본인(pending 상태만) 또는 관리자"""
    def delete(self, request, workspace_slug, project_pk, pk):
        req = get_object_or_404(IssueRequest, pk=pk, project_id=project_pk)
        from apps.projects.models import Project
        project = Project.objects.get(pk=project_pk)

        is_owner = req.submitted_by_id == request.user.id
        is_admin = _can_review_request(request.user, project)
        if not (is_admin or (is_owner and req.status == IssueRequest.Status.PENDING)):
            return Response({"detail": "이 요청을 삭제할 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
        req.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
