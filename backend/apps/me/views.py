"""마이 페이지 endpoints — 모든 워크스페이스의 본인 데이터 통합.

- /api/me/issues/         본인 담당자 이슈 (모든 워크스페이스)
- /api/me/personal-events/ 개인 일정 CRUD (본인만 보고 본인만 편집)
- /api/me/project-events/  본인이 참여하는 프로젝트 이벤트 (멤버 한정)
- /api/me/summary/         대시보드 카드용 카운트
"""
from datetime import date, timedelta

from django.db.models import Q, Count
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.issues.models import Issue
from apps.issues.serializers import IssueSerializer
from apps.projects.models import Project, ProjectEvent, ProjectMember
from apps.projects.serializers import ProjectEventSerializer
from .models import PersonalEvent
from .serializers import PersonalEventSerializer


def _user_member_project_ids(user):
    """사용자가 멤버인 프로젝트 id queryset — SECRET 누수 차단의 기본 단위."""
    return ProjectMember.objects.filter(member=user).values_list("project_id", flat=True)


class PersonalEventListCreateView(generics.ListCreateAPIView):
    """본인 개인 일정 목록 + 생성. ?from=YYYY-MM-DD&to=YYYY-MM-DD 로 범위 필터."""
    serializer_class = PersonalEventSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = PersonalEvent.objects.filter(user=self.request.user)
        date_from = self.request.query_params.get("from")
        date_to = self.request.query_params.get("to")
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class PersonalEventDetailView(generics.RetrieveUpdateDestroyAPIView):
    """개인 일정 상세 — 본인 것만 access."""
    serializer_class = PersonalEventSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return PersonalEvent.objects.filter(user=self.request.user)


class MeIssuesView(generics.ListAPIView):
    """본인이 담당자인 이슈 — 모든 워크스페이스. 마이 페이지의 캘린더/그래프/종합용.

    쿼리 파라미터:
      ?include_completed=true  완료/취소 상태도 포함 (기본은 미완료만)
      ?workspace=<slug>        특정 워크스페이스로 필터
    """
    serializer_class = IssueSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = (
            Issue.objects
            .filter(
                assignees=self.request.user,
                deleted_at__isnull=True,
                archived_at__isnull=True,
            )
            .select_related("state", "created_by", "project", "workspace")
            .prefetch_related("assignees", "label")
            .order_by("-updated_at")
        )
        if self.request.query_params.get("include_completed") != "true":
            qs = qs.exclude(state__group__in=["completed", "cancelled"])
        ws_slug = self.request.query_params.get("workspace")
        if ws_slug:
            qs = qs.filter(workspace__slug=ws_slug)
        return qs


class MeProjectEventsView(generics.ListAPIView):
    """본인이 참여하는 프로젝트 이벤트 — 모든 워크스페이스. is_global=True 면 멤버 전체 참여로 간주.

    쿼리 파라미터:
      ?from=YYYY-MM-DD&to=YYYY-MM-DD  날짜 범위
      ?workspace=<slug>                특정 워크스페이스로 필터
    """
    serializer_class = ProjectEventSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        member_project_ids = _user_member_project_ids(user)
        qs = (
            ProjectEvent.objects
            .filter(project_id__in=member_project_ids)
            .filter(Q(is_global=True) | Q(participants=user))
            .distinct()
            .select_related("project", "project__workspace", "created_by")
            .prefetch_related("participants")
            .order_by("date")
        )
        date_from = self.request.query_params.get("from")
        date_to = self.request.query_params.get("to")
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        ws_slug = self.request.query_params.get("workspace")
        if ws_slug:
            qs = qs.filter(project__workspace__slug=ws_slug)
        return qs


class MeSummaryView(APIView):
    """마이 페이지 종합 탭 카드 — 활성/오늘마감/이번주마감/지연 + 우선순위·프로젝트 분포.

    응답 구조:
      {
        "active_count":      활성 이슈(미완료) 총수,
        "due_today":         오늘 마감 이슈 수,
        "due_this_week":     이번 주(오늘~+7일) 마감 이슈 수,
        "overdue":           지연(오늘 이전 마감 + 미완료) 수,
        "by_priority":       [{priority, count}],
        "by_project":        [{project_id, project_name, project_identifier, workspace_slug, count}],
      }
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        today = date.today()
        week_end = today + timedelta(days=7)

        base = (
            Issue.objects
            .filter(
                assignees=user,
                deleted_at__isnull=True,
                archived_at__isnull=True,
            )
            .exclude(state__group__in=["completed", "cancelled"])
        )
        active_count = base.count()
        due_today = base.filter(due_date=today).count()
        due_this_week = base.filter(due_date__gte=today, due_date__lte=week_end).count()
        overdue = base.filter(due_date__lt=today).count()

        by_priority = list(
            base.values("priority")
            .annotate(count=Count("id"))
            .order_by("-count")
        )
        by_project = list(
            base.values(
                "project_id",
                "project__name",
                "project__identifier",
                "project__workspace__slug",
            )
            .annotate(count=Count("id"))
            .order_by("-count")
        )
        # 프론트가 쉽게 쓰도록 키 평탄화
        by_project = [
            {
                "project_id": str(row["project_id"]) if row["project_id"] else None,
                "project_name": row["project__name"],
                "project_identifier": row["project__identifier"],
                "workspace_slug": row["project__workspace__slug"],
                "count": row["count"],
            }
            for row in by_project
        ]

        return Response({
            "active_count": active_count,
            "due_today": due_today,
            "due_this_week": due_this_week,
            "overdue": overdue,
            "by_priority": by_priority,
            "by_project": by_project,
        }, status=status.HTTP_200_OK)
