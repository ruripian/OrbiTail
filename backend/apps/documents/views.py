from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.projects.models import ProjectMember
from apps.workspaces.models import WorkspaceMember


def _broadcast_thread_event(workspace_slug: str, doc_id: str, action: str, thread_id: str = "") -> None:
    """댓글 스레드 이벤트를 워크스페이스 그룹에 브로드캐스트.
    action: created | replied | resolved | deleted
    프론트는 같은 문서 사이드바의 react-query를 무효화해 즉시 반영."""
    try:
        layer = get_channel_layer()
        if not layer:
            return
        async_to_sync(layer.group_send)(
            f"workspace_{workspace_slug}",
            {
                "type": "doc.thread.changed",
                "action": action,
                "doc_id": str(doc_id),
                "thread_id": str(thread_id),
            },
        )
    except Exception:
        pass
from .models import DocumentSpace, Document, DocumentIssueLink, DocumentAttachment, DocumentComment, DocumentVersion, CommentThread, DocumentTemplate
from .serializers import (
    DocumentSpaceSerializer,
    DocumentSerializer,
    DocumentTreeSerializer,
    DocumentIssueLinkSerializer,
    DocumentAttachmentSerializer,
    DocumentCommentSerializer,
    DocumentVersionSerializer,
    CommentThreadSerializer,
    DocumentTemplateSerializer,
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
    """문서 상세 (content 포함) / 수정 / 삭제.
    cover_image 업로드를 위해 multipart도 수락. JSON PATCH도 그대로 동작."""
    from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
    parser_classes = [JSONParser, MultiPartParser, FormParser]
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


# ── 블록 댓글 스레드 ──────────────────────────────────────────────

class CommentThreadListCreateView(generics.ListCreateAPIView):
    """스레드 목록 + 생성.

    POST body: { anchor_text, initial_content }
      → 스레드 + 첫 댓글을 한 번에 생성. 이때 응답에 id가 프론트로 돌아가면
        CommentMark에 data-thread-id 로 박는다.
    GET query: ?resolved=false|true (미지정 시 전체)
    """
    serializer_class = CommentThreadSerializer
    pagination_class = None

    def get_queryset(self):
        qs = CommentThread.objects.filter(
            document_id=self.kwargs["doc_pk"],
            document__space_id=self.kwargs["space_pk"],
        ).select_related("created_by", "resolved_by").prefetch_related("comments__author")
        resolved = self.request.query_params.get("resolved")
        if resolved in ("true", "1"):
            qs = qs.filter(resolved=True)
        elif resolved in ("false", "0"):
            qs = qs.filter(resolved=False)
        return qs

    def perform_create(self, serializer):
        initial = serializer.validated_data.pop("initial_content", "").strip()
        if not initial:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"initial_content": "첫 댓글 내용이 필요합니다."})
        thread = serializer.save(
            document_id=self.kwargs["doc_pk"],
            created_by=self.request.user,
        )
        DocumentComment.objects.create(
            document_id=self.kwargs["doc_pk"],
            thread=thread,
            author=self.request.user,
            content=initial,
        )
        _broadcast_thread_event(self.kwargs["workspace_slug"], self.kwargs["doc_pk"], "created", thread.id)


class CommentThreadDetailView(generics.RetrieveDestroyAPIView):
    """스레드 상세 / 삭제 — 생성자만 삭제 (단순 규칙, 필요 시 권한 확장).
    삭제 시 cascade로 내부 댓글 전부 제거. CommentMark는 프론트에서 같이 제거.
    """
    serializer_class = CommentThreadSerializer
    http_method_names = ["get", "delete"]

    def get_queryset(self):
        return CommentThread.objects.filter(
            document_id=self.kwargs["doc_pk"],
            document__space_id=self.kwargs["space_pk"],
        ).select_related("created_by", "resolved_by").prefetch_related("comments__author")

    def perform_destroy(self, instance):
        if instance.created_by_id and instance.created_by_id != self.request.user.id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("자신이 생성한 스레드만 삭제할 수 있습니다.")
        tid = str(instance.id)
        doc_id = str(instance.document_id)
        instance.delete()
        _broadcast_thread_event(self.kwargs["workspace_slug"], doc_id, "deleted", tid)


class CommentThreadReplyView(generics.CreateAPIView):
    """스레드에 답글 추가."""
    serializer_class = DocumentCommentSerializer

    def get_queryset(self):
        return DocumentComment.objects.filter(
            document_id=self.kwargs["doc_pk"],
            thread_id=self.kwargs["thread_pk"],
        )

    def perform_create(self, serializer):
        thread = get_object_or_404(
            CommentThread,
            pk=self.kwargs["thread_pk"],
            document_id=self.kwargs["doc_pk"],
        )
        if thread.resolved:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("해결된 스레드에는 답글을 달 수 없습니다. 먼저 재개해주세요.")
        serializer.save(
            document_id=self.kwargs["doc_pk"],
            thread=thread,
            author=self.request.user,
        )
        _broadcast_thread_event(
            self.kwargs["workspace_slug"], self.kwargs["doc_pk"], "replied", thread.id,
        )


class CommentThreadResolveView(APIView):
    """스레드 resolve/reopen 토글."""

    def post(self, request, workspace_slug, space_pk, doc_pk, thread_pk):
        thread = get_object_or_404(
            CommentThread,
            pk=thread_pk,
            document_id=doc_pk,
            document__space_id=space_pk,
        )
        if thread.resolved:
            # 재개
            thread.resolved = False
            thread.resolved_at = None
            thread.resolved_by = None
        else:
            thread.resolved = True
            thread.resolved_at = timezone.now()
            thread.resolved_by = request.user
        thread.save(update_fields=["resolved", "resolved_at", "resolved_by"])
        _broadcast_thread_event(workspace_slug, doc_pk, "resolved", thread_pk)
        return Response(CommentThreadSerializer(thread).data)


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


# ── 공개 공유 링크 ──────────────────────────────────────────────

class DocumentShareView(APIView):
    """문서 공유 토큰 발급/조회/삭제.
    GET:    현재 상태 { enabled, token?, expires_at?, url? }
    POST:   body { expires_at? } → 토큰 발급/재발급
    DELETE: 토큰 제거 (공유 해제)
    모두 편집 권한 필요 (ProjectMember 또는 WorkspaceMember).
    """

    def _get_doc(self, request, workspace_slug, space_pk, doc_pk):
        doc = get_object_or_404(
            Document.objects.select_related("space"),
            pk=doc_pk, space_id=space_pk, deleted_at__isnull=True,
        )
        if not _check_space_edit(request.user, doc.space):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("공유 링크 관리 권한이 없습니다.")
        return doc

    def _shape(self, doc, request):
        if not doc.share_token:
            return {"enabled": False}
        path = f"/s/{doc.share_token}"
        url = request.build_absolute_uri(path)
        return {
            "enabled": True,
            "token": doc.share_token,
            "url": url,
            "expires_at": doc.share_expires_at,
        }

    def get(self, request, workspace_slug, space_pk, doc_pk):
        doc = self._get_doc(request, workspace_slug, space_pk, doc_pk)
        return Response(self._shape(doc, request))

    def post(self, request, workspace_slug, space_pk, doc_pk):
        import secrets
        doc = self._get_doc(request, workspace_slug, space_pk, doc_pk)
        if not doc.share_token:
            doc.share_token = secrets.token_urlsafe(24)
        # expires_at 업데이트 (null 허용)
        exp = request.data.get("expires_at") if hasattr(request, "data") else None
        if "expires_at" in (request.data or {}):
            doc.share_expires_at = exp or None
        doc.save(update_fields=["share_token", "share_expires_at"])
        return Response(self._shape(doc, request))

    def delete(self, request, workspace_slug, space_pk, doc_pk):
        doc = self._get_doc(request, workspace_slug, space_pk, doc_pk)
        doc.share_token = None
        doc.share_expires_at = None
        doc.save(update_fields=["share_token", "share_expires_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class PublicDocumentView(APIView):
    """인증 없이 토큰으로 조회되는 read-only 문서 뷰.
    만료 시 404 취급. yjs_state는 노출하지 않음."""

    authentication_classes: list = []
    permission_classes: list = []

    def get(self, request, token):
        doc = Document.objects.filter(
            share_token=token, deleted_at__isnull=True,
        ).first()
        if not doc:
            return Response({"detail": "공유 링크가 유효하지 않습니다."}, status=404)
        if doc.share_expires_at and doc.share_expires_at < timezone.now():
            return Response({"detail": "공유 링크가 만료되었습니다."}, status=404)
        cover_url = doc.cover_image.url if doc.cover_image else None
        return Response({
            "id": str(doc.id),
            "title": doc.title,
            "icon_prop": doc.icon_prop,
            "content_html": doc.content_html,
            "cover_image_url": cover_url,
            "cover_offset_y": doc.cover_offset_y,
            "updated_at": doc.updated_at,
        })


class DocumentAttachmentDeleteView(generics.DestroyAPIView):
    """첨부파일 삭제"""
    serializer_class = DocumentAttachmentSerializer

    def get_queryset(self):
        return DocumentAttachment.objects.filter(
            document_id=self.kwargs["doc_pk"],
            document__space_id=self.kwargs["space_pk"],
        )


# ── 문서 템플릿 ──────────────────────────────────────────────────

class DocumentTemplateListCreateView(generics.ListCreateAPIView):
    """템플릿 목록 + 생성.

    GET 반환: built-in + 워크스페이스 공유 + 본인 소유 전부. 쿼리 ?scope= 로 필터 가능.
    POST body: { name, description?, icon_prop?, content_html, scope?, sort_order? }
      scope='workspace' 로 저장하려면 워크스페이스 admin 권한 필요, 그 외는 'user'로 강제.
    """
    serializer_class = DocumentTemplateSerializer
    pagination_class = None

    def _get_workspace(self):
        from apps.workspaces.models import Workspace
        return get_object_or_404(Workspace, slug=self.kwargs["workspace_slug"])

    def _is_admin(self, ws):
        from apps.workspaces.models import WorkspaceMember
        return WorkspaceMember.objects.filter(
            workspace=ws, member=self.request.user,
            role__in=[WorkspaceMember.Role.OWNER, WorkspaceMember.Role.ADMIN],
        ).exists()

    def get_queryset(self):
        ws = self._get_workspace()
        user = self.request.user
        qs = DocumentTemplate.objects.filter(
            Q(scope=DocumentTemplate.Scope.BUILT_IN)
            | Q(scope=DocumentTemplate.Scope.WORKSPACE, workspace=ws)
            | Q(scope=DocumentTemplate.Scope.USER, owner=user)
        ).select_related("created_by")
        scope = self.request.query_params.get("scope")
        if scope in [c[0] for c in DocumentTemplate.Scope.choices]:
            qs = qs.filter(scope=scope)
        return qs

    def perform_create(self, serializer):
        ws = self._get_workspace()
        requested_scope = self.request.data.get("scope") or DocumentTemplate.Scope.USER
        if requested_scope == DocumentTemplate.Scope.BUILT_IN:
            # 내장 템플릿은 슈퍼유저만
            if not self.request.user.is_superuser:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("내장 템플릿은 관리자만 생성할 수 있습니다.")
            serializer.save(scope=DocumentTemplate.Scope.BUILT_IN, workspace=None, owner=None, created_by=self.request.user)
        elif requested_scope == DocumentTemplate.Scope.WORKSPACE:
            if not self._is_admin(ws):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("워크스페이스 공유 템플릿은 관리자/오너만 생성할 수 있습니다.")
            serializer.save(scope=DocumentTemplate.Scope.WORKSPACE, workspace=ws, owner=None, created_by=self.request.user)
        else:
            serializer.save(
                scope=DocumentTemplate.Scope.USER, workspace=None,
                owner=self.request.user, created_by=self.request.user,
            )


class DocumentTemplateDetailView(generics.RetrieveDestroyAPIView):
    """템플릿 상세 / 삭제.
    built-in은 슈퍼유저만, workspace는 해당 워크스페이스 admin, user 범위는 본인만 삭제.
    """
    serializer_class = DocumentTemplateSerializer
    http_method_names = ["get", "delete"]

    def _get_workspace(self):
        from apps.workspaces.models import Workspace
        return get_object_or_404(Workspace, slug=self.kwargs["workspace_slug"])

    def get_queryset(self):
        ws = self._get_workspace()
        user = self.request.user
        return DocumentTemplate.objects.filter(
            Q(scope=DocumentTemplate.Scope.BUILT_IN)
            | Q(scope=DocumentTemplate.Scope.WORKSPACE, workspace=ws)
            | Q(scope=DocumentTemplate.Scope.USER, owner=user)
        )

    def perform_destroy(self, instance):
        from rest_framework.exceptions import PermissionDenied
        from apps.workspaces.models import WorkspaceMember
        user = self.request.user
        if instance.scope == DocumentTemplate.Scope.BUILT_IN:
            if not user.is_superuser:
                raise PermissionDenied("내장 템플릿은 관리자만 삭제할 수 있습니다.")
        elif instance.scope == DocumentTemplate.Scope.WORKSPACE:
            is_admin = WorkspaceMember.objects.filter(
                workspace=instance.workspace, member=user,
                role__in=[WorkspaceMember.Role.OWNER, WorkspaceMember.Role.ADMIN],
            ).exists()
            if not is_admin:
                raise PermissionDenied("워크스페이스 템플릿 삭제 권한이 없습니다.")
        else:
            if instance.owner_id != user.id:
                raise PermissionDenied("본인 소유 템플릿만 삭제할 수 있습니다.")
        instance.delete()
