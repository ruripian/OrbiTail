"""공개 API v1 엔드포인트.

권한은 새로 정의하지 않고 화면이 쓰는 규칙을 그대로 부른다 — 토큰 요청은 발급자 본인으로
처리되므로, 규칙이 두 벌이 되면 "화면에선 안 보이는데 API 로는 보이는" 틈이 생긴다.
"""
import re

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.translation import gettext, gettext_lazy
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.models import User
from apps.documents.links import sync_document_links
from apps.documents.markdown import markdown_to_html
from apps.documents.models import Document
from apps.documents.views import _check_space_edit
from apps.issues.models import Issue, IssueActivity, IssueComment, Label
from apps.issues.views import IssueArchiveView, _issue_field_snapshot, _log_activities
from apps.projects.models import Category, ProjectMember, Sprint, State
from apps.workspaces.models import WorkspaceMember

from . import serializers as s
from .access import accessible_spaces, readable_projects
from .base import PublicApiView
from .collab_client import CollabUnavailable, write_document_content

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
IDENTIFIER_RE = re.compile(r"^([A-Za-z0-9]{1,12})-(\d+)$")


# ══════════════════════════════════════════════════════════════════
#  토큰 확인
# ══════════════════════════════════════════════════════════════════

class MeView(PublicApiView):
    @extend_schema(
        tags=["token"],
        summary=gettext_lazy("Check the token — who it acts as, which workspace, and what permission"),
        responses=inline_serializer("Me", {
            "user": s.UserBriefSerializer(),
            "workspace": inline_serializer("MeWorkspace", {
                "id": serializers.UUIDField(), "slug": serializers.CharField(), "name": serializers.CharField(),
            }),
            "token": inline_serializer("MeToken", {
                "name": serializers.CharField(), "scope": serializers.CharField(),
                "expires_at": serializers.DateTimeField(allow_null=True),
            }),
        }),
    )
    def get(self, request):
        token = request.auth
        return Response({
            "user": {"id": str(request.user.id), "email": request.user.email,
                     "display_name": request.user.display_name},
            "workspace": {"id": str(self.workspace.id), "slug": self.workspace.slug,
                          "name": self.workspace.name},
            "token": {"name": token.name, "scope": token.scope, "expires_at": token.expires_at},
        })


# ══════════════════════════════════════════════════════════════════
#  프로젝트
# ══════════════════════════════════════════════════════════════════

class ProjectMixin:
    def readable_projects(self):
        return readable_projects(self.request.user, self.workspace)

    def get_project(self, project_id):
        if not UUID_RE.match(str(project_id)):
            raise NotFound(gettext("Project not found."))
        project = self.readable_projects().filter(pk=project_id).first()
        if project is None:
            raise NotFound(gettext("Project not found."))
        return project


class ProjectListView(ProjectMixin, PublicApiView):
    @extend_schema(
        tags=["projects"], summary=gettext_lazy("List projects"),
        parameters=[OpenApiParameter("include_archived", bool, description=gettext_lazy("Include archived projects"))],
        responses=s.ProjectSerializer(many=True),
    )
    def get(self, request):
        qs = self.readable_projects().order_by("name")
        if request.query_params.get("include_archived") != "true":
            qs = qs.filter(archived_at__isnull=True)
        return self.paginate(qs, s.ProjectSerializer)


class ProjectDetailView(ProjectMixin, PublicApiView):
    @extend_schema(tags=["projects"], summary=gettext_lazy("Project"), responses=s.ProjectSerializer)
    def get(self, request, project_id):
        return Response(s.ProjectSerializer(self.get_project(project_id), context={"request": request}).data)


def _sub_resource_view(model, serializer_class, summary, ordering, extra_filter=None):
    """프로젝트에 딸린 목록(상태·라벨·스프린트·카테고리)은 모양이 같다."""

    class View(ProjectMixin, PublicApiView):
        @extend_schema(tags=["projects"], summary=summary, responses=serializer_class(many=True))
        def get(self, request, project_id):
            project = self.get_project(project_id)
            qs = model.objects.filter(project=project, **(extra_filter or {})).order_by(*ordering)
            return Response(serializer_class(qs, many=True).data)

    View.__name__ = f"Project{model.__name__}ListView"
    return View


ProjectStateListView = _sub_resource_view(State, s.StateSerializer, gettext_lazy("Project states"), ["sequence"])
ProjectLabelListView = _sub_resource_view(Label, s.LabelSerializer, gettext_lazy("Project labels"), ["name"])
ProjectSprintListView = _sub_resource_view(Sprint, s.SprintSerializer, gettext_lazy("Project sprints"), ["-start_date"])
ProjectCategoryListView = _sub_resource_view(Category, s.CategorySerializer, gettext_lazy("Project categories"), ["sort_order", "name"])


class ProjectMemberListView(ProjectMixin, PublicApiView):
    @extend_schema(tags=["projects"], summary=gettext_lazy("Project members"), responses=s.ProjectMemberSerializer(many=True))
    def get(self, request, project_id):
        project = self.get_project(project_id)
        qs = ProjectMember.objects.filter(project=project).select_related("member").order_by("member__display_name")
        return Response(s.ProjectMemberSerializer(qs, many=True).data)


# ══════════════════════════════════════════════════════════════════
#  이슈
# ══════════════════════════════════════════════════════════════════

ISSUE_ORDERINGS = {"created_at", "-created_at", "updated_at", "-updated_at", "sequence", "-sequence"}


class IssueMixin(ProjectMixin):
    def readable_issues(self):
        return (
            Issue.objects.filter(
                workspace=self.workspace,
                deleted_at__isnull=True,
                project__in=self.readable_projects(),
            )
            .select_related("project", "workspace", "state", "sprint", "category", "created_by")
            .prefetch_related("assignees", "label")
        )

    def get_issue(self, ref):
        """id 또는 사람이 읽는 번호(OUR-12) 둘 다 받는다 — 커밋 메시지·채팅에서 오는 건 대개 번호다."""
        qs = self.readable_issues()
        if UUID_RE.match(ref):
            issue = qs.filter(pk=ref).first()
        else:
            m = IDENTIFIER_RE.match(ref)
            issue = (
                qs.filter(project__identifier__iexact=m.group(1), sequence_id=int(m.group(2))).first()
                if m else None
            )
        if issue is None:
            raise NotFound(gettext("Issue not found."))
        return issue

    def require_perm(self, project, perm_key):
        pm = ProjectMember.objects.filter(project=project, member=self.request.user).first()
        if pm is None:
            raise PermissionDenied(gettext("Only a project member can do this."))
        if not pm.effective_perms.get(perm_key, False):
            raise PermissionDenied(gettext("You do not have permission for this action. (%(perm)s)") % {"perm": perm_key})

    def resolve_relations(self, project, data, instance=None):
        """id 로 받은 관계 값을 실제 객체로. 전부 같은 프로젝트 소속이어야 한다."""
        resolved = {}

        def one(field, model, message):
            if field not in data:
                return
            value = data[field]
            if value is None:
                resolved[field] = None
                return
            obj = model.objects.filter(pk=value, project=project).first()
            if obj is None:
                raise ValidationError({field: message})
            resolved[field] = obj

        one("state", State, gettext("That state does not belong to this project."))
        one("sprint", Sprint, gettext("That sprint does not belong to this project."))
        one("category", Category, gettext("That category does not belong to this project."))

        if "parent" in data:
            parent_id = data["parent"]
            if parent_id is None:
                resolved["parent"] = None
            else:
                parent = Issue.objects.filter(pk=parent_id, project=project, deleted_at__isnull=True).first()
                if parent is None:
                    raise ValidationError({"parent": gettext("That issue does not belong to this project.")})
                if instance is not None:
                    # 자기 자신이나 자손 밑으로 넣으면 트리가 고리가 된다
                    cur, seen = parent, set()
                    while cur is not None and cur.pk not in seen:
                        if cur.pk == instance.pk:
                            raise ValidationError({"parent": gettext("It cannot be moved under itself or one of its own sub-issues.")})
                        seen.add(cur.pk)
                        cur = cur.parent
                resolved["parent"] = parent

        if "labels" in data:
            ids = set(data["labels"])
            labels = list(Label.objects.filter(pk__in=ids, project=project))
            if len(labels) != len(ids):
                raise ValidationError({"labels": gettext("Some labels do not belong to this project.")})
            resolved["labels"] = labels

        if "assignees" in data:
            ids = set(data["assignees"])
            users = list(User.objects.filter(
                pk__in=ids,
                workspace_memberships__workspace=self.workspace,
                workspace_memberships__role__gte=WorkspaceMember.Role.MEMBER,
            ).distinct())
            if len(users) != len(ids):
                raise ValidationError({"assignees": gettext("Some users are not members of this workspace.")})
            resolved["assignees"] = users
        return resolved


SCALAR_ISSUE_FIELDS = ("title", "description_html", "priority", "start_date", "due_date", "estimate_point")


class IssueListView(IssueMixin, PublicApiView):
    @extend_schema(
        tags=["issues"], summary=gettext_lazy("List issues"),
        parameters=[
            OpenApiParameter("project", OpenApiTypes.UUID),
            OpenApiParameter("state", OpenApiTypes.UUID),
            OpenApiParameter("state_group", str, description="backlog | unstarted | started | completed | cancelled"),
            OpenApiParameter("priority", str),
            OpenApiParameter("assignee", str, description=gettext_lazy("User id, or me")),
            OpenApiParameter("label", OpenApiTypes.UUID),
            OpenApiParameter("sprint", OpenApiTypes.UUID),
            OpenApiParameter("parent", str, description=gettext_lazy("Issue id, or none (top-level issues only)")),
            OpenApiParameter("updated_since", OpenApiTypes.DATETIME, description=gettext_lazy("Only issues changed after this time — for syncing")),
            OpenApiParameter("search", str, description=gettext_lazy("Text contained in the title")),
            OpenApiParameter("include_archived", bool),
            OpenApiParameter("ordering", str, description=gettext_lazy("-updated_at (default) | updated_at | created_at | -created_at | sequence | -sequence")),
            OpenApiParameter("page", int), OpenApiParameter("page_size", int, description=gettext_lazy("Up to 100")),
        ],
        responses=s.IssueSerializer(many=True),
    )
    def get(self, request):
        p = request.query_params
        qs = self.readable_issues()
        if p.get("include_archived") != "true":
            qs = qs.filter(archived_at__isnull=True)

        for param, lookup in (("project", "project_id"), ("state", "state_id"), ("label", "label"),
                              ("sprint", "sprint_id")):
            if p.get(param):
                if not UUID_RE.match(p[param]):
                    raise ValidationError({param: gettext("Not a valid id.")})
                qs = qs.filter(**{lookup: p[param]})
        if p.get("state_group"):
            qs = qs.filter(state__group=p["state_group"])
        if p.get("priority"):
            qs = qs.filter(priority=p["priority"])
        if p.get("assignee"):
            if p["assignee"] == "me":
                qs = qs.filter(assignees=request.user)
            elif UUID_RE.match(p["assignee"]):
                qs = qs.filter(assignees=p["assignee"])
            else:
                raise ValidationError({"assignee": gettext("Must be a user id or 'me'.")})
        if p.get("parent"):
            if p["parent"] == "none":
                qs = qs.filter(parent__isnull=True)
            elif UUID_RE.match(p["parent"]):
                qs = qs.filter(parent_id=p["parent"])
            else:
                raise ValidationError({"parent": gettext("Must be an issue id or 'none'.")})
        if p.get("updated_since"):
            since = parse_datetime(p["updated_since"])
            if since is None:
                raise ValidationError({"updated_since": gettext("Must be an ISO 8601 timestamp, e.g. 2026-09-15T09:00:00+09:00")})
            if timezone.is_naive(since):
                since = timezone.make_aware(since)
            qs = qs.filter(updated_at__gte=since)
        if p.get("search"):
            qs = qs.filter(title__icontains=p["search"])

        ordering = p.get("ordering", "-updated_at")
        if ordering not in ISSUE_ORDERINGS:
            raise ValidationError({"ordering": gettext("Must be one of: %(choices)s") % {"choices": ", ".join(sorted(ISSUE_ORDERINGS))}})
        ordering = ordering.replace("sequence", "sequence_id")
        # 같은 시각이 겹쳐도 페이지 경계에서 빠지거나 두 번 나오지 않게 id 로 한 번 더 정렬한다
        qs = qs.distinct().order_by(ordering, "id")
        return self.paginate(qs, s.IssueSerializer)

    @extend_schema(tags=["issues"], summary=gettext_lazy("Create an issue (write)"), request=s.IssueWriteSerializer,
                   responses={201: s.IssueSerializer})
    def post(self, request):
        ser = s.IssueWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if not data.get("project"):
            raise ValidationError({"project": gettext("This field is required.")})
        if not data.get("title"):
            raise ValidationError({"title": gettext("This field is required.")})

        project = self.get_project(data["project"])
        self.require_perm(project, "can_edit")
        rel = self.resolve_relations(project, data)

        state = rel.get("state") or (
            State.objects.filter(project=project, group="unstarted").order_by("sequence").first()
            or State.objects.filter(project=project).order_by("sequence").first()
        )
        issue = Issue(
            project=project, workspace=self.workspace, created_by=request.user, state=state,
            sprint=rel.get("sprint"), category=rel.get("category"), parent=rel.get("parent"),
            **{f: data[f] for f in SCALAR_ISSUE_FIELDS if f in data},
        )
        issue.save()
        issue.assignees.set(rel.get("assignees", []))
        issue.label.set(rel.get("labels", []))
        IssueActivity.objects.create(issue=issue, actor=request.user, verb="created")

        issue = self.get_issue(str(issue.pk))
        return Response(s.IssueSerializer(issue, context={"request": request}).data, status=status.HTTP_201_CREATED)


class IssueDetailView(IssueMixin, PublicApiView):
    @extend_schema(tags=["issues"], summary=gettext_lazy("Issue — by id or number (OUR-12)"), responses=s.IssueSerializer)
    def get(self, request, ref):
        return Response(s.IssueSerializer(self.get_issue(ref), context={"request": request}).data)

    @extend_schema(tags=["issues"], summary=gettext_lazy("Update an issue — only the fields sent change (write)"),
                   request=s.IssueWriteSerializer, responses=s.IssueSerializer)
    def patch(self, request, ref):
        issue = self.get_issue(ref)
        self.require_perm(issue.project, "can_edit")
        ser = s.IssueWriteSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if "project" in data and str(data["project"]) != str(issue.project_id):
            raise ValidationError({"project": gettext("An issue cannot be moved to a different project.")})
        rel = self.resolve_relations(issue.project, data, instance=issue)

        before = _issue_field_snapshot(issue)
        old_sprint_id = issue.sprint_id
        for f in SCALAR_ISSUE_FIELDS:
            if f in data:
                setattr(issue, f, data[f])
        for f in ("state", "sprint", "category", "parent"):
            if f in rel:
                setattr(issue, f, rel[f])
        if rel.get("state") is not None:
            # 상태를 지정했다는 건 일반 작업으로 다루겠다는 뜻 — 내부 API 와 같은 규칙
            issue.is_field = False
        issue.save()
        if "assignees" in rel:
            issue.assignees.set(rel["assignees"])
        if "labels" in rel:
            issue.label.set(rel["labels"])

        issue = self.get_issue(str(issue.pk))
        _log_activities(issue, request.user, before, _issue_field_snapshot(issue))
        if issue.sprint_id != old_sprint_id:
            # 화면과 같은 규칙: 스프린트를 옮기면 하위 이슈도 따라간다
            issue.sub_issues.filter(deleted_at__isnull=True).update(sprint=issue.sprint)
        return Response(s.IssueSerializer(issue, context={"request": request}).data)

    @extend_schema(tags=["issues"], summary=gettext_lazy("Delete an issue — moves it to the trash with its sub-issues (write)"),
                   responses={204: None})
    def delete(self, request, ref):
        issue = self.get_issue(ref)
        self.require_perm(issue.project, "can_delete")
        now = timezone.now()
        descendant_ids = IssueArchiveView._collect_descendant_ids(issue.id)
        if descendant_ids:
            Issue.objects.filter(id__in=descendant_ids, deleted_at__isnull=True).update(deleted_at=now)
        issue.deleted_at = now
        issue.save(update_fields=["deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueCommentListView(IssueMixin, PublicApiView):
    @extend_schema(tags=["issues"], summary=gettext_lazy("List issue comments"), responses=s.CommentSerializer(many=True))
    def get(self, request, ref):
        issue = self.get_issue(ref)
        qs = IssueComment.objects.filter(issue=issue).select_related("actor").order_by("created_at", "id")
        return self.paginate(qs, s.CommentSerializer)

    @extend_schema(tags=["issues"], summary=gettext_lazy("Add a comment (write)"), request=s.CommentWriteSerializer,
                   responses={201: s.CommentSerializer})
    def post(self, request, ref):
        issue = self.get_issue(ref)
        # 읽을 수 있는 이슈(공개 프로젝트 포함)에는 댓글을 달 수 있다 — 화면과 같은 규칙
        ser = s.CommentWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        parent = None
        if ser.validated_data.get("parent"):
            parent = IssueComment.objects.filter(pk=ser.validated_data["parent"], issue=issue).first()
            if parent is None:
                raise ValidationError({"parent": gettext("That comment does not belong to this issue.")})
            # 답글은 1단계만 — 답글에 단 답글은 같은 부모 밑으로
            parent = parent.parent or parent
        comment = IssueComment.objects.create(
            issue=issue, actor=request.user, parent=parent,
            comment_html=markdown_to_html(ser.validated_data["body"]),
        )
        return Response(s.CommentSerializer(comment).data, status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════
#  문서
# ══════════════════════════════════════════════════════════════════

class DocumentMixin:
    def accessible_spaces(self):
        return accessible_spaces(self.request.user, self.workspace)

    def get_space(self, space_id):
        space = self.accessible_spaces().filter(pk=space_id).first() if UUID_RE.match(str(space_id)) else None
        if space is None:
            raise NotFound(gettext("Space not found."))
        return space

    def require_edit(self, space):
        if not _check_space_edit(self.request.user, space):
            raise PermissionDenied(gettext("You do not have edit permission for this space."))

    def resolve_parent(self, space, parent_id, moving=None):
        if parent_id is None:
            return None
        parent = Document.objects.filter(pk=parent_id, space=space, deleted_at__isnull=True).first()
        if parent is None:
            raise ValidationError({"parent": gettext("That document does not belong to this space.")})
        if moving is not None:
            cur, seen = parent, set()
            while cur is not None and cur.pk not in seen:
                if cur.pk == moving.pk:
                    raise ValidationError({"parent": gettext("It cannot be moved under itself or one of its own sub-documents.")})
                seen.add(cur.pk)
                cur = cur.parent
        return parent

    def to_html(self, space, markdown):
        """`[[제목]]` 은 같은 스페이스의 문서로 잇는다 — 가져오기(.md 반입)와 같은 규칙."""
        by_title = {
            title.strip().lower(): (str(pk), str(space.id))
            for pk, title in Document.objects.filter(space=space, deleted_at__isnull=True).values_list("id", "title")
        }
        return markdown_to_html(markdown, resolve_wikilink=lambda t: by_title.get(t.strip().lower()))

    def get_document(self, doc_id):
        doc = None
        if UUID_RE.match(str(doc_id)):
            doc = (
                Document.objects.filter(pk=doc_id, deleted_at__isnull=True, space__in=self.accessible_spaces())
                .select_related("space", "space__workspace", "created_by")
                .prefetch_related("labels")
                .first()
            )
        if doc is None:
            raise NotFound(gettext("Document not found."))
        return doc


class SpaceListView(DocumentMixin, PublicApiView):
    @extend_schema(tags=["documents"], summary=gettext_lazy("List document spaces"), responses=s.SpaceSerializer(many=True))
    def get(self, request):
        return Response(s.SpaceSerializer(self.accessible_spaces().order_by("name"), many=True).data)


class SpaceDocumentListView(DocumentMixin, PublicApiView):
    @extend_schema(
        tags=["documents"], summary=gettext_lazy("List documents in a space — folder structure via parent"),
        parameters=[OpenApiParameter("updated_since", OpenApiTypes.DATETIME),
                    OpenApiParameter("page", int), OpenApiParameter("page_size", int)],
        responses=s.DocumentListSerializer(many=True),
    )
    def get(self, request, space_id):
        space = self.get_space(space_id)
        qs = Document.objects.filter(space=space, deleted_at__isnull=True)
        if request.query_params.get("updated_since"):
            since = parse_datetime(request.query_params["updated_since"])
            if since is None:
                raise ValidationError({"updated_since": gettext("Must be an ISO 8601 timestamp.")})
            if timezone.is_naive(since):
                since = timezone.make_aware(since)
            qs = qs.filter(updated_at__gte=since)
        return self.paginate(qs.order_by("created_at", "id"), s.DocumentListSerializer)

    @extend_schema(tags=["documents"], summary=gettext_lazy("Create a document (write)"), request=s.DocumentCreateSerializer,
                   responses={201: s.DocumentSerializer})
    def post(self, request, space_id):
        space = self.get_space(space_id)
        self.require_edit(space)
        ser = s.DocumentCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if data.get("is_folder") and data.get("content"):
            raise ValidationError({"content": gettext("A folder cannot have body content.")})

        # 새 문서는 아직 아무도 열지 않았으므로 DB 에 바로 쓴다. 처음 여는 순간 협업 서버가 이 HTML 로 시작한다.
        doc = Document.objects.create(
            space=space, created_by=request.user, title=data["title"],
            parent=self.resolve_parent(space, data.get("parent")),
            is_folder=data.get("is_folder", False),
            properties=data.get("properties") or {},
            content_html=self.to_html(space, data["content"]) if data.get("content") else "",
        )
        if doc.content_html:
            try:
                sync_document_links(doc)
            except Exception:
                pass  # 링크 반영 실패가 생성을 되돌리면 안 된다 — 다음 저장에서 맞춰진다
        doc = self.get_document(doc.pk)
        return Response(s.DocumentSerializer(doc, context={"request": request}).data, status=status.HTTP_201_CREATED)


class DocumentDetailView(DocumentMixin, PublicApiView):
    @extend_schema(tags=["documents"], summary=gettext_lazy("Document — body as Markdown"), responses=s.DocumentSerializer)
    def get(self, request, doc_id):
        return Response(s.DocumentSerializer(self.get_document(doc_id), context={"request": request}).data)

    @extend_schema(tags=["documents"], summary=gettext_lazy("Update title, location, properties (write) — body via content/"),
                   request=s.DocumentUpdateSerializer, responses=s.DocumentSerializer)
    def patch(self, request, doc_id):
        doc = self.get_document(doc_id)
        self.require_edit(doc.space)
        ser = s.DocumentUpdateSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        fields = []
        if "title" in data:
            doc.title = data["title"]
            fields.append("title")
        if "parent" in data:
            doc.parent = self.resolve_parent(doc.space, data["parent"], moving=doc)
            fields.append("parent")
        if "properties" in data:
            doc.properties = data["properties"]
            fields.append("properties")
        if fields:
            doc.save(update_fields=[*fields, "updated_at"])
        return Response(s.DocumentSerializer(self.get_document(doc.pk), context={"request": request}).data)

    @extend_schema(tags=["documents"], summary=gettext_lazy("Delete a document — moves it to the trash with its sub-documents (write)"),
                   responses={204: None})
    def delete(self, request, doc_id):
        doc = self.get_document(doc_id)
        self.require_edit(doc.space)
        now = timezone.now()
        frontier = [doc.pk]
        ids = []
        while frontier:
            ids.extend(frontier)
            frontier = list(
                Document.objects.filter(parent_id__in=frontier, deleted_at__isnull=True).values_list("id", flat=True)
            )
        for d in Document.objects.filter(pk__in=ids, deleted_at__isnull=True):
            # save() 로 하나씩 — 화면의 삭제와 같이 저장 시그널(실시간 반영 등)을 탄다
            d.deleted_at, d.deleted_by = now, request.user
            d.save(update_fields=["deleted_at", "deleted_by"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class _DocumentContentWrite(DocumentMixin, PublicApiView):
    mode = "replace"

    def write(self, request, doc_id):
        doc = self.get_document(doc_id)
        self.require_edit(doc.space)
        if doc.is_folder:
            raise ValidationError({"content": gettext("A folder has no body content.")})
        ser = s.DocumentContentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            doc.content_html = write_document_content(doc.pk, self.to_html(doc.space, ser.validated_data["content"]),
                                                      self.mode)
        except CollabUnavailable:
            # DB 에 직접 쓰는 우회로를 두지 않는다 — 편집 중인 사람의 저장에 덮여 조용히 사라진다
            return Response({"detail": gettext("Could not reach the real-time collaboration server, so the body was not changed. Try again shortly.")},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        Document.objects.filter(pk=doc.pk).update(updated_at=timezone.now())
        return Response(s.DocumentSerializer(doc, context={"request": request}).data)


class DocumentContentView(_DocumentContentWrite):
    mode = "replace"

    @extend_schema(
        tags=["documents"],
        summary=gettext_lazy("Replace the whole body (write)"),
        description=gettext_lazy("Safe even while someone is editing. The change is applied as an edit to the live document, shows up immediately on open screens, and unchanged paragraphs are kept."),
        request=s.DocumentContentSerializer, responses={200: s.DocumentSerializer, 503: None},
    )
    def put(self, request, doc_id):
        return self.write(request, doc_id)


class DocumentAppendView(_DocumentContentWrite):
    mode = "append"

    @extend_schema(tags=["documents"], summary=gettext_lazy("Append to the body (write) — for accumulating logs or meeting notes"),
                   request=s.DocumentContentSerializer, responses={200: s.DocumentSerializer, 503: None})
    def post(self, request, doc_id):
        return self.write(request, doc_id)
