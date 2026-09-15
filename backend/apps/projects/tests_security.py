"""프로젝트·워크스페이스·팀의 권한 경계."""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.documents.models import DocumentSpace, DocumentSpaceMember
from apps.issues.models import Issue
from apps.projects.models import Category, Project, ProjectEvent, ProjectMember, Sprint, State
from apps.workspaces.models import Team, TeamMember, Workspace, WorkspaceInvitation, WorkspaceMember


def rows(data):
    """페이지 응답이든 목록이든 행만."""
    return data["results"] if isinstance(data, dict) else data


def _user(email, **kw):
    return User.objects.create_user(email=email, password="pw-123456!", display_name=email.split("@")[0],
                                    is_active=True, is_approved=True, is_email_verified=True, **kw)


class Base(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.other_ws = Workspace.objects.create(name="Other", slug="other")
        self.admin = _user("admin@x.io")
        self.member = _user("member@x.io")
        self.viewer = _user("viewer@x.io")
        self.guest = _user("guest@x.io")
        self.stranger = _user("str@x.io")
        for u, role in ((self.admin, 20), (self.member, 15), (self.viewer, 15), (self.guest, 10)):
            WorkspaceMember.objects.create(workspace=self.ws, member=u, role=role)
        WorkspaceMember.objects.create(workspace=self.other_ws, member=self.stranger, role=25)

        self.public = Project.objects.create(workspace=self.ws, name="P", identifier="PUB",
                                             network=Project.Network.PUBLIC)
        self.secret = Project.objects.create(workspace=self.ws, name="S", identifier="SEC")
        for p in (self.public, self.secret):
            ProjectMember.objects.create(project=p, member=self.admin, role=20)
        ProjectMember.objects.create(project=self.public, member=self.viewer, role=10)
        ProjectMember.objects.create(project=self.public, member=self.member, role=15)

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def purl(self, project, tail=""):
        return f"/api/workspaces/{project.workspace.slug}/projects/{project.id}/{tail}"


class ProjectSecurityTests(Base):
    def test_public_project_invisible_to_other_workspace(self):
        c = self.as_(self.stranger)
        self.assertEqual(c.get(self.purl(self.public)).status_code, 404)
        self.assertEqual(rows(c.get(self.purl(self.public, "members/")).data), [])
        self.assertEqual(rows(c.get("/api/workspaces/ws/projects/").data), [])
        self.assertEqual(rows(c.get("/api/workspaces/ws/projects/discover/").data), [])

    def test_outsider_and_guest_cannot_join(self):
        self.assertEqual(self.as_(self.stranger).post(self.purl(self.public, "join/")).status_code, 404)
        self.assertEqual(self.as_(self.guest).post(self.purl(self.public, "join/")).status_code, 403)
        self.assertFalse(ProjectMember.objects.filter(project=self.public, member__in=[self.stranger, self.guest]).exists())

    def test_outsider_cannot_create_project_in_workspace(self):
        r = self.as_(self.stranger).post("/api/workspaces/ws/projects/", {"name": "x", "identifier": "XX"},
                                         format="json")
        self.assertEqual(r.status_code, 403)

    def test_non_admin_member_cannot_escalate_publish_or_delete(self):
        c = self.as_(self.viewer)
        self.assertEqual(c.patch(self.purl(self.public), {"lead": str(self.viewer.id)}, format="json").status_code, 403)
        self.assertEqual(c.patch(self.purl(self.public), {"network": 2}, format="json").status_code, 403)
        self.assertEqual(c.delete(self.purl(self.public)).status_code, 403)
        self.assertEqual(c.post(self.purl(self.public, "archive/")).status_code, 403)
        self.assertEqual(ProjectMember.objects.get(project=self.public, member=self.viewer).role, 10)
        self.assertTrue(Project.objects.filter(pk=self.public.pk, archived_at__isnull=True).exists())

    def test_admin_can_still_manage(self):
        c = self.as_(self.admin)
        self.assertEqual(c.patch(self.purl(self.public), {"name": "새 이름"}, format="json").status_code, 200)
        self.assertEqual(c.post(self.purl(self.public, "archive/")).status_code, 200)

    def test_sub_resource_writes_need_permission(self):
        state = State.objects.create(project=self.public, name="Todo", group="unstarted", color="#000")
        sprint = Sprint.objects.create(project=self.public, name="s", start_date="2026-09-01", end_date="2026-09-14")
        cat = Category.objects.create(project=self.public, name="c")
        event = ProjectEvent.objects.create(project=self.public, title="e", date="2026-09-01")
        for user, expected in ((self.stranger, 404), (self.guest, 403), (self.viewer, 403)):
            c = self.as_(user)
            with self.subTest(user=user.email):
                self.assertEqual(c.post(self.purl(self.public, "categories/"), {"name": "x"}, format="json").status_code, expected)
                self.assertEqual(c.post(self.purl(self.public, "states/"), {"name": "x", "color": "#000"},
                                        format="json").status_code, expected)
                self.assertEqual(c.post(self.purl(self.public, "sprints/"),
                                        {"name": "x", "start_date": "2026-09-01", "end_date": "2026-09-02"},
                                        format="json").status_code, expected)
                self.assertEqual(c.post(self.purl(self.public, "events/"), {"title": "x", "date": "2026-09-01"},
                                        format="json").status_code, expected)
                self.assertIn(c.post(self.purl(self.public, f"sprints/{sprint.id}/start/")).status_code, (403, 404))
                self.assertIn(c.delete(self.purl(self.public, f"states/{state.id}/")).status_code, (403, 404))
                self.assertIn(c.patch(self.purl(self.public, f"categories/{cat.id}/"), {"name": "y"},
                                      format="json").status_code, (403, 404))
                self.assertIn(c.delete(self.purl(self.public, f"events/{event.id}/")).status_code, (403, 404))
        self.assertTrue(State.objects.filter(pk=state.pk).exists())
        sprint.refresh_from_db()
        self.assertEqual(sprint.status, "draft")

    def test_secret_project_sub_resources_hidden(self):
        c = self.as_(self.member)
        self.assertEqual(c.post(self.purl(self.secret, "categories/"), {"name": "x"}, format="json").status_code, 404)
        self.assertEqual(rows(c.get(self.purl(self.secret, "categories/")).data), [])

    def test_sprint_status_cannot_be_forced(self):
        sprint = Sprint.objects.create(project=self.public, name="s", start_date="2026-09-01", end_date="2026-09-14")
        c = self.as_(self.member)
        r = c.patch(self.purl(self.public, f"sprints/{sprint.id}/"), {"status": "active"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = c.patch(self.purl(self.public, f"sprints/{sprint.id}/"), {"status": "cancelled"}, format="json")
        self.assertEqual(r.status_code, 200)

    def test_event_participants_must_be_workspace_members(self):
        r = self.as_(self.member).post(self.purl(self.public, "events/"),
                                       {"title": "x", "date": "2026-09-01", "participants": [str(self.stranger.id)]},
                                       format="json")
        self.assertEqual(r.status_code, 400)


class WorkspaceSecurityTests(Base):
    def test_only_staff_creates_workspaces(self):
        self.assertEqual(self.as_(self.member).post("/api/workspaces/", {"name": "n", "slug": "n1"},
                                                    format="json").status_code, 403)
        staff = _user("staff@x.io", is_staff=True)
        self.assertEqual(self.as_(staff).post("/api/workspaces/", {"name": "n", "slug": "n2"},
                                              format="json").status_code, 201)

    def test_admin_cannot_invite_owner(self):
        r = self.as_(self.admin).post("/api/workspaces/ws/invitations/", {"email": "alt@x.io", "role": 25},
                                      format="json")
        self.assertEqual(r.status_code, 403)
        self.assertFalse(WorkspaceInvitation.objects.filter(email="alt@x.io").exists())

    def test_invitation_list_admin_only_and_without_token(self):
        WorkspaceInvitation.objects.create(workspace=self.ws, email="a@x.io", role=15, invited_by=self.admin,
                                           expires_at="2099-01-01T00:00:00Z")
        self.assertEqual(self.as_(self.member).get("/api/workspaces/ws/invitations/").status_code, 403)
        self.assertEqual(self.as_(self.stranger).get("/api/workspaces/ws/invitations/").status_code, 404)
        data = self.as_(self.admin).get("/api/workspaces/ws/invitations/").data
        self.assertNotIn("token", data[0])

    def test_public_workspace_list_hides_owner(self):
        self.ws.owner = self.admin
        self.ws.save()
        data = APIClient().get("/api/workspaces/public/").data
        self.assertTrue(data)
        self.assertNotIn("owner", data[0])

    def test_removed_member_loses_project_team_space_access(self):
        team = Team.objects.create(workspace=self.ws, name="t", created_by=self.admin)
        TeamMember.objects.create(team=team, member=self.member, role=15)
        space = DocumentSpace.objects.create(workspace=self.ws, name="s", space_type="shared", is_private=True)
        DocumentSpaceMember.objects.create(space=space, member=self.member)
        WorkspaceMember.objects.create(workspace=self.other_ws, member=self.member, role=15)  # 계정은 남는다
        target = WorkspaceMember.objects.get(workspace=self.ws, member=self.member)
        r = self.as_(self.admin).delete(f"/api/workspaces/ws/members/{target.id}/")
        self.assertEqual(r.status_code, 204, getattr(r, "data", None))
        self.assertFalse(ProjectMember.objects.filter(member=self.member, project__workspace=self.ws).exists())
        self.assertFalse(TeamMember.objects.filter(member=self.member, team=team).exists())
        self.assertFalse(DocumentSpaceMember.objects.filter(member=self.member, space=space).exists())

    def test_self_made_team_does_not_reveal_secret_projects(self):
        # member 가 팀을 만들고 admin 을 넣어도 admin 의 비공개 프로젝트 이슈는 안 보인다
        Issue.objects.create(project=self.secret, workspace=self.ws, title="비밀", created_by=self.admin)
        c = self.as_(self.member)
        team_id = c.post("/api/workspaces/ws/teams/", {"name": "끼리"}, format="json").data["id"]
        c.post(f"/api/workspaces/ws/teams/{team_id}/members/", {"member": str(self.admin.id)}, format="json")
        from apps.workspaces.views import _team_visible_normal_project_ids
        visible = set(_team_visible_normal_project_ids(self.member, Team.objects.get(pk=team_id)))
        self.assertNotIn(self.secret.id, visible)

    def test_team_role_validated(self):
        c = self.as_(self.admin)
        team_id = c.post("/api/workspaces/ws/teams/", {"name": "t2"}, format="json").data["id"]
        r = c.post(f"/api/workspaces/ws/teams/{team_id}/members/", {"member": str(self.member.id), "role": "abc"},
                   format="json")
        self.assertEqual(r.status_code, 400)
