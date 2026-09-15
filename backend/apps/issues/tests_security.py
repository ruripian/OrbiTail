"""이슈와 하위 자원의 권한 경계 — 로그인만 했을 뿐 대상에 권한이 없는 사용자가 무엇을 못 해야 하는가."""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.issues.models import Issue, IssueActivity, IssueAttachment, IssueComment, IssueLink, IssueNodeLink, Label
from apps.projects.models import Project, ProjectMember, State
from apps.workspaces.models import Workspace, WorkspaceMember


def _user(email):
    return User.objects.create_user(email=email, password="pw-123456!", display_name=email.split("@")[0],
                                    is_active=True, is_approved=True, is_email_verified=True)


class IssueSecurityTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.other_ws = Workspace.objects.create(name="Other", slug="other")
        self.owner = _user("owner@x.io")      # 비공개 프로젝트 멤버
        self.intruder = _user("in@x.io")      # 같은 워크스페이스, 프로젝트 멤버 아님
        self.stranger = _user("str@x.io")     # 다른 워크스페이스
        WorkspaceMember.objects.create(workspace=self.ws, member=self.owner, role=15)
        WorkspaceMember.objects.create(workspace=self.ws, member=self.intruder, role=15)
        WorkspaceMember.objects.create(workspace=self.other_ws, member=self.stranger, role=15)

        self.secret = Project.objects.create(workspace=self.ws, name="S", identifier="SEC")
        self.public = Project.objects.create(workspace=self.ws, name="P", identifier="PUB",
                                             network=Project.Network.PUBLIC)
        self.mine = Project.objects.create(workspace=self.ws, name="M", identifier="MIN")
        ProjectMember.objects.create(project=self.secret, member=self.owner, role=20)
        ProjectMember.objects.create(project=self.public, member=self.owner, role=20)
        ProjectMember.objects.create(project=self.mine, member=self.intruder, role=15)

        self.state = State.objects.create(project=self.secret, name="Todo", group="unstarted", color="#000")
        self.issue = Issue.objects.create(project=self.secret, workspace=self.ws, title="비밀 이슈",
                                          state=self.state, created_by=self.owner)
        self.child = Issue.objects.create(project=self.secret, workspace=self.ws, title="비밀 하위",
                                          parent=self.issue, created_by=self.owner)
        self.public_issue = Issue.objects.create(project=self.public, workspace=self.ws, title="공개 이슈",
                                                 created_by=self.owner)
        self.my_issue = Issue.objects.create(project=self.mine, workspace=self.ws, title="내 이슈",
                                             created_by=self.intruder)
        IssueComment.objects.create(issue=self.issue, actor=self.owner, comment_html="<p>비밀 댓글</p>")
        IssueActivity.objects.create(issue=self.issue, actor=self.owner, verb="created")
        IssueLink.objects.create(issue=self.issue, url="https://secret.example.com", created_by=self.owner)

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def url(self, project, issue, tail=""):
        return f"/api/workspaces/{project.workspace.slug}/projects/{project.id}/issues/{issue.id}/{tail}"

    def test_sub_resources_of_unreadable_issue_are_404(self):
        c = self.as_(self.intruder)
        for tail in ("comments/", "activities/", "links/", "sub-issues/", "attachments/", "attachments-tree/",
                     "node-links/"):
            with self.subTest(tail=tail):
                self.assertEqual(c.get(self.url(self.secret, self.issue, tail)).status_code, 404)
        self.assertEqual(c.post(self.url(self.secret, self.issue, "comments/"),
                                {"comment_html": "<p>x</p>"}, format="json").status_code, 404)
        self.assertEqual(c.post(self.url(self.secret, self.issue, "links/"),
                                {"url": "https://x.io"}, format="json").status_code, 404)
        self.assertEqual(IssueComment.objects.filter(issue=self.issue).count(), 1)

    def test_project_pk_mismatch_does_not_bypass(self):
        # 내가 멤버인 프로젝트 id 를 URL 에 넣고 남의 이슈 id 를 붙여도 안 된다
        c = self.as_(self.intruder)
        self.assertEqual(c.get(self.url(self.mine, self.issue, "comments/")).status_code, 404)

    def test_public_project_is_not_readable_from_other_workspace(self):
        c = self.as_(self.stranger)
        base = f"/api/workspaces/ws/projects/{self.public.id}/issues/"
        self.assertEqual(c.get(base).data, [])
        self.assertEqual(c.get(self.url(self.public, self.public_issue)).status_code, 404)
        self.assertEqual(c.get(self.url(self.public, self.public_issue, "comments/")).status_code, 404)
        search = c.get("/api/workspaces/ws/issues/search/?search=공개").data
        self.assertEqual(search["results"] if isinstance(search, dict) else search, [])

    def test_public_project_readable_by_workspace_member(self):
        c = self.as_(self.intruder)
        self.assertEqual(c.get(self.url(self.public, self.public_issue, "comments/")).status_code, 200)

    def test_cannot_create_issue_in_other_project_via_body(self):
        c = self.as_(self.intruder)
        r = c.post(f"/api/workspaces/ws/projects/{self.mine.id}/issues/",
                   {"title": "끼워넣기", "project": str(self.secret.id)}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(Issue.objects.filter(title="끼워넣기").exists())

    def test_cannot_move_issue_or_borrow_foreign_relations(self):
        c = self.as_(self.intruder)
        url = self.url(self.mine, self.my_issue)
        self.assertEqual(c.patch(url, {"project": str(self.secret.id)}, format="json").status_code, 400)
        self.assertEqual(c.patch(url, {"state": str(self.state.id)}, format="json").status_code, 400)
        self.assertEqual(c.patch(url, {"parent": str(self.issue.id)}, format="json").status_code, 400)
        self.my_issue.refresh_from_db()
        self.assertEqual((self.my_issue.project_id, self.my_issue.parent_id), (self.mine.id, None))

    def test_bulk_update_only_allows_known_fields(self):
        c = self.as_(self.intruder)
        url = f"/api/workspaces/ws/projects/{self.mine.id}/issues/bulk/"
        for updates in ({"project_id": str(self.secret.id)}, {"deleted_at": "2020-01-01T00:00:00Z"},
                        {"description_html": "<img src=x onerror=alert(1)>"}, {"state": str(self.state.id)}):
            with self.subTest(updates=updates):
                r = c.patch(url, {"issue_ids": [str(self.my_issue.id)], "updates": updates}, format="json")
                self.assertEqual(r.status_code, 400)
        r = c.patch(url, {"issue_ids": [str(self.my_issue.id)], "updates": {"priority": "high"}}, format="json")
        self.assertEqual(r.status_code, 200)
        self.my_issue.refresh_from_db()
        self.assertEqual((self.my_issue.project_id, self.my_issue.priority), (self.mine.id, "high"))

    def test_bulk_delete_cannot_reach_other_projects_children(self):
        c = self.as_(self.intruder)
        c.post(f"/api/workspaces/ws/projects/{self.mine.id}/issues/bulk-delete/",
               {"issue_ids": [str(self.issue.id)]}, format="json")
        self.child.refresh_from_db()
        self.issue.refresh_from_db()
        self.assertIsNone(self.child.deleted_at)
        self.assertIsNone(self.issue.deleted_at)

    def test_attachment_trash_needs_membership_and_permission(self):
        att = IssueAttachment.objects.create(issue=self.issue, uploaded_by=self.owner, filename="a.txt",
                                             size=1, file="x.txt", deleted_at="2026-01-01T00:00:00Z")
        c = self.as_(self.intruder)
        base = f"/api/workspaces/ws/projects/{self.secret.id}/attachments-trash/"
        self.assertEqual(c.get(base).data, [])
        self.assertEqual(c.post(f"{base}{att.id}/restore/").status_code, 403)
        self.assertEqual(c.delete(f"{base}{att.id}/hard-delete/").status_code, 403)
        self.assertTrue(IssueAttachment.objects.filter(pk=att.pk).exists())

    def test_graphs_hide_unreadable_issues(self):
        IssueNodeLink.objects.create(source=self.my_issue, target=self.issue, created_by=self.owner)
        Label.objects.create(project=self.secret, name="l", color="#000")
        c = self.as_(self.intruder)
        self.assertEqual(c.get(f"/api/workspaces/ws/projects/{self.secret.id}/node-graph/").status_code, 404)
        graph = c.get(f"/api/workspaces/ws/projects/{self.mine.id}/node-graph/").data
        self.assertNotIn("비밀 이슈", [n["title"] for n in graph["nodes"]])
        ws_graph = c.get("/api/workspaces/ws/node-graph/").data
        self.assertNotIn("비밀 이슈", [n["title"] for n in ws_graph["nodes"]])
        self.assertEqual(self.as_(self.stranger).get("/api/workspaces/ws/node-graph/").status_code, 404)
        links = c.get(self.url(self.mine, self.my_issue, "node-links/")).data
        self.assertEqual(links if isinstance(links, list) else links.get("results"), [])

    def test_node_link_cannot_target_unreadable_issue(self):
        c = self.as_(self.intruder)
        r = c.post(self.url(self.mine, self.my_issue, "node-links/"),
                   {"source": str(self.my_issue.id), "target": str(self.issue.id)}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_owner_still_works(self):
        c = self.as_(self.owner)
        self.assertEqual(c.get(self.url(self.secret, self.issue, "comments/")).status_code, 200)
        r = c.post(self.url(self.secret, self.issue, "sub-issues/"),
                   {"title": "새 하위", "project": str(self.secret.id)}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Issue.objects.get(title="새 하위").project_id, self.secret.id)


class IssueProjectResourceSecurityTests(IssueSecurityTests):
    """라벨·템플릿·요청·통계·이슈↔문서 연결 — 같은 픽스처를 쓰되 기존 테스트는 다시 돌지 않게 비운다."""

    def test_labels_and_templates(self):
        c = self.as_(self.intruder)
        base = f"/api/workspaces/ws/projects/{self.secret.id}/"
        self.assertEqual(c.get(base + "labels/").status_code, 404)
        self.assertEqual(c.post(base + "labels/", {"name": "x", "color": "#000"}, format="json").status_code, 404)
        self.assertEqual(c.get(base + "templates/").status_code, 404)
        self.assertEqual(c.post(base + "templates/", {"name": "t"}, format="json").status_code, 404)
        # 공개 프로젝트: 워크스페이스 멤버는 읽기만
        pub = f"/api/workspaces/ws/projects/{self.public.id}/"
        self.assertEqual(c.get(pub + "labels/").status_code, 200)
        self.assertEqual(c.post(pub + "labels/", {"name": "x", "color": "#000"}, format="json").status_code, 403)
        self.assertEqual(self.as_(self.stranger).get(pub + "labels/").status_code, 404)

    def test_requests_and_stats(self):
        c = self.as_(self.intruder)
        self.assertEqual(c.post(f"/api/workspaces/ws/projects/{self.secret.id}/requests/",
                                {"title": "x", "kind": "bug"}, format="json").status_code, 404)
        self.assertEqual(c.get(f"/api/workspaces/ws/projects/{self.secret.id}/issues/stats/").status_code, 404)

    def test_issue_document_links(self):
        c = self.as_(self.intruder)
        url = f"/api/workspaces/ws/projects/{self.mine.id}/issues/{self.issue.id}/documents/"
        self.assertEqual(c.get(url).status_code, 404)
        self.assertEqual(c.get(f"/api/workspaces/ws/projects/{self.secret.id}/issues/{self.issue.id}/documents/").status_code, 404)

    # 부모 클래스의 테스트는 여기서 다시 돌리지 않는다
    test_sub_resources_of_unreadable_issue_are_404 = None
    test_project_pk_mismatch_does_not_bypass = None
    test_public_project_is_not_readable_from_other_workspace = None
    test_public_project_readable_by_workspace_member = None
    test_cannot_create_issue_in_other_project_via_body = None
    test_cannot_move_issue_or_borrow_foreign_relations = None
    test_bulk_update_only_allows_known_fields = None
    test_bulk_delete_cannot_reach_other_projects_children = None
    test_attachment_trash_needs_membership_and_permission = None
    test_graphs_hide_unreadable_issues = None
    test_node_link_cannot_target_unreadable_issue = None
    test_owner_still_works = None
