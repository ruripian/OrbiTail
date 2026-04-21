from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.projects.models import ProjectMember
from apps.workspaces.models import WorkspaceMember
from .models import DocumentSpace, Document, DocumentIssueLink, DocumentAttachment, DocumentComment, DocumentVersion
from .serializers import (
    DocumentSpaceSerializer,
    DocumentSerializer,
    DocumentTreeSerializer,
    DocumentIssueLinkSerializer,
    DocumentAttachmentSerializer,
    DocumentCommentSerializer,
    DocumentVersionSerializer,
)


# ── 권한 헬퍼 ──

def _check_space_access(user, space):
    """스페이스 읽기 권한"""
    if space.space_type == "project":
        return (
            space.project
            and ProjectMember.objects.filter(
                project=space.project, member=user
            ).exists()
        )
    elif space.space_type == "personal":
        return space.owner_id == user.id
    else:  # shared
        return WorkspaceMember.objects.filter(
            workspace=space.workspace, member=user
        ).exists()


def _check_space_edit(user, space):
    """스페이스 편집 권한 — 프로젝트 스페이스는 프로젝트 can_edit 따라감"""
    if space.space_type == "project":
        if not space.project:
            return False
        pm = ProjectMember.objects.filter(
            project=space.project, member=user
        ).first()
        if not pm:
            return False
        return pm.effective_perms.get("can_edit", False)
    elif space.space_type == "personal":
        return space.owner_id == user.id
    else:
        return WorkspaceMember.objects.filter(
            workspace=space.workspace, member=user
        ).exists()


def _get_accessible_spaces(user, workspace_slug):
    """유저가 접근 가능한 스페이스 queryset"""
    return DocumentSpace.objects.filter(
        workspace__slug=workspace_slug,
    ).filter(
        Q(space_type="shared")
        | Q(space_type="personal", owner=user)
        | Q(space_type="project", project__members__member=user)
    ).distinct().select_related("project", "owner")


# ── 스페이스 ──

class SpaceListCreateView(generics.ListCreateAPIView):
    """접근 가능한 스페이스 목록 + 공용 스페이스 생성"""
    serializer_class = DocumentSpaceSerializer
    pagination_class = None

    def get_queryset(self):
        return _get_accessible_spaces(self.request.user, self.kwargs["workspace_slug"])

    def create(self, request, *args, **kwargs):
        """공용 스페이스만 수동 생성 가능 (project/personal은 자동)"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from apps.workspaces.models import Workspace
        ws = get_object_or_404(Workspace, slug=self.kwargs["workspace_slug"])
        serializer.save(
            workspace=ws,
            space_type=DocumentSpace.SpaceType.SHARED,
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class SpaceDetailView(generics.RetrieveUpdateDestroyAPIView):
    """스페이스 상세 / 수정 / 삭제"""
    serializer_class = DocumentSpaceSerializer

    def get_queryset(self):
        return _get_accessible_spaces(self.request.user, self.kwargs["workspace_slug"])

    def destroy(self, request, *args, **kwargs):
        space = self.get_object()
        if space.space_type == "project":
            return Response(
                {"detail": "프로젝트 스페이스는 직접 삭제할 수 없습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)


# ── 문서 ──

class DocumentListCreateView(generics.ListCreateAPIView):
    """스페이스 내 문서 트리 목록 + 생성

    ?parent=<uuid> — 특정 폴더의 하위 목록 (기본: 루트)
    ?all=true — 전체 목록 (트리 렌더용)
    """
    pagination_class = None

    def get_serializer_class(self):
        if self.request.method == "GET":
            return DocumentTreeSerializer
        return DocumentSerializer

    def get_queryset(self):
        space = get_object_or_404(
            DocumentSpace, pk=self.kwargs["space_pk"]
        )
        if not _check_space_access(self.request.user, space):
            return Document.objects.none()

        qs = Document.objects.filter(space=space, deleted_at__isnull=True)

        if self.request.query_params.get("all") == "true":
            return qs

        parent = self.request.query_params.get("parent")
        if parent:
            qs = qs.filter(parent_id=parent)
        else:
            qs = qs.filter(parent__isnull=True)
        return qs

    def perform_create(self, serializer):
        space = get_object_or_404(DocumentSpace, pk=self.kwargs["space_pk"])
        if not _check_space_edit(self.request.user, space):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("편집 권한이 없습니다.")
        serializer.save(space=space, created_by=self.request.user)


class DocumentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """문서 상세 (content 포함) / 수정 / 삭제"""
    serializer_class = DocumentSerializer

    def get_queryset(self):
        return Document.objects.filter(
            space_id=self.kwargs["space_pk"],
            deleted_at__isnull=True,
        ).select_related("created_by")

    def update(self, request, *args, **kwargs):
        doc = self.get_object()
        if not _check_space_edit(request.user, doc.space):
            return Response({"detail": "편집 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def perform_destroy(self, instance):
        """소프트 삭제 — 하위 문서 포함"""
        now = timezone.now()
        instance.deleted_at = now
        instance.save(update_fields=["deleted_at"])
        # 재귀적 하위 문서 소프트 삭제
        self._soft_delete_children(instance.id, now)

    def _soft_delete_children(self, parent_id, timestamp):
        children = Document.objects.filter(parent_id=parent_id, deleted_at__isnull=True)
        for child in children:
            child.deleted_at = timestamp
            child.save(update_fields=["deleted_at"])
            self._soft_delete_children(child.id, timestamp)


class DocumentMoveView(APIView):
    """문서 트리 이동 — parent + sort_order 변경"""

    def post(self, request, workspace_slug, space_pk, pk):
        doc = get_object_or_404(
            Document, pk=pk, space_id=space_pk, deleted_at__isnull=True
        )
        if not _check_space_edit(request.user, doc.space):
            return Response({"detail": "편집 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)

        new_parent = request.data.get("parent")  # uuid or null
        new_sort = request.data.get("sort_order")

        if new_parent is not None:
            doc.parent_id = new_parent if new_parent else None
        if new_sort is not None:
            doc.sort_order = float(new_sort)
        doc.save(update_fields=["parent", "sort_order"])
        return Response(DocumentTreeSerializer(doc).data)


# ── 이슈 연결 ──

class DocumentIssueLinkListCreateView(generics.ListCreateAPIView):
    """문서에 연결된 이슈 목록 + 연결 추가"""
    serializer_class = DocumentIssueLinkSerializer
    pagination_class = None

    def get_queryset(self):
        return DocumentIssueLink.objects.filter(
            document_id=self.kwargs["doc_pk"],
            document__space_id=self.kwargs["space_pk"],
        ).select_related("issue", "issue__project")

    def perform_create(self, serializer):
        serializer.save(document_id=self.kwargs["doc_pk"])


class DocumentIssueLinkDeleteView(generics.DestroyAPIView):
    """이슈 연결 해제"""

    def get_queryset(self):
        return DocumentIssueLink.objects.filter(
            document_id=self.kwargs["doc_pk"],
            document__space_id=self.kwargs["space_pk"],
        )

    def get_object(self):
        return get_object_or_404(
            self.get_queryset(),
            issue_id=self.kwargs["issue_pk"],
        )


# ── 검색 ──

class DocumentSearchView(generics.ListAPIView):
    """문서 검색 — 제목 + 본문 (접근 가능한 스페이스만)"""
    serializer_class = DocumentTreeSerializer
    pagination_class = None

    def get_queryset(self):
        spaces = _get_accessible_spaces(self.request.user, self.kwargs["workspace_slug"])
        q = self.request.query_params.get("q", "").strip()
        qs = Document.objects.filter(
            space__in=spaces,
            deleted_at__isnull=True,
            is_folder=False,
        )
        if q:
            qs = qs.filter(Q(title__icontains=q) | Q(content_html__icontains=q))
        return qs.order_by("-updated_at")[:20]


# ── 버전 ──

class DocumentVersionListCreateView(generics.ListCreateAPIView):
    """버전 목록 + 수동 버전 저장"""
    serializer_class = DocumentVersionSerializer
    pagination_class = None

    def get_queryset(self):
        return DocumentVersion.objects.filter(
            document_id=self.kwargs["doc_pk"],
            document__space_id=self.kwargs["space_pk"],
        ).select_related("created_by")

    def perform_create(self, serializer):
        doc = get_object_or_404(
            Document, pk=self.kwargs["doc_pk"], space_id=self.kwargs["space_pk"]
        )
        last_version = doc.versions.order_by("-version_number").first()
        next_number = (last_version.version_number + 1) if last_version else 1
        serializer.save(
            document=doc,
            version_number=next_number,
            title=doc.title,
            content_html=doc.content_html,
            created_by=self.request.user,
        )


class DocumentVersionDetailView(generics.RetrieveAPIView):
    """특정 버전 상세"""
    serializer_class = DocumentVersionSerializer

    def get_queryset(self):
        return DocumentVersion.objects.filter(
            document_id=self.kwargs["doc_pk"],
            document__space_id=self.kwargs["space_pk"],
        ).select_related("created_by")


class DocumentCommentListCreateView(generics.ListCreateAPIView):
    """문서 댓글 목록 + 작성"""
    serializer_class = DocumentCommentSerializer
    pagination_class = None

    def get_queryset(self):
        return DocumentComment.objects.filter(
            document_id=self.kwargs["doc_pk"],
            document__space_id=self.kwargs["space_pk"],
        ).select_related("author")

    def perform_create(self, serializer):
        serializer.save(
            document_id=self.kwargs["doc_pk"],
            author=self.request.user,
        )


class DocumentCommentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """댓글 수정/삭제 — 본인만 (queryset에서 필터링되므로 타인 건은 404)"""
    serializer_class = DocumentCommentSerializer
    http_method_names = ["get", "patch", "delete"]

    def get_queryset(self):
        return DocumentComment.objects.filter(
            document_id=self.kwargs["doc_pk"],
            author=self.request.user,
        )


class DocumentAttachmentListCreateView(generics.ListCreateAPIView):
    """문서 첨부파일 목록 + 업로드"""
    serializer_class = DocumentAttachmentSerializer
    pagination_class = None

    def get_queryset(self):
        return DocumentAttachment.objects.filter(
            document_id=self.kwargs["doc_pk"],
            document__space_id=self.kwargs["space_pk"],
        ).select_related("uploaded_by")

    def perform_create(self, serializer):
        uploaded_file = self.request.FILES.get("file")
        if not uploaded_file:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"file": "파일이 필요합니다."})
        serializer.save(
            document_id=self.kwargs["doc_pk"],
            uploaded_by=self.request.user,
            filename=uploaded_file.name,
            file_size=uploaded_file.size,
            content_type=uploaded_file.content_type or "",
        )


class DocumentAttachmentDeleteView(generics.DestroyAPIView):
    """첨부파일 삭제"""
    serializer_class = DocumentAttachmentSerializer

    def get_queryset(self):
        return DocumentAttachment.objects.filter(
            document_id=self.kwargs["doc_pk"],
            document__space_id=self.kwargs["space_pk"],
        )
