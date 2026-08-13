from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import IsSuperUser
from apps.documents.models import Document, DocumentAttachment
from apps.issues.models import Issue, IssueAttachment
from apps.projects.models import Project
from apps.workspaces.models import Workspace

from .base import AdminResourceListView, as_datetime, as_datetime_end, as_int
from .serializers import (
    DocumentAttachmentRowSerializer,
    IssueAttachmentRowSerializer,
)


class AdminOverviewView(APIView):
    """콘솔 개요 지표 — 슈퍼유저 전용.

    "지금 손봐야 할 것"(승인 대기, 정지 계정)과 "규모"(사용자/워크스페이스/용량)를 한 번에 준다.
    추이 그래프는 넣지 않는다 — 운영 판단에 쓰이는 건 현재 수치이고, 추이는 아직 볼 사람이 없다.
    """

    permission_classes = [IsSuperUser]

    def get(self, request):
        now = timezone.now()
        week_ago = now - timedelta(days=7)
        month_ago = now - timedelta(days=30)

        doc_bytes = DocumentAttachment.objects.aggregate(total=Sum("file_size"))["total"] or 0
        issue_bytes = (
            IssueAttachment.objects.filter(deleted_at__isnull=True).aggregate(total=Sum("size"))["total"] or 0
        )

        return Response({
            "users": {
                "total": User.objects.filter(deleted_at__isnull=True).count(),
                # 승인 대기는 콘솔에서 사람이 직접 처리해야 하는 유일한 큐다.
                "pending": User.objects.filter(is_email_verified=True, is_approved=False).count(),
                "unverified": User.objects.filter(is_email_verified=False, deleted_at__isnull=True).count(),
                "suspended": User.objects.filter(is_suspended=True).count(),
                "superusers": User.objects.filter(is_superuser=True).count(),
                "deleted": User.objects.filter(deleted_at__isnull=False).count(),
                "joined_last_7d": User.objects.filter(created_at__gte=week_ago).count(),
                "joined_last_30d": User.objects.filter(created_at__gte=month_ago).count(),
            },
            "workspaces": {
                "total": Workspace.objects.count(),
                "projects": Project.objects.count(),
            },
            "content": {
                "documents": Document.objects.filter(deleted_at__isnull=True).count(),
                "issues": Issue.objects.filter(deleted_at__isnull=True).count(),
                "attachments": (
                    DocumentAttachment.objects.count()
                    + IssueAttachment.objects.filter(deleted_at__isnull=True).count()
                ),
                "storage_bytes": doc_bytes + issue_bytes,
                "document_storage_bytes": doc_bytes,
                "issue_storage_bytes": issue_bytes,
            },
        })


class DocumentAttachmentListView(AdminResourceListView):
    """문서 첨부 탐색 — 전 워크스페이스. 슈퍼유저 전용.

    구 첨부 검색은 최근 200개만 보여줘서 "파일이 있는데 없다고 나오는" 상태였다.
    여기서는 전량을 페이지네이션으로 훑고, 총 건수를 항상 함께 준다.
    """
    serializer_class = DocumentAttachmentRowSerializer
    queryset = DocumentAttachment.objects.select_related(
        "document", "document__space", "document__space__workspace", "uploaded_by",
    ).all()

    search_fields = ["filename", "document__title"]
    filter_spec = {
        "workspace": "document__space__workspace__slug",
        "space_type": "document__space__space_type",
        "uploaded_by": "uploaded_by_id",
        "mime_prefix": "content_type__startswith",
        "min_size": ("file_size__gte", as_int),
        "uploaded_after": ("created_at__gte", as_datetime),
        "uploaded_before": ("created_at__lte", as_datetime_end),
    }
    ordering_allow = ["created_at", "filename", "file_size"]


class IssueAttachmentListView(AdminResourceListView):
    """이슈 첨부 탐색 — 전 워크스페이스. 슈퍼유저 전용.

    댓글 편집기로 올라온 파일도 여기 있다(origin=from_comment). 별도 댓글 첨부 모델은 없다.
    소프트 삭제된 첨부는 휴지통 소관이므로 목록에서 제외한다.
    """
    serializer_class = IssueAttachmentRowSerializer
    queryset = IssueAttachment.objects.select_related(
        "issue", "issue__project", "issue__project__workspace", "uploaded_by",
    ).filter(deleted_at__isnull=True)

    search_fields = ["filename", "issue__title"]
    filter_spec = {
        "workspace": "issue__project__workspace__slug",
        "project": "issue__project_id",
        "uploaded_by": "uploaded_by_id",
        "origin": "source",
        "mime_prefix": "mime_type__startswith",
        "min_size": ("size__gte", as_int),
        "uploaded_after": ("created_at__gte", as_datetime),
        "uploaded_before": ("created_at__lte", as_datetime_end),
    }
    ordering_allow = ["created_at", "filename", "size"]
