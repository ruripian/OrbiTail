"""프로젝트 휴지통 — 삭제는 휴지통으로, 복구·영구 삭제·보관 기간 경과 시 자동 삭제."""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.documents.models import Document, DocumentSpace
from apps.issues.models import Issue
from apps.projects.models import Project, ProjectMember
from apps.projects.tasks import permanently_delete_trashed_projects
from apps.workspaces.models import Workspace, WorkspaceMember


def _user(email):
    return User.objects.create_user(email=email, password="pw-123456!", display_name=email.split("@")[0],
                                    is_active=True, is_approved=True, is_email_verified=True)


def rows(data):
    return data["results"] if isinstance(data, dict) else data


class ProjectTrashTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.admin = _user("admin@x.io")       # 프로젝트 관리자
        self.member = _user("member@x.io")     # 프로젝트 일반 멤버
        for u in (self.admin, self.member):
            WorkspaceMember.objects.create(workspace=self.ws, member=u, role=15)
        self.project = Project.objects.create(workspace=self.ws, name="결제", identifier="PAY")
        ProjectMember.objects.create(project=self.project, member=self.admin, role=20)
        ProjectMember.objects.create(project=self.project, member=self.member, role=15)
        self.issue = Issue.objects.create(project=self.project, workspace=self.ws, title="결제 버그",
                                          created_by=self.admin)
        self.issue.assignees.set([self.member])
        self.space = DocumentSpace.objects.get(project=self.project)  # 프로젝트 저장 시 자동 생성
        self.doc = Document.objects.create(space=self.space, title="결제 설계")

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def delete_project(self):
        return self.as_(self.admin).delete(f"/api/workspaces/ws/projects/{self.project.id}/")

    def test_delete_moves_to_trash_and_hides_everywhere(self):
        self.assertEqual(self.delete_project().status_code, 204)
        self.assertTrue(Project.all_objects.filter(pk=self.project.pk, deleted_at__isnull=False).exists())
        self.assertTrue(Issue.objects.filter(pk=self.issue.pk).exists())  # 데이터는 그대로

        c = self.as_(self.member)
        self.assertEqual(rows(c.get("/api/workspaces/ws/projects/").data), [])
        self.assertEqual(c.get(f"/api/workspaces/ws/projects/{self.project.id}/").status_code, 404)
        self.assertEqual(c.get(f"/api/workspaces/ws/projects/{self.project.id}/issues/").data, [])
        self.assertEqual(c.get(f"/api/workspaces/ws/projects/{self.project.id}/issues/{self.issue.id}/").status_code, 404)
        self.assertEqual(rows(c.get("/api/workspaces/ws/issues/my/").data), [])
        self.assertEqual(rows(c.get("/api/workspaces/ws/issues/search/?search=결제").data), [])
        self.assertEqual(rows(c.get("/api/me/issues/?workspace=ws").data), [])
        spaces = [s["id"] for s in rows(c.get("/api/workspaces/ws/documents/spaces/").data)]
        self.assertNotIn(str(self.space.id), spaces)
        doc_url = f"/api/workspaces/ws/documents/spaces/{self.space.id}/docs/{self.doc.id}/"
        self.assertEqual(c.get(doc_url).status_code, 404)
        # 쓰기도 막힌다
        r = c.post(f"/api/workspaces/ws/projects/{self.project.id}/issues/", {"title": "x", "project": str(self.project.id)},
                   format="json")
        self.assertIn(r.status_code, (403, 404))

    def test_trash_list_restore_and_purge_permissions(self):
        self.delete_project()
        # 일반 멤버에게는 휴지통에 보이지 않고 복구도 못 한다
        self.assertEqual(self.as_(self.member).get("/api/workspaces/ws/projects/trash/").data, [])
        self.assertEqual(self.as_(self.member).post(f"/api/workspaces/ws/projects/trash/{self.project.id}/").status_code, 403)

        listed = self.as_(self.admin).get("/api/workspaces/ws/projects/trash/").data
        self.assertEqual([p["identifier"] for p in listed], ["PAY"])
        self.assertIn("purge_at", listed[0])

        self.assertEqual(self.as_(self.admin).post(f"/api/workspaces/ws/projects/trash/{self.project.id}/").status_code, 200)
        self.assertEqual(self.as_(self.member).get(f"/api/workspaces/ws/projects/{self.project.id}/issues/{self.issue.id}/").status_code, 200)
        self.assertEqual(self.as_(self.member).get(
            f"/api/workspaces/ws/documents/spaces/{self.space.id}/docs/{self.doc.id}/").status_code, 200)

        self.delete_project()
        self.assertEqual(self.as_(self.admin).delete(f"/api/workspaces/ws/projects/trash/{self.project.id}/").status_code, 204)
        self.assertFalse(Project.all_objects.filter(pk=self.project.pk).exists())
        self.assertFalse(Issue.objects.filter(pk=self.issue.pk).exists())
        self.assertFalse(DocumentSpace.objects.filter(pk=self.space.pk).exists())

    def test_workspace_admin_can_manage_trash(self):
        ws_admin = _user("wsadmin@x.io")
        WorkspaceMember.objects.create(workspace=self.ws, member=ws_admin, role=20)
        self.delete_project()
        self.assertEqual(self.as_(ws_admin).post(f"/api/workspaces/ws/projects/trash/{self.project.id}/").status_code, 200)

    def test_expired_trash_is_purged(self):
        self.delete_project()
        Project.all_objects.filter(pk=self.project.pk).update(deleted_at=timezone.now() - timedelta(days=31))
        fresh = Project.objects.create(workspace=self.ws, name="새것", identifier="NEW")
        Project.all_objects.filter(pk=fresh.pk).update(deleted_at=timezone.now() - timedelta(days=1))
        permanently_delete_trashed_projects()
        self.assertFalse(Project.all_objects.filter(pk=self.project.pk).exists())
        self.assertTrue(Project.all_objects.filter(pk=fresh.pk).exists())

    def test_identifier_held_by_trashed_project(self):
        self.delete_project()
        c = self.as_(self.admin)
        check = c.get("/api/workspaces/ws/projects/check-identifier/?identifier=PAY")
        if check.status_code == 200:
            self.assertFalse(check.data["available"])
        r = c.post("/api/workspaces/ws/projects/", {"name": "새 결제", "identifier": "PAY"}, format="json")
        self.assertEqual(r.status_code, 400, getattr(r, "data", None))
