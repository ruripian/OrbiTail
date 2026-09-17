"""워크스페이스 설정의 관리 화면 API — 워크스페이스 관리자(ADMIN 이상)·슈퍼유저 전용.

원칙: **관리는 하되 내용은 보지 않는다.** 비공개 프로젝트·스페이스·팀을 목록으로 보고 멤버·보관·삭제를
다룰 수 있지만, 이슈 제목·문서 본문은 싣지 않는다. 내용을 봐야 하면 자신을 멤버로 추가해야 하고,
그 동작을 포함한 모든 관리 동작은 활동 기록(WorkspaceActivity)에 남는다.

주소는 `/api/workspaces/<slug>/manage/…` — 슈퍼유저 콘솔의 `/api/workspaces/admin/…` 와 섞이지 않게.
"""
from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import Team, TeamMember, Workspace, WorkspaceActivity, WorkspaceMember, log_workspace_activity


def _user_brief(user):
    if user is None:
        return None
    return {"id": str(user.id), "display_name": user.display_name, "email": user.email,
            "avatar": user.avatar.url if getattr(user, "avatar", None) else None}


class WorkspaceManageView(APIView):
    """판정만 담당. 하위 뷰는 self.workspace 를 쓴다."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        workspace = Workspace.objects.filter(slug=kwargs["workspace_slug"]).first()
        if workspace is None:
            raise NotFound()
        is_admin = request.user.is_superuser or WorkspaceMember.objects.filter(
            workspace=workspace, member=request.user, role__gte=WorkspaceMember.Role.ADMIN,
        ).exists()
        if not is_admin:
            raise PermissionDenied("Only a workspace administrator can view this.")
        self.workspace = workspace


# ══════════════════════════════════════════════════════════════════
#  활동 기록
# ══════════════════════════════════════════════════════════════════

class _ActivityPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class WorkspaceActivityListView(WorkspaceManageView):
    """?category=project|space|member|invitation|join|team|api_token|webhook  ?actor=<user id>  ?target=<id>"""

    def get(self, request, workspace_slug):
        qs = WorkspaceActivity.objects.filter(workspace=self.workspace).select_related("actor")
        category = request.query_params.get("category")
        if category:
            qs = qs.filter(action__startswith=f"{category}.")
        if request.query_params.get("actor"):
            qs = qs.filter(actor_id=request.query_params["actor"])
        if request.query_params.get("target"):
            qs = qs.filter(target_id=request.query_params["target"])
        paginator = _ActivityPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response([{
            "id": str(a.id),
            "action": a.action,
            "actor": _user_brief(a.actor) or {"id": None, "display_name": a.actor_label or "시스템", "email": ""},
            "target_type": a.target_type,
            "target_id": str(a.target_id) if a.target_id else None,
            "target_label": a.target_label,
            "metadata": a.metadata,
            "created_at": a.created_at,
        } for a in page])


# ══════════════════════════════════════════════════════════════════
#  프로젝트 — 비공개 포함 전체, 이슈 내용 없음
# ══════════════════════════════════════════════════════════════════

def _managed_project(workspace, pk, *, include_trashed=False):
    from apps.projects.models import Project
    manager = Project.all_objects if include_trashed else Project.objects
    return get_object_or_404(manager, pk=pk, workspace=workspace, kind=Project.Kind.NORMAL)


class ManageProjectListView(WorkspaceManageView):
    def get(self, request, workspace_slug):
        from apps.projects.models import Project, ProjectMember
        projects = (
            Project.all_objects.filter(workspace=self.workspace, kind=Project.Kind.NORMAL)
            .select_related("lead")
            .annotate(
                member_count=Count("members", distinct=True),
                issue_count=Count("issues", filter=Q(issues__deleted_at__isnull=True), distinct=True),
            )
            .order_by("name")
        )
        mine = set(ProjectMember.objects.filter(project__in=projects, member=request.user)
                   .values_list("project_id", flat=True))
        return Response([{
            "id": str(p.id),
            "name": p.name,
            "identifier": p.identifier,
            "icon_prop": p.icon_prop,
            "visibility": "public" if p.network == Project.Network.PUBLIC else "private",
            "lead": _user_brief(p.lead),
            "member_count": p.member_count,
            "issue_count": p.issue_count,
            "archived_at": p.archived_at,
            "deleted_at": p.deleted_at,
            "i_am_member": p.id in mine,
            "created_at": p.created_at,
        } for p in projects])


class ManageProjectDetailView(WorkspaceManageView):
    """PATCH { lead?, archived? } / DELETE → 휴지통으로(복구는 보관함의 휴지통에서)."""

    def patch(self, request, workspace_slug, pk):
        from apps.projects.models import ProjectMember
        project = _managed_project(self.workspace, pk)
        fields = []
        if "lead" in request.data:
            lead_id = request.data["lead"]
            lead = None
            if lead_id:
                lead = User.objects.filter(pk=lead_id, workspace_memberships__workspace=self.workspace).first()
                if lead is None:
                    return Response({"lead": ["워크스페이스 멤버만 리드로 지정할 수 있습니다."]},
                                    status=status.HTTP_400_BAD_REQUEST)
                # 리드는 프로젝트 관리자여야 설정을 다룰 수 있다 — 프로젝트 설정 화면과 같은 규칙
                pm, _ = ProjectMember.objects.get_or_create(project=project, member=lead,
                                                            defaults={"role": ProjectMember.Role.ADMIN})
                if pm.role != ProjectMember.Role.ADMIN:
                    pm.role = ProjectMember.Role.ADMIN
                    pm.save(update_fields=["role"])
            if project.lead_id != (lead.id if lead else None):
                project.lead = lead
                fields.append("lead")
                log_workspace_activity(self.workspace, request.user, WorkspaceActivity.Action.PROJECT_LEAD_CHANGED,
                                       target=project, lead=lead.email if lead else None, via="workspace_settings")
        if "archived" in request.data and bool(request.data["archived"]) != bool(project.archived_at):
            project.archived_at = timezone.now() if request.data["archived"] else None
            fields.append("archived_at")
            log_workspace_activity(
                self.workspace, request.user,
                WorkspaceActivity.Action.PROJECT_ARCHIVED if project.archived_at else WorkspaceActivity.Action.PROJECT_UNARCHIVED,
                target=project, via="workspace_settings",
            )
        if fields:
            project.save(update_fields=fields)
        return Response({"id": str(project.id), "lead": _user_brief(project.lead), "archived_at": project.archived_at})

    def delete(self, request, workspace_slug, pk):
        project = _managed_project(self.workspace, pk)
        project.deleted_at = timezone.now()
        project.deleted_by = request.user
        project.save(update_fields=["deleted_at", "deleted_by"])
        log_workspace_activity(self.workspace, request.user, WorkspaceActivity.Action.PROJECT_TRASHED,
                               target=project, via="workspace_settings")
        return Response(status=status.HTTP_204_NO_CONTENT)


class ManageProjectMemberListView(WorkspaceManageView):
    def get(self, request, workspace_slug, pk):
        from apps.projects.models import ProjectMember
        project = _managed_project(self.workspace, pk)
        members = ProjectMember.objects.filter(project=project).select_related("member").order_by("-role", "member__display_name")
        return Response([{"user": _user_brief(m.member), "role": m.role} for m in members])

    def post(self, request, workspace_slug, pk):
        from apps.projects.models import ProjectMember
        project = _managed_project(self.workspace, pk)
        member = User.objects.filter(pk=request.data.get("member"), workspace_memberships__workspace=self.workspace).first()
        if member is None:
            return Response({"member": ["워크스페이스 멤버만 추가할 수 있습니다."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            role = int(request.data.get("role", ProjectMember.Role.MEMBER))
        except (TypeError, ValueError):
            role = None
        if role not in ProjectMember.Role.values:
            return Response({"role": ["역할 값이 잘못되었습니다."]}, status=status.HTTP_400_BAD_REQUEST)
        pm, created = ProjectMember.objects.get_or_create(project=project, member=member, defaults={"role": role})
        if not created:
            return Response({"detail": "이미 프로젝트 멤버입니다."}, status=status.HTTP_400_BAD_REQUEST)
        log_workspace_activity(self.workspace, request.user, WorkspaceActivity.Action.PROJECT_MEMBER_ADDED,
                               target=project, member=member.email, role=role, via="workspace_settings",
                               self_added=member.pk == request.user.pk,
                               is_private=project.network != project.Network.PUBLIC)
        return Response({"user": _user_brief(member), "role": pm.role}, status=status.HTTP_201_CREATED)


class ManageProjectMemberDetailView(WorkspaceManageView):
    def _get(self, pk, member_id):
        from apps.projects.models import ProjectMember
        project = _managed_project(self.workspace, pk)
        return project, get_object_or_404(ProjectMember.objects.select_related("member"), project=project, member_id=member_id)

    def _last_admin(self, pm):
        from apps.projects.models import ProjectMember
        return pm.role == ProjectMember.Role.ADMIN and not ProjectMember.objects.filter(
            project_id=pm.project_id, role=ProjectMember.Role.ADMIN).exclude(pk=pm.pk).exists()

    def patch(self, request, workspace_slug, pk, member_id):
        from apps.projects.models import ProjectMember
        project, pm = self._get(pk, member_id)
        try:
            role = int(request.data.get("role"))
        except (TypeError, ValueError):
            role = None
        if role not in ProjectMember.Role.values:
            return Response({"role": ["역할 값이 잘못되었습니다."]}, status=status.HTTP_400_BAD_REQUEST)
        if role != ProjectMember.Role.ADMIN and self._last_admin(pm):
            return Response({"detail": "마지막 관리자는 강등할 수 없습니다."}, status=status.HTTP_400_BAD_REQUEST)
        old = pm.role
        pm.role = role
        pm.save(update_fields=["role"])
        if old != role:
            log_workspace_activity(self.workspace, request.user, WorkspaceActivity.Action.PROJECT_MEMBER_ROLE,
                                   target=project, member=pm.member.email, old_role=old, new_role=role,
                                   via="workspace_settings")
        return Response({"user": _user_brief(pm.member), "role": pm.role})

    def delete(self, request, workspace_slug, pk, member_id):
        project, pm = self._get(pk, member_id)
        if self._last_admin(pm):
            return Response({"detail": "마지막 관리자는 제거할 수 없습니다."}, status=status.HTTP_400_BAD_REQUEST)
        if project.lead_id == pm.member_id:
            project.lead = None
            project.save(update_fields=["lead"])
        log_workspace_activity(self.workspace, request.user, WorkspaceActivity.Action.PROJECT_MEMBER_REMOVED,
                               target=project, member=pm.member.email, via="workspace_settings")
        pm.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ══════════════════════════════════════════════════════════════════
#  멤버 상세 — 어디에 속해 있나(내보내기 전에 확인)
# ══════════════════════════════════════════════════════════════════

class ManageMemberDetailView(WorkspaceManageView):
    def get(self, request, workspace_slug, user_id):
        from apps.api.models import ApiToken
        from apps.documents.models import DocumentSpace, DocumentSpaceMember
        from apps.issues.models import Issue
        from apps.projects.models import Project, ProjectMember

        wm = get_object_or_404(WorkspaceMember.objects.select_related("member"), workspace=self.workspace, member_id=user_id)
        user = wm.member
        projects = (
            ProjectMember.objects.filter(member=user, project__workspace=self.workspace, project__kind=Project.Kind.NORMAL)
            .select_related("project").order_by("project__name")
        )
        spaces = (
            DocumentSpaceMember.objects.filter(member=user, space__workspace=self.workspace,
                                               space__space_type=DocumentSpace.SpaceType.SHARED)
            .select_related("space").order_by("space__name")
        )
        teams = TeamMember.objects.filter(member=user, team__workspace=self.workspace).select_related("team").order_by("team__name")
        open_issues = Issue.objects.filter(
            workspace=self.workspace, assignees=user, deleted_at__isnull=True, archived_at__isnull=True,
            project__deleted_at__isnull=True,
        ).exclude(state__group__in=["completed", "cancelled"])
        now = timezone.now()
        return Response({
            "user": {**_user_brief(user), "last_login": user.last_login, "is_active": user.is_active,
                     "is_suspended": user.is_suspended},
            "role": wm.role,
            "joined_at": wm.created_at,
            "projects": [{"id": str(m.project_id), "name": m.project.name, "identifier": m.project.identifier,
                          "role": m.role, "is_lead": m.project.lead_id == user.id,
                          "visibility": "public" if m.project.network == Project.Network.PUBLIC else "private",
                          "trashed": m.project.deleted_at is not None} for m in projects],
            "spaces": [{"id": str(m.space_id), "name": m.space.name, "role": m.role, "is_private": m.space.is_private}
                       for m in spaces],
            "teams": [{"id": str(m.team_id), "name": m.team.name, "role": m.role, "title": m.title} for m in teams],
            "open_issue_count": open_issues.count(),
            "active_api_tokens": ApiToken.objects.filter(workspace=self.workspace, user=user, revoked_at__isnull=True)
                                 .exclude(expires_at__lte=now).count(),
            "has_personal_space": DocumentSpace.objects.filter(workspace=self.workspace, owner=user,
                                                               space_type=DocumentSpace.SpaceType.PERSONAL).exists(),
        })


# ══════════════════════════════════════════════════════════════════
#  팀
# ══════════════════════════════════════════════════════════════════

class ManageTeamListView(WorkspaceManageView):
    def get(self, request, workspace_slug):
        teams = (
            Team.objects.filter(workspace=self.workspace)
            .annotate(member_count=Count("members", distinct=True))
            .select_related("created_by")
            .order_by("name")
        )
        admins = {}
        for tm in TeamMember.objects.filter(team__in=teams, role=TeamMember.Role.ADMIN).select_related("member"):
            admins.setdefault(tm.team_id, []).append(tm.member.display_name or tm.member.email)
        return Response([{
            "id": str(t.id), "name": t.name, "description": t.description, "icon_prop": t.icon_prop,
            "member_count": t.member_count, "admins": admins.get(t.id, []),
            "created_by": _user_brief(t.created_by), "created_at": t.created_at,
        } for t in teams])


class ManageTeamDetailView(WorkspaceManageView):
    def delete(self, request, workspace_slug, pk):
        team = get_object_or_404(Team, pk=pk, workspace=self.workspace)
        log_workspace_activity(self.workspace, request.user, WorkspaceActivity.Action.TEAM_DELETED,
                               target=team, via="workspace_settings")
        team.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ══════════════════════════════════════════════════════════════════
#  사용량 · 정리 대상
# ══════════════════════════════════════════════════════════════════

class ManageUsageView(WorkspaceManageView):
    def get(self, request, workspace_slug):
        from apps.documents.models import Document, DocumentAttachment, DocumentSpace
        from apps.issues.models import Issue, IssueAttachment
        from apps.projects.models import Project

        ws = self.workspace
        issue_files = IssueAttachment.objects.filter(issue__workspace=ws)
        doc_files = DocumentAttachment.objects.filter(document__space__workspace=ws)
        member_ids = set(WorkspaceMember.objects.filter(workspace=ws).values_list("member_id", flat=True))

        # 주인이 없는 개인 스페이스 — 탈퇴·비활성이거나 이 워크스페이스를 떠난 사람의 것.
        # 내용은 싣지 않는다(개인 공간). 삭제는 기존 슈퍼유저 전용 도구가 맡는다.
        orphans = []
        for sp in (DocumentSpace.objects.filter(workspace=ws, space_type=DocumentSpace.SpaceType.PERSONAL)
                   .select_related("owner")
                   .annotate(doc_count=Count("documents", filter=Q(documents__deleted_at__isnull=True), distinct=True))):
            owner = sp.owner
            reason = None
            if owner is None:
                reason = "owner_missing"
            elif owner.deleted_at is not None or not owner.is_active:
                reason = "owner_inactive"
            elif owner.id not in member_ids:
                reason = "owner_left"
            if reason:
                orphans.append({"id": str(sp.id), "name": sp.name, "owner_email": owner.email if owner else None,
                                "document_count": sp.doc_count, "reason": reason})

        return Response({
            "members": len(member_ids),
            "projects": Project.objects.filter(workspace=ws, kind=Project.Kind.NORMAL).count(),
            "projects_archived": Project.objects.filter(workspace=ws, kind=Project.Kind.NORMAL, archived_at__isnull=False).count(),
            "projects_trashed": Project.all_objects.filter(workspace=ws, deleted_at__isnull=False).count(),
            "issues": Issue.objects.filter(workspace=ws, deleted_at__isnull=True).count(),
            "issues_trashed": Issue.objects.filter(workspace=ws, deleted_at__isnull=False).count(),
            "spaces": DocumentSpace.objects.filter(workspace=ws, space_type=DocumentSpace.SpaceType.SHARED).count(),
            "documents": Document.objects.filter(space__workspace=ws, deleted_at__isnull=True, is_folder=False).count(),
            "documents_trashed": Document.objects.filter(space__workspace=ws, deleted_at__isnull=False).count(),
            "teams": Team.objects.filter(workspace=ws).count(),
            "storage": {
                "issue_attachments": {"count": issue_files.count(), "bytes": issue_files.aggregate(v=Sum("size"))["v"] or 0},
                "document_attachments": {"count": doc_files.count(), "bytes": doc_files.aggregate(v=Sum("file_size"))["v"] or 0},
            },
            "orphan_personal_spaces": orphans,
            "can_delete_orphans": request.user.is_superuser,
        })
