"""워크스페이스 설정의 관리 화면 — 관리자만, 비공개 포함 전체를 다루되 내용은 싣지 않고, 동작은 활동 기록에 남는다."""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.documents.models import Document, DocumentSpace, DocumentSpaceMember
from apps.issues.models import Issue
from apps.projects.models import Project, ProjectMember
from apps.workspaces.models import Team, TeamMember, Workspace, WorkspaceActivity, WorkspaceMember


def _user(email, **extra):
    return User.objects.create_user(email=email, password="pw-123456!", display_name=email.split("@")[0],
                                    is_active=True, is_approved=True, is_email_verified=True, **extra)


class ManageTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.admin = _user("admin@x.io")
        self.member = _user("member@x.io")
        self.owner = _user("owner@x.io")
        WorkspaceMember.objects.create(workspace=self.ws, member=self.admin, role=20)
        WorkspaceMember.objects.create(workspace=self.ws, member=self.member, role=15)
        WorkspaceMember.objects.create(workspace=self.ws, member=self.owner, role=15)
        # 관리자가 멤버가 아닌 비공개 프로젝트
        self.secret = Project.objects.create(workspace=self.ws, name="비밀", identifier="SEC",
                                             network=Project.Network.SECRET, lead=self.owner)
        ProjectMember.objects.create(project=self.secret, member=self.owner, role=20)
        self.issue = Issue.objects.create(project=self.secret, workspace=self.ws, title="기밀 이슈 제목",
                                          created_by=self.owner)
        self.issue.assignees.set([self.member])
        ProjectMember.objects.create(project=self.secret, member=self.member, role=15)

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def last(self, action):
        return WorkspaceActivity.objects.filter(workspace=self.ws, action=action).first()

    # ── 권한 ──
    def test_non_admin_is_forbidden_everywhere(self):
        c = self.as_(self.member)
        for url in ["activity/", "projects/", f"projects/{self.secret.id}/members/",
                    f"members/{self.owner.id}/", "teams/", "usage/"]:
            self.assertEqual(c.get(f"/api/workspaces/ws/manage/{url}").status_code, 403, url)
        self.assertEqual(c.delete(f"/api/workspaces/ws/manage/projects/{self.secret.id}/").status_code, 403)
        self.assertEqual(self.as_(_user("out@x.io")).get("/api/workspaces/ws/manage/projects/").status_code, 403)

    # ── 프로젝트 ──
    def test_admin_lists_secret_project_without_issue_content(self):
        res = self.as_(self.admin).get("/api/workspaces/ws/manage/projects/")
        self.assertEqual(res.status_code, 200)
        row = next(p for p in res.data if p["identifier"] == "SEC")
        self.assertEqual((row["visibility"], row["issue_count"], row["member_count"], row["i_am_member"]),
                         ("private", 1, 2, False))
        self.assertNotIn("기밀 이슈 제목", str(res.content, "utf-8"))
        # 멤버가 아니므로 일반 화면에서는 여전히 안 보인다
        self.assertEqual(self.as_(self.admin).get(f"/api/workspaces/ws/projects/{self.secret.id}/").status_code, 404)

    def test_self_add_is_logged_and_grants_access(self):
        c = self.as_(self.admin)
        res = c.post(f"/api/workspaces/ws/manage/projects/{self.secret.id}/members/",
                     {"member": str(self.admin.id), "role": 10}, format="json")
        self.assertEqual(res.status_code, 201)
        log = self.last(WorkspaceActivity.Action.PROJECT_MEMBER_ADDED)
        self.assertEqual((log.actor, log.target_id, log.metadata["self_added"], log.metadata["is_private"]),
                         (self.admin, self.secret.id, True, True))
        self.assertEqual(c.get(f"/api/workspaces/ws/projects/{self.secret.id}/").status_code, 200)

    def test_member_role_and_last_admin_guard(self):
        c = self.as_(self.admin)
        base = f"/api/workspaces/ws/manage/projects/{self.secret.id}/members/"
        self.assertEqual(c.patch(f"{base}{self.owner.id}/", {"role": 15}, format="json").status_code, 400)
        self.assertEqual(c.delete(f"{base}{self.owner.id}/").status_code, 400)
        self.assertEqual(c.patch(f"{base}{self.member.id}/", {"role": 20}, format="json").status_code, 200)
        self.assertEqual(self.last(WorkspaceActivity.Action.PROJECT_MEMBER_ROLE).metadata["new_role"], 20)
        self.assertEqual(c.delete(f"{base}{self.owner.id}/").status_code, 204)  # 이제 다른 관리자가 있다
        self.secret.refresh_from_db()
        self.assertIsNone(self.secret.lead)  # 리드가 빠지면 리드도 비운다

    def test_lead_archive_and_trash(self):
        c = self.as_(self.admin)
        url = f"/api/workspaces/ws/manage/projects/{self.secret.id}/"
        outsider = _user("out@x.io")
        self.assertEqual(c.patch(url, {"lead": str(outsider.id)}, format="json").status_code, 400)
        self.assertEqual(c.patch(url, {"lead": str(self.member.id), "archived": True}, format="json").status_code, 200)
        self.secret.refresh_from_db()
        self.assertEqual(self.secret.lead, self.member)
        self.assertIsNotNone(self.secret.archived_at)
        self.assertEqual(ProjectMember.objects.get(project=self.secret, member=self.member).role, 20)
        self.assertIsNotNone(self.last(WorkspaceActivity.Action.PROJECT_ARCHIVED))
        self.assertEqual(c.delete(url).status_code, 204)
        self.assertTrue(Project.all_objects.filter(pk=self.secret.pk, deleted_at__isnull=False).exists())
        self.assertEqual(self.last(WorkspaceActivity.Action.PROJECT_TRASHED).metadata["via"], "workspace_settings")

    # ── 멤버 상세 ──
    def test_member_detail_shows_memberships(self):
        team = Team.objects.create(workspace=self.ws, name="플랫폼")
        TeamMember.objects.create(team=team, member=self.member, role=TeamMember.Role.ADMIN)
        res = self.as_(self.admin).get(f"/api/workspaces/ws/manage/members/{self.member.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([p["identifier"] for p in res.data["projects"]], ["SEC"])
        self.assertEqual([t["name"] for t in res.data["teams"]], ["플랫폼"])
        self.assertEqual(res.data["open_issue_count"], 1)
        self.assertEqual(self.as_(self.admin).get(f"/api/workspaces/ws/manage/members/{_user('o@x.io').id}/").status_code, 404)

    # ── 팀 ──
    def test_teams_list_and_delete_logged(self):
        team = Team.objects.create(workspace=self.ws, name="플랫폼")
        TeamMember.objects.create(team=team, member=self.owner, role=TeamMember.Role.ADMIN)
        c = self.as_(self.admin)
        res = c.get("/api/workspaces/ws/manage/teams/")
        self.assertEqual((res.data[0]["member_count"], res.data[0]["admins"]), (1, ["owner"]))
        self.assertEqual(c.delete(f"/api/workspaces/ws/manage/teams/{team.id}/").status_code, 204)
        self.assertFalse(Team.objects.filter(pk=team.pk).exists())
        self.assertEqual(self.last(WorkspaceActivity.Action.TEAM_DELETED).target_label, "플랫폼")

    # ── 사용량 ──
    def test_usage_counts_and_orphan_personal_spaces(self):
        left = _user("left@x.io")
        space = DocumentSpace.objects.create(workspace=self.ws, name="떠난 사람", owner=left,
                                             space_type=DocumentSpace.SpaceType.PERSONAL)
        Document.objects.create(space=space, title="개인 메모 제목")
        DocumentSpace.objects.create(workspace=self.ws, name="남은 사람", owner=self.member,
                                     space_type=DocumentSpace.SpaceType.PERSONAL)
        res = self.as_(self.admin).get("/api/workspaces/ws/manage/usage/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data["members"], res.data["projects"], res.data["issues"]), (3, 1, 1))
        self.assertEqual([(o["name"], o["reason"], o["document_count"]) for o in res.data["orphan_personal_spaces"]],
                         [("떠난 사람", "owner_left", 1)])
        self.assertFalse(res.data["can_delete_orphans"])
        self.assertNotIn("개인 메모 제목", str(res.content, "utf-8"))

    # ── 활동 기록 ──
    def test_activity_log_records_space_self_add_and_filters(self):
        space = DocumentSpace.objects.create(workspace=self.ws, name="인사", is_private=True,
                                             space_type=DocumentSpace.SpaceType.SHARED)
        DocumentSpaceMember.objects.create(space=space, member=self.owner, role=DocumentSpaceMember.Role.ADMIN)
        c = self.as_(self.admin)
        res = c.post(f"/api/workspaces/ws/documents/admin/spaces/{space.id}/members/",
                     {"member": str(self.admin.id), "role": DocumentSpaceMember.Role.VIEWER}, format="json")
        self.assertIn(res.status_code, (200, 201), res.data)
        c.delete(f"/api/workspaces/ws/manage/projects/{self.secret.id}/")

        res = c.get("/api/workspaces/ws/manage/activity/?category=space")
        self.assertEqual(res.status_code, 200)
        [row] = res.data["results"]
        self.assertEqual((row["action"], row["target_label"], row["actor"]["email"]),
                         ("space.member_added", "인사", "admin@x.io"))
        self.assertTrue(row["metadata"]["self_added"])
        self.assertEqual(row["metadata"]["via"], "workspace_settings")
        self.assertEqual([r["action"] for r in c.get("/api/workspaces/ws/manage/activity/").data["results"]],
                         ["project.trashed", "space.member_added"])
