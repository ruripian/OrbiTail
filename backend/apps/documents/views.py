from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models import Q, Count, F
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsSuperUser
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
from .models import DocumentSpace, DocumentSpaceMember, DocumentLabel, Document, DocumentIssueLink, DocumentAttachment, DocumentComment, DocumentVersion, DocumentView, CommentThread, DocumentTemplate, DocumentSpaceBookmark
from .serializers import (
    DocumentSpaceSerializer,
    DocumentSpaceMemberSerializer,
    DocumentLabelSerializer,
    TrashedDocumentSerializer,
    TrashedDocumentDetailSerializer,
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

def _is_workspace_admin(user, workspace):
    """슈퍼유저 OR 워크스페이스 ADMIN 이상 — 비공개 스페이스도 우회."""
    if user.is_superuser:
        return True
    return WorkspaceMember.objects.filter(
        workspace=workspace, member=user,
        role__gte=WorkspaceMember.Role.ADMIN,
    ).exists()


def _space_role(user, space):
    """이 사용자가 스페이스에서 갖는 실효 등급 (권한 없으면 None).

    권한 출처가 둘(프로젝트 멤버십 / 스페이스 멤버십)일 수 있어 **넓은 쪽**을 취한다.
    정수 등급이므로 이후 판정은 전부 크기 비교 한 줄로 끝난다.

    - 워크스페이스 ADMIN·슈퍼유저: 항상 ADMIN
    - project  : 프로젝트 멤버는 can_edit 여부로 EDITOR/VIEWER, 스페이스 추가 인원은 자기 등급
    - personal : owner 만 ADMIN
    - shared   : 스페이스 등급. 공개(is_private=False) 면 워크스페이스 멤버 전원이 최소 EDITOR
                 (기존 동작 유지 — 공개 스페이스는 누구나 편집할 수 있었다)
    """
    if _is_workspace_admin(user, space.workspace):
        return DocumentSpaceMember.Role.ADMIN

    if space.space_type == "personal":
        return DocumentSpaceMember.Role.ADMIN if space.owner_id == user.id else None

    roles = []
    membership = DocumentSpaceMember.objects.filter(space=space, member=user).first()
    if membership:
        roles.append(membership.role)

    if space.space_type == "project":
        if space.project:
            pm = ProjectMember.objects.filter(project=space.project, member=user).first()
            if pm:
                roles.append(
                    DocumentSpaceMember.Role.EDITOR
                    if pm.effective_perms.get("can_edit", False)
                    else DocumentSpaceMember.Role.VIEWER
                )
    elif not space.is_private:
        if WorkspaceMember.objects.filter(workspace=space.workspace, member=user).exists():
            roles.append(DocumentSpaceMember.Role.EDITOR)

    return max(roles) if roles else None


def _check_space_access(user, space):
    """읽기 권한 — VIEWER 이상."""
    return _space_role(user, space) is not None


def _check_space_edit(user, space):
    """편집 권한 — EDITOR 이상."""
    role = _space_role(user, space)
    return role is not None and role >= DocumentSpaceMember.Role.EDITOR


def _check_space_admin(user, space):
    """관리 권한(설정 변경·멤버 관리·삭제) — ADMIN 만."""
    role = _space_role(user, space)
    return role is not None and role >= DocumentSpaceMember.Role.ADMIN


def _get_accessible_spaces(user, workspace_slug):
    """유저가 접근 가능한 스페이스 queryset — 프로젝트 멤버 OR space.members 추가 인원 포함.
    비공개 공용 스페이스는 멤버에게만, 공개 공용은 워크스페이스 멤버 모두.
    워크스페이스 관리자/슈퍼유저는 비공개 스페이스도 모두 노출."""
    base = DocumentSpace.objects.filter(workspace__slug=workspace_slug)
    is_admin = (
        user.is_superuser
        or WorkspaceMember.objects.filter(
            workspace__slug=workspace_slug, member=user,
            role__gte=WorkspaceMember.Role.ADMIN,
        ).exists()
    )
    if is_admin:
        # 관리자: 본인 personal 외 모든 스페이스 노출
        return base.filter(
            Q(space_type__in=["shared", "project"])
            | Q(space_type="personal", owner=user)
        ).distinct().select_related("project", "owner")
    return base.filter(
        Q(space_type="shared", is_private=False)
        | Q(space_type="shared", is_private=True, members=user)
        | Q(space_type="personal", owner=user)
        | Q(space_type="project", project__members__member=user)
        | Q(space_type="project", members=user)
    ).distinct().select_related("project", "owner")


# ── 스페이스 ──

class SpaceListCreateView(generics.ListCreateAPIView):
    """접근 가능한 스페이스 목록 + 공용 스페이스 생성"""
    serializer_class = DocumentSpaceSerializer
    pagination_class = None

    def get_queryset(self):
        return _get_accessible_spaces(self.request.user, self.kwargs["workspace_slug"])

    def create(self, request, *args, **kwargs):
        """공용 스페이스만 수동 생성 가능 (project/personal은 자동).
        members는 워크스페이스 멤버로 제한. is_private 로 공개/비공개 지정."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from apps.workspaces.models import Workspace
        ws = get_object_or_404(Workspace, slug=self.kwargs["workspace_slug"])

        # members 가 워크스페이스 소속인지 검증 — 외부 인원 추가 차단.
        requested_members = serializer.validated_data.get("members") or []
        if requested_members:
            valid_user_ids = set(
                WorkspaceMember.objects.filter(
                    workspace=ws, member__in=requested_members,
                ).values_list("member_id", flat=True)
            )
            filtered_members = [u for u in requested_members if u.id in valid_user_ids]
            serializer.validated_data["members"] = filtered_members

        serializer.save(
            workspace=ws,
            space_type=DocumentSpace.SpaceType.SHARED,
        )
        # 생성자는 항상 ADMIN 멤버 — 비공개로 만들어도 본인 접근이 끊기지 않고,
        # 관리자가 아무도 없어 설정을 못 바꾸는 스페이스가 생기지 않는다.
        space = DocumentSpace.objects.get(pk=serializer.data["id"])
        DocumentSpaceMember.objects.update_or_create(
            space=space, member=request.user,
            defaults={"role": DocumentSpaceMember.Role.ADMIN},
        )
        return Response(self.get_serializer(space).data, status=status.HTTP_201_CREATED)


class DiscoverableSpacesView(generics.ListAPIView):
    """탐색 페이지 — 본인이 멤버가 아니면서 가입할 수 있는 공개 스페이스 목록.
    공용 스페이스 중 is_private=False, 본인이 아직 들어가있지 않은 것."""
    serializer_class = DocumentSpaceSerializer
    pagination_class = None

    def get_queryset(self):
        user = self.request.user
        ws_slug = self.kwargs["workspace_slug"]
        # 워크스페이스 멤버가 아니면 빈 결과
        if not WorkspaceMember.objects.filter(
            workspace__slug=ws_slug, member=user,
        ).exists():
            return DocumentSpace.objects.none()
        return DocumentSpace.objects.filter(
            workspace__slug=ws_slug,
            space_type="shared",
            is_private=False,
            archived_at__isnull=True,
        ).exclude(members=user).select_related("project", "owner").order_by("name")


class SpaceJoinView(APIView):
    """공개 공용 스페이스 자가 가입 — 본인을 members 에 추가."""

    def post(self, request, workspace_slug, pk):
        space = get_object_or_404(
            DocumentSpace, pk=pk, workspace__slug=workspace_slug,
        )
        if space.space_type != "shared":
            return Response(
                {"detail": "공용 스페이스만 자가 가입 가능합니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if space.is_private:
            return Response(
                {"detail": "비공개 스페이스에는 자가 가입할 수 없습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        # 워크스페이스 멤버 확인
        if not WorkspaceMember.objects.filter(
            workspace=space.workspace, member=request.user,
        ).exists():
            return Response(
                {"detail": "워크스페이스 멤버만 가입할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        space.members.add(request.user)
        return Response(DocumentSpaceSerializer(space).data, status=status.HTTP_200_OK)


class SpaceDetailView(generics.RetrieveUpdateDestroyAPIView):
    """스페이스 상세 / 수정 / 삭제 — 수정·삭제는 ADMIN 만"""
    serializer_class = DocumentSpaceSerializer

    def get_queryset(self):
        return _get_accessible_spaces(self.request.user, self.kwargs["workspace_slug"])

    def update(self, request, *args, **kwargs):
        space = self.get_object()
        if not _check_space_admin(request.user, space):
            return Response(
                {"detail": "스페이스 설정은 관리자만 변경할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        # 프로젝트 스페이스의 보관 상태는 프로젝트 보관과 동기화된다 — 여기서 따로 바꾸면 어긋난다
        if space.space_type == "project" and "archived_at" in request.data:
            return Response(
                {"detail": "프로젝트 스페이스의 보관은 프로젝트 설정에서 변경합니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        space = self.get_object()
        if space.space_type == "project":
            return Response(
                {"detail": "프로젝트 스페이스는 직접 삭제할 수 없습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not _check_space_admin(request.user, space):
            return Response(
                {"detail": "스페이스 삭제는 관리자만 할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)


class SpaceMemberListCreateView(APIView):
    """스페이스 멤버 목록 + 추가 — 추가는 ADMIN 만.

    목록은 접근 권한자면 볼 수 있다(누가 이 스페이스를 보는지는 협업 정보).
    """

    def _get_space(self, workspace_slug, space_pk):
        return get_object_or_404(DocumentSpace, pk=space_pk, workspace__slug=workspace_slug)

    def get(self, request, workspace_slug, space_pk):
        space = self._get_space(workspace_slug, space_pk)
        if not _check_space_access(request.user, space):
            return Response({"detail": "접근 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
        qs = DocumentSpaceMember.objects.filter(space=space).select_related("member")
        return Response(DocumentSpaceMemberSerializer(qs, many=True).data)

    def post(self, request, workspace_slug, space_pk):
        space = self._get_space(workspace_slug, space_pk)
        if not _check_space_admin(request.user, space):
            return Response({"detail": "멤버 추가는 관리자만 할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)

        member_id = request.data.get("member")
        role = int(request.data.get("role", DocumentSpaceMember.Role.EDITOR))
        if role not in DocumentSpaceMember.Role.values:
            return Response({"detail": "알 수 없는 역할입니다."}, status=status.HTTP_400_BAD_REQUEST)
        # 워크스페이스 밖 인원 차단 — 스페이스 멤버는 워크스페이스 멤버의 부분집합이어야 한다
        if not WorkspaceMember.objects.filter(
            workspace=space.workspace, member_id=member_id,
        ).exists():
            return Response(
                {"detail": "워크스페이스 멤버만 추가할 수 있습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        obj, _ = DocumentSpaceMember.objects.update_or_create(
            space=space, member_id=member_id, defaults={"role": role},
        )
        return Response(DocumentSpaceMemberSerializer(obj).data, status=status.HTTP_201_CREATED)


class SpaceMemberDetailView(APIView):
    """스페이스 멤버 역할 변경 / 제거 — ADMIN 만."""

    def _get_membership(self, request, workspace_slug, space_pk, member_pk):
        space = get_object_or_404(DocumentSpace, pk=space_pk, workspace__slug=workspace_slug)
        if not _check_space_admin(request.user, space):
            return None, Response(
                {"detail": "멤버 관리는 관리자만 할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return get_object_or_404(
            DocumentSpaceMember, space=space, member_id=member_pk,
        ), None

    def patch(self, request, workspace_slug, space_pk, member_pk):
        membership, error = self._get_membership(request, workspace_slug, space_pk, member_pk)
        if error:
            return error
        role = int(request.data.get("role", membership.role))
        if role not in DocumentSpaceMember.Role.values:
            return Response({"detail": "알 수 없는 역할입니다."}, status=status.HTTP_400_BAD_REQUEST)
        # 마지막 관리자를 강등하면 아무도 설정을 못 바꾸는 스페이스가 된다
        if membership.role == DocumentSpaceMember.Role.ADMIN and role < DocumentSpaceMember.Role.ADMIN:
            if not DocumentSpaceMember.objects.filter(
                space=membership.space, role=DocumentSpaceMember.Role.ADMIN,
            ).exclude(pk=membership.pk).exists():
                return Response(
                    {"detail": "마지막 관리자는 강등할 수 없습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        membership.role = role
        membership.save(update_fields=["role"])
        return Response(DocumentSpaceMemberSerializer(membership).data)

    def delete(self, request, workspace_slug, space_pk, member_pk):
        membership, error = self._get_membership(request, workspace_slug, space_pk, member_pk)
        if error:
            return error
        if membership.role == DocumentSpaceMember.Role.ADMIN:
            if not DocumentSpaceMember.objects.filter(
                space=membership.space, role=DocumentSpaceMember.Role.ADMIN,
            ).exclude(pk=membership.pk).exists():
                return Response(
                    {"detail": "마지막 관리자는 제거할 수 없습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        membership.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        self._record_view(self.get_object(), request.user)
        return response

    @staticmethod
    def _record_view(doc, user):
        """조회 기록 — (문서, 사용자, 날짜) 당 1행. 같은 날 다시 열면 count 만 올린다.

        실패해도 문서 조회는 성공해야 하므로 예외를 삼킨다(통계는 부수 기능).
        """
        if doc.is_folder or not user.is_authenticated:
            return
        try:
            today = timezone.now().date()
            updated = DocumentView.objects.filter(
                document=doc, user=user, viewed_on=today,
            ).update(count=F("count") + 1)
            if not updated:
                DocumentView.objects.create(document=doc, user=user, viewed_on=today)
        except Exception:
            pass

    def update(self, request, *args, **kwargs):
        doc = self.get_object()
        if not _check_space_edit(request.user, doc.space):
            return Response({"detail": "편집 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def perform_destroy(self, instance):
        """소프트 삭제 — 하위 문서 포함"""
        now = timezone.now()
        actor = self.request.user if self.request.user.is_authenticated else None
        instance.deleted_at = now
        instance.deleted_by = actor
        instance.save(update_fields=["deleted_at", "deleted_by"])
        # 재귀적 하위 문서 소프트 삭제
        self._soft_delete_children(instance.id, now, actor)

    def _soft_delete_children(self, parent_id, timestamp, actor):
        children = Document.objects.filter(parent_id=parent_id, deleted_at__isnull=True)
        for child in children:
            child.deleted_at = timestamp
            child.deleted_by = actor
            child.save(update_fields=["deleted_at", "deleted_by"])
            self._soft_delete_children(child.id, timestamp, actor)


class DocumentTrashView(APIView):
    """스페이스 휴지통 — 소프트 삭제된 문서 목록 / 복구 / 영구 삭제.

    지금까지 삭제는 deleted_at 만 세우고 되돌릴 경로가 없었다. 목록은 편집 권한자면 보고,
    영구 삭제만 ADMIN 으로 제한한다(되돌릴 수 없는 작업이므로).
    """

    def _get_space(self, request, workspace_slug, space_pk):
        return get_object_or_404(DocumentSpace, pk=space_pk, workspace__slug=workspace_slug)

    def get(self, request, workspace_slug, space_pk):
        space = self._get_space(request, workspace_slug, space_pk)
        if not _check_space_edit(request.user, space):
            return Response({"detail": "편집 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
        qs = (
            Document.objects.filter(space=space, deleted_at__isnull=False)
            .select_related("created_by", "deleted_by")
            .order_by("-deleted_at")
        )
        return Response(TrashedDocumentSerializer(qs, many=True).data)

    def post(self, request, workspace_slug, space_pk):
        """복구 — ?ids=[] 로 받은 문서를 되살린다.

        부모가 아직 삭제 상태면 트리에서 길을 잃으므로 루트로 올린다."""
        space = self._get_space(request, workspace_slug, space_pk)
        if not _check_space_edit(request.user, space):
            return Response({"detail": "편집 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get("ids") or []
        docs = Document.objects.filter(space=space, id__in=ids, deleted_at__isnull=False)
        restored = 0
        for doc in docs:
            if doc.parent_id and Document.objects.filter(
                pk=doc.parent_id, deleted_at__isnull=False,
            ).exists():
                doc.parent = None
            doc.deleted_at = None
            doc.save(update_fields=["deleted_at", "parent"])
            restored += 1
        return Response({"restored": restored})

    def delete(self, request, workspace_slug, space_pk):
        """영구 삭제 — ?ids 미지정이면 휴지통 비우기."""
        space = self._get_space(request, workspace_slug, space_pk)
        if not _check_space_admin(request.user, space):
            return Response(
                {"detail": "영구 삭제는 관리자만 할 수 있습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )
        qs = Document.objects.filter(space=space, deleted_at__isnull=False)
        ids = request.data.get("ids")
        if ids:
            qs = qs.filter(id__in=ids)
        deleted, _ = qs.delete()
        return Response({"deleted": deleted})


class DocumentBulkMoveView(APIView):
    """여러 문서를 한 번에 옮긴다 — 탐색기에서 다중 선택 드래그용.

    한 건씩 N번 호출하면 중간에 실패했을 때 일부만 옮겨진 상태가 남는다. 여기서는
    순환 검사를 전부 통과한 뒤에만 저장하므로 "되거나 아무것도 안 되거나" 둘 중 하나다.
    """

    def post(self, request, workspace_slug, space_pk):
        space = get_object_or_404(DocumentSpace, pk=space_pk, workspace__slug=workspace_slug)
        if not _check_space_edit(request.user, space):
            return Response({"detail": "편집 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)

        ids = request.data.get("ids") or []
        parent_id = request.data.get("parent")  # None 이면 최상위
        docs = list(Document.objects.filter(space=space, id__in=ids, deleted_at__isnull=True))
        if not docs:
            return Response({"moved": 0})

        parent = None
        if parent_id:
            parent = get_object_or_404(
                Document, pk=parent_id, space=space, deleted_at__isnull=True,
            )
            # 자기 자신·자손 안으로 넣으면 트리가 끊어져 영영 못 찾는 문서가 생긴다
            descendants = _descendant_ids(space, [d.id for d in docs])
            if parent.id in descendants or str(parent.id) in {str(d.id) for d in docs}:
                return Response(
                    {"detail": "자신 또는 하위 문서로는 이동할 수 없습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        base = (
            Document.objects.filter(space=space, parent=parent, deleted_at__isnull=True)
            .exclude(id__in=[d.id for d in docs])
            .order_by("-sort_order")
            .values_list("sort_order", flat=True)
            .first()
        )
        next_order = (base or 0) + 1
        # 끌어온 순서를 유지하려면 요청 ids 순서를 따라야 한다(쿼리 결과 순서가 아니라)
        order_index = {str(v): i for i, v in enumerate(ids)}
        for doc in sorted(docs, key=lambda d: order_index.get(str(d.id), 0)):
            doc.parent = parent
            doc.sort_order = next_order
            doc.save(update_fields=["parent", "sort_order"])
            next_order += 1

        return Response({"moved": len(docs)})


def _descendant_ids(space, root_ids):
    """주어진 문서들의 모든 자손 id — 순환 이동 차단용."""
    result: set = set()
    frontier = list(root_ids)
    guard = 0
    while frontier and guard < 50:
        children = list(
            Document.objects.filter(space=space, parent_id__in=frontier)
            .values_list("id", flat=True)
        )
        children = [c for c in children if c not in result]
        if not children:
            break
        result.update(children)
        frontier = children
        guard += 1
    return result


class TrashedDocumentDetailView(APIView):
    """휴지통 문서 단건 — 미리보기용.

    일반 문서 상세(DocumentDetailView)는 deleted_at__isnull=True 로 걸러서 삭제된 문서를 못 연다.
    복구할지 판단하려면 내용을 봐야 하므로 읽기 전용 경로를 따로 둔다.
    """

    def get(self, request, workspace_slug, space_pk, pk):
        space = get_object_or_404(DocumentSpace, pk=space_pk, workspace__slug=workspace_slug)
        if not _check_space_edit(request.user, space):
            return Response({"detail": "편집 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
        doc = get_object_or_404(
            Document.objects.select_related("created_by", "deleted_by"),
            pk=pk, space=space, deleted_at__isnull=False,
        )
        return Response(TrashedDocumentDetailSerializer(doc).data)


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

        # "키가 없음"(부모 유지)과 "parent: null"(최상위로)을 구분해야 한다 —
        # is not None 으로 판정하면 최상위로 빼는 요청이 조용히 무시된다.
        if "parent" in request.data:
            target_parent = str(new_parent) if new_parent else None
            # 순환 차단 — 여기서 막지 않으면 트리에 사이클이 생기고, 사이클이 생기는 순간
            # 최상위 문서가 사라져 화면에서 트리 전체가 보이지 않게 된다(실제 사고 사례).
            # 형제 사이 드롭도 parent 가 자기 자신이 될 수 있어(자식의 앞/뒤로 놓는 경우) 반드시 검사한다.
            if target_parent:
                if target_parent == str(doc.id):
                    return Response(
                        {"detail": "자신을 부모로 지정할 수 없습니다."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if target_parent in {str(i) for i in _descendant_ids(doc.space, [doc.id])}:
                    return Response(
                        {"detail": "자신 또는 하위 문서로는 이동할 수 없습니다."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            doc.parent_id = target_parent
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
    """문서 검색 — 제목 + 본문 (접근 가능한 스페이스만)

    ?q=키워드      제목·본문 부분 일치
    ?labels=id,id  라벨 필터 (하나라도 붙어 있으면 포함)
    """
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
        labels = [v for v in self.request.query_params.get("labels", "").split(",") if v]
        if labels:
            # distinct — 라벨 여러 개가 걸리면 조인으로 같은 문서가 중복된다
            qs = qs.filter(labels__in=labels).distinct()
        return qs.order_by("-updated_at")[:20]


class DocumentLabelListCreateView(generics.ListCreateAPIView):
    """문서 라벨 목록 + 생성 — 워크스페이스 단위. 워크스페이스 멤버면 만들 수 있다."""
    serializer_class = DocumentLabelSerializer
    pagination_class = None

    def _get_workspace(self):
        from apps.workspaces.models import Workspace
        return get_object_or_404(Workspace, slug=self.kwargs["workspace_slug"])

    def get_queryset(self):
        return DocumentLabel.objects.filter(workspace__slug=self.kwargs["workspace_slug"])

    def create(self, request, *args, **kwargs):
        ws = self._get_workspace()
        if not WorkspaceMember.objects.filter(workspace=ws, member=request.user).exists():
            return Response({"detail": "워크스페이스 멤버만 만들 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"detail": "라벨 이름을 입력하세요."}, status=status.HTTP_400_BAD_REQUEST)
        # 같은 이름이 이미 있으면 새로 만들지 않고 그 라벨을 돌려준다 — 분류가 갈라지지 않게
        label, created = DocumentLabel.objects.get_or_create(
            workspace=ws, name=name,
            defaults={"color": request.data.get("color") or "#6b7280", "created_by": request.user},
        )
        return Response(
            self.get_serializer(label).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class DocumentLabelDetailView(generics.RetrieveUpdateDestroyAPIView):
    """라벨 수정/삭제 — 만든 사람 또는 워크스페이스 관리자."""
    serializer_class = DocumentLabelSerializer

    def get_queryset(self):
        return DocumentLabel.objects.filter(workspace__slug=self.kwargs["workspace_slug"])

    def _can_manage(self, label):
        return label.created_by_id == self.request.user.id or _is_workspace_admin(
            self.request.user, label.workspace,
        )

    def update(self, request, *args, **kwargs):
        if not self._can_manage(self.get_object()):
            return Response({"detail": "라벨을 수정할 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self._can_manage(self.get_object()):
            return Response({"detail": "라벨을 삭제할 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class SpaceExportView(APIView):
    """스페이스 전체를 zip 으로 내보내기 — 트리 구조를 폴더로 재현한 HTML 묶음.

    zip 생성은 백엔드에서 한다. 프론트에서 만들면 압축 라이브러리를 새로 들여야 하고
    브라우저 메모리도 쓴다. 첨부 이미지는 절대 URL 로 남기므로 오프라인에서는 보이지 않는다.
    """

    #: 문서가 이보다 많으면 자른다. 자른 사실은 index.html 에 반드시 적는다(조용한 하드컷 금지).
    MAX_DOCS = 500

    def get(self, request, workspace_slug, space_pk):
        import io
        import re
        import zipfile

        space = get_object_or_404(DocumentSpace, pk=space_pk, workspace__slug=workspace_slug)
        if not _check_space_access(request.user, space):
            return Response({"detail": "접근 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)

        docs = list(
            Document.objects.filter(space=space, deleted_at__isnull=True).order_by("sort_order", "created_at")
        )
        truncated = len(docs) > self.MAX_DOCS
        docs = docs[: self.MAX_DOCS]
        by_id = {d.id: d for d in docs}

        def safe(text: str) -> str:
            """파일/폴더 이름으로 쓸 수 있게 — 경로 구분자와 제어문자만 걷어낸다(한글은 유지)."""
            cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]', "_", (text or "제목 없음")).strip()
            return (cleaned or "제목 없음")[:80]

        def path_of(doc) -> str:
            """상위 폴더를 따라 올라가 경로를 만든다. 부모가 잘려나갔으면 루트에 둔다."""
            parts, cur, guard = [], doc, 0
            while cur is not None and guard < 20:
                parts.append(safe(cur.title))
                cur = by_id.get(cur.parent_id) if cur.parent_id else None
                guard += 1
            return "/".join(reversed(parts))

        buffer = io.BytesIO()
        used: set[str] = set()
        index_rows = []
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for doc in docs:
                if doc.is_folder:
                    continue
                base = path_of(doc)
                name, n = f"{base}.html", 2
                while name in used:          # 같은 이름이 겹치면 -2, -3 을 붙인다
                    name, n = f"{base}-{n}.html", n + 1
                used.add(name)
                zf.writestr(name, _export_html(doc.title, doc.content_html))
                index_rows.append((name, doc.title))

            notice = (
                f"<p style='color:#b45309'>문서가 {self.MAX_DOCS}개를 넘어 앞의 {self.MAX_DOCS}개만 포함했습니다.</p>"
                if truncated else ""
            )
            links = "".join(f'<li><a href="{n}">{t}</a></li>' for n, t in index_rows)
            zf.writestr(
                "index.html",
                _export_html(space.name, f"{notice}<p>문서 {len(index_rows)}개</p><ul>{links}</ul>"),
            )

        from django.http import HttpResponse
        from urllib.parse import quote

        response = HttpResponse(buffer.getvalue(), content_type="application/zip")
        # 한글 파일명은 RFC 5987 로 — 안 그러면 브라우저가 깨진 이름으로 저장한다
        response["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(space.name)}.zip"
        return response


def _export_html(title: str, body: str) -> str:
    """내보내기용 단독 HTML — 앱 CSS 없이도 읽히도록 최소 스타일만 인라인."""
    from django.utils.html import escape

    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<title>{escape(title)}</title>"
        "<style>body{font-family:sans-serif;max-width:860px;margin:40px auto;padding:0 20px;line-height:1.7}"
        "pre{background:#f4f4f4;padding:16px;border-radius:8px;overflow-x:auto}"
        "blockquote{border-left:3px solid #ddd;margin:0;padding-left:16px;color:#666}"
        "table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px}</style>"
        f"</head><body><h1>{escape(title)}</h1>{body or ''}</body></html>"
    )


class SpaceAnalyticsView(APIView):
    """스페이스 조회 통계 — 많이 본 문서 / 총 조회수 / 조회자 수.

    개인별 조회 이력은 내보내지 않는다(집계만). "누가 봤는지"까지 노출하면 감시처럼 쓰인다.
    """

    def get(self, request, workspace_slug, space_pk):
        from datetime import timedelta
        from django.db.models import Sum

        space = get_object_or_404(DocumentSpace, pk=space_pk, workspace__slug=workspace_slug)
        if not _check_space_access(request.user, space):
            return Response({"detail": "접근 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)

        try:
            days = max(1, min(int(request.query_params.get("days", 30)), 365))
        except (TypeError, ValueError):
            days = 30
        since = timezone.now().date() - timedelta(days=days)

        views = DocumentView.objects.filter(
            document__space=space, document__deleted_at__isnull=True, viewed_on__gte=since,
        )
        top = (
            views.values("document_id", "document__title")
            .annotate(total=Sum("count"), viewers=Count("user", distinct=True))
            .order_by("-total")[:10]
        )
        return Response({
            "days": days,
            "total_views": views.aggregate(n=Sum("count"))["n"] or 0,
            "unique_viewers": views.values("user").distinct().count(),
            "top_documents": [
                {
                    "id": str(row["document_id"]),
                    "title": row["document__title"],
                    "views": row["total"],
                    "viewers": row["viewers"],
                }
                for row in top
            ],
        })


# ── 즐겨찾기 / 탐색 탭 ──

class MyDocumentsView(generics.ListAPIView):
    """내가 만든 문서 — 접근 가능한 스페이스 안에서"""
    serializer_class = DocumentTreeSerializer
    pagination_class = None

    def get_queryset(self):
        spaces = _get_accessible_spaces(self.request.user, self.kwargs["workspace_slug"])
        return Document.objects.filter(
            space__in=spaces,
            deleted_at__isnull=True,
            is_folder=False,
            created_by=self.request.user,
        ).order_by("-updated_at")[:100]


class RecentDocumentsView(generics.ListAPIView):
    """최근 업데이트된 문서 — 접근 가능한 스페이스 전반"""
    serializer_class = DocumentTreeSerializer
    pagination_class = None

    def get_queryset(self):
        spaces = _get_accessible_spaces(self.request.user, self.kwargs["workspace_slug"])
        return Document.objects.filter(
            space__in=spaces,
            deleted_at__isnull=True,
            is_folder=False,
        ).order_by("-updated_at")[:50]


class BookmarkedDocumentsView(generics.ListAPIView):
    """내가 즐겨찾기한 문서"""
    serializer_class = DocumentTreeSerializer
    pagination_class = None

    def get_queryset(self):
        spaces = _get_accessible_spaces(self.request.user, self.kwargs["workspace_slug"])
        return Document.objects.filter(
            space__in=spaces,
            deleted_at__isnull=True,
            is_folder=False,
            bookmarks__user=self.request.user,
        ).order_by("-bookmarks__created_at")


class BookmarkedSpacesView(generics.ListAPIView):
    """내가 즐겨찾기한 스페이스"""
    serializer_class = DocumentSpaceSerializer
    pagination_class = None

    def get_queryset(self):
        accessible = _get_accessible_spaces(self.request.user, self.kwargs["workspace_slug"])
        return accessible.filter(bookmarks__user=self.request.user).order_by("-bookmarks__created_at")


class SpaceBookmarkToggleView(APIView):
    """스페이스 즐겨찾기 토글 — POST 추가, DELETE 제거. 접근 권한 필요."""

    def _get_space(self, request, workspace_slug, space_id):
        accessible = _get_accessible_spaces(request.user, workspace_slug)
        try:
            return accessible.get(pk=space_id)
        except DocumentSpace.DoesNotExist:
            return None

    def post(self, request, workspace_slug, space_id):
        space = self._get_space(request, workspace_slug, space_id)
        if space is None:
            return Response({"detail": "스페이스가 없거나 접근 권한이 없습니다."}, status=status.HTTP_404_NOT_FOUND)
        DocumentSpaceBookmark.objects.get_or_create(user=request.user, space=space)
        return Response({"bookmarked": True})

    def delete(self, request, workspace_slug, space_id):
        space = self._get_space(request, workspace_slug, space_id)
        if space is None:
            return Response({"detail": "스페이스가 없거나 접근 권한이 없습니다."}, status=status.HTTP_404_NOT_FOUND)
        DocumentSpaceBookmark.objects.filter(user=request.user, space=space).delete()
        return Response({"bookmarked": False})


class OrphanSpaceListView(APIView):
    """탈퇴/비활성 사용자의 개인 스페이스 목록 — 슈퍼유저 전용.

    개인 스페이스는 소유자만 볼 수 있는 비공개 콘텐츠이고 삭제가 복구 불가이므로,
    워크스페이스 ADMIN 권한으로는 열지 않는다.
    """
    permission_classes = [IsSuperUser]

    def get(self, request, workspace_slug):
        # owner가 deleted_at != null 또는 is_active=False
        spaces = DocumentSpace.objects.filter(
            workspace__slug=workspace_slug,
            space_type="personal",
        ).filter(
            Q(owner__deleted_at__isnull=False) | Q(owner__is_active=False),
        ).select_related("owner").annotate(doc_count=Count("documents", filter=Q(documents__deleted_at__isnull=True)))

        data = []
        for s in spaces:
            owner = s.owner
            data.append({
                "id": str(s.id),
                "name": s.name,
                "owner_email": owner.email if owner else None,
                "owner_display_name": owner.display_name if owner else None,
                "owner_deleted_at": owner.deleted_at.isoformat() if owner and owner.deleted_at else None,
                "owner_is_active": owner.is_active if owner else False,
                "document_count": s.doc_count,
                "created_at": s.created_at.isoformat(),
            })
        return Response(data)


class OrphanSpaceDeleteView(APIView):
    """탈퇴자 개인 스페이스 영구 삭제 (CASCADE로 문서/첨부 모두 삭제) — 슈퍼유저 전용"""
    permission_classes = [IsSuperUser]

    def delete(self, request, workspace_slug, pk):
        try:
            space = DocumentSpace.objects.get(
                pk=pk, workspace__slug=workspace_slug, space_type="personal",
            )
        except DocumentSpace.DoesNotExist:
            return Response({"detail": "스페이스가 없습니다."}, status=status.HTTP_404_NOT_FOUND)
        # 안전장치 — 활성 사용자의 개인 스페이스는 거부
        owner = space.owner
        if owner and owner.is_active and not owner.deleted_at:
            return Response(
                {"detail": "활성 사용자의 개인 스페이스는 삭제할 수 없습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        space.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AttachmentSearchView(APIView):
    """워크스페이스 전체 첨부파일 검색 — 슈퍼유저 전용.

    스페이스 공개 여부를 무시하고 전량 조회하므로 워크스페이스 ADMIN 권한으로는 열지 않는다.
    """
    permission_classes = [IsSuperUser]

    def get(self, request, workspace_slug):
        q = request.query_params.get("q", "").strip()
        qs = DocumentAttachment.objects.filter(
            document__space__workspace__slug=workspace_slug,
        ).select_related("document", "document__space", "uploaded_by")
        if q:
            qs = qs.filter(filename__icontains=q)
        qs = qs.order_by("-created_at")[:200]

        data = []
        for a in qs:
            data.append({
                "id": str(a.id),
                "filename": a.filename,
                "file_size": a.file_size,
                "content_type": a.content_type,
                "file_url": a.file.url if a.file else None,
                "document_id": str(a.document.id),
                "document_title": a.document.title,
                "space_id": str(a.document.space.id),
                "space_name": a.document.space.name,
                "uploaded_by": a.uploaded_by.display_name if a.uploaded_by else None,
                "uploaded_at": a.created_at.isoformat(),
            })
        return Response(data)


class DocumentBookmarkToggleView(APIView):
    """즐겨찾기 토글 — POST면 추가, DELETE면 제거. 접근 권한 필요."""

    def _get_doc(self, request, workspace_slug, doc_id):
        from .models import DocumentBookmark  # local import to avoid cycle
        spaces = _get_accessible_spaces(request.user, workspace_slug)
        try:
            return Document.objects.get(pk=doc_id, space__in=spaces, deleted_at__isnull=True), DocumentBookmark
        except Document.DoesNotExist:
            return None, DocumentBookmark

    def post(self, request, workspace_slug, doc_id):
        doc, Bookmark = self._get_doc(request, workspace_slug, doc_id)
        if doc is None:
            return Response({"detail": "문서가 없거나 접근 권한이 없습니다."}, status=status.HTTP_404_NOT_FOUND)
        Bookmark.objects.get_or_create(user=request.user, document=doc)
        return Response({"bookmarked": True})

    def delete(self, request, workspace_slug, doc_id):
        doc, Bookmark = self._get_doc(request, workspace_slug, doc_id)
        if doc is None:
            return Response({"detail": "문서가 없거나 접근 권한이 없습니다."}, status=status.HTTP_404_NOT_FOUND)
        Bookmark.objects.filter(user=request.user, document=doc).delete()
        return Response({"bookmarked": False})


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
        visible = (
            Q(scope=DocumentTemplate.Scope.BUILT_IN)
            | Q(scope=DocumentTemplate.Scope.WORKSPACE, workspace=ws)
            | Q(scope=DocumentTemplate.Scope.USER, owner=user)
        )
        # ?space= 를 준 경우에만 그 스페이스 전용 템플릿을 얹는다 —
        # 스페이스 템플릿은 그 스페이스에서 문서를 만들 때만 보여야 한다.
        space_id = self.request.query_params.get("space")
        if space_id:
            visible |= Q(scope=DocumentTemplate.Scope.SPACE, space_id=space_id)
        qs = DocumentTemplate.objects.filter(visible).select_related("created_by")
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
        elif requested_scope == DocumentTemplate.Scope.SPACE:
            space = get_object_or_404(
                DocumentSpace, pk=self.request.data.get("space"), workspace=ws,
            )
            if not _check_space_edit(self.request.user, space):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("이 스페이스에 템플릿을 만들 권한이 없습니다.")
            serializer.save(
                scope=DocumentTemplate.Scope.SPACE, workspace=ws, owner=None,
                space=space, created_by=self.request.user,
            )
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
            | Q(scope=DocumentTemplate.Scope.SPACE, workspace=ws)
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
        elif instance.scope == DocumentTemplate.Scope.SPACE:
            if not instance.space or not _check_space_edit(user, instance.space):
                raise PermissionDenied("이 스페이스의 템플릿을 삭제할 권한이 없습니다.")
        else:
            if instance.owner_id != user.id:
                raise PermissionDenied("본인 소유 템플릿만 삭제할 수 있습니다.")
        instance.delete()
