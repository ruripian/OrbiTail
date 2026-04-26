from django.utils import timezone
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Notification, NotificationPreference, ProjectNotificationPreference
from .serializers import (
    NotificationSerializer,
    NotificationPreferenceSerializer,
    ProjectNotificationPreferenceSerializer,
)


class NotificationListView(generics.ListAPIView):
    """워크스페이스 내 내 알림 목록 (최신순, 최대 50개).

    기본: 보관되지 않은 알림만. ?archived=true 시 보관 알림만 (Archived 탭).
    """
    serializer_class = NotificationSerializer

    def get_queryset(self):
        qs = Notification.objects.filter(
            workspace__slug=self.kwargs["workspace_slug"],
            recipient=self.request.user,
        )
        archived_only = self.request.query_params.get("archived") == "true"
        if archived_only:
            qs = qs.filter(archived_at__isnull=False)
        else:
            qs = qs.filter(archived_at__isnull=True)
        return qs.select_related("actor", "issue", "issue__project")[:50]


class NotificationMarkReadView(APIView):
    """개별 알림 읽음 처리"""

    def patch(self, request, workspace_slug, pk):
        try:
            notification = Notification.objects.get(
                id=pk,
                workspace__slug=workspace_slug,
                recipient=request.user,
            )
        except Notification.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        notification.read = True
        notification.save(update_fields=["read"])
        return Response(NotificationSerializer(notification).data)


class NotificationArchiveView(APIView):
    """알림 보관 토글 — POST 보관, DELETE 복원"""

    def post(self, request, workspace_slug, pk):
        try:
            notification = Notification.objects.get(
                id=pk,
                workspace__slug=workspace_slug,
                recipient=request.user,
            )
        except Notification.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        notification.archived_at = timezone.now()
        # 보관과 동시에 읽음 처리 — 일반적으로 읽고 보관하는 흐름
        if not notification.read:
            notification.read = True
        notification.save(update_fields=["archived_at", "read"])
        return Response(NotificationSerializer(notification).data)

    def delete(self, request, workspace_slug, pk):
        try:
            notification = Notification.objects.get(
                id=pk,
                workspace__slug=workspace_slug,
                recipient=request.user,
            )
        except Notification.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        notification.archived_at = None
        notification.save(update_fields=["archived_at"])
        return Response(NotificationSerializer(notification).data)


class NotificationReadAllView(APIView):
    """워크스페이스 내 모든 알림 읽음 처리"""

    def post(self, request, workspace_slug):
        count = Notification.objects.filter(
            workspace__slug=workspace_slug,
            recipient=request.user,
            read=False,
        ).update(read=True)
        return Response({"marked": count})


class NotificationUnreadCountView(APIView):
    """미읽음 알림 수 — TopBar 뱃지 카운터용"""

    def get(self, request, workspace_slug):
        count = Notification.objects.filter(
            workspace__slug=workspace_slug,
            recipient=request.user,
            read=False,
        ).count()
        return Response({"count": count})


class NotificationPreferenceView(APIView):
    """현재 사용자의 전역 알림 환경설정 (이메일 발송 토글)"""

    def get(self, request):
        prefs = NotificationPreference.for_user(request.user)
        return Response(NotificationPreferenceSerializer(prefs).data)

    def patch(self, request):
        prefs = NotificationPreference.for_user(request.user)
        serializer = NotificationPreferenceSerializer(prefs, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ProjectNotificationPreferenceView(APIView):
    """현재 사용자의 특정 프로젝트 알림 환경설정.

    - 글로벌 타입은 NULL/T/F 로 상속/override
    - 프로젝트 전용: email_issue_created
    프로젝트 멤버만 접근 가능.
    """

    def _get_project(self, request, workspace_slug, project_pk):
        from apps.projects.models import Project, ProjectMember
        from django.db.models import Q
        # 멤버 여부 확인 — 비공개 프로젝트 차단
        try:
            project = Project.objects.filter(
                Q(members__member=request.user) | Q(network=Project.Network.PUBLIC),
                workspace__slug=workspace_slug,
                id=project_pk,
            ).distinct().get()
        except Project.DoesNotExist:
            return None
        return project

    def get(self, request, workspace_slug, project_pk):
        project = self._get_project(request, workspace_slug, project_pk)
        if not project:
            return Response(status=status.HTTP_404_NOT_FOUND)
        prefs = ProjectNotificationPreference.for_user_project(request.user, project)
        return Response(ProjectNotificationPreferenceSerializer(prefs).data)

    def patch(self, request, workspace_slug, project_pk):
        project = self._get_project(request, workspace_slug, project_pk)
        if not project:
            return Response(status=status.HTTP_404_NOT_FOUND)
        prefs = ProjectNotificationPreference.for_user_project(request.user, project)
        serializer = ProjectNotificationPreferenceSerializer(prefs, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
