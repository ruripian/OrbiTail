from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.documents.models import Document, DocumentSpace
from apps.issues.models import Issue, IssueActivity, IssueComment, Label
from apps.projects.models import Project, ProjectMember, State
from apps.workspaces.models import Workspace, WorkspaceMember

from .models import ApiToken


def _user(email):
    return User.objects.create_user(
        email=email, password="pw-123456!", display_name=email.split("@")[0],
        is_active=True, is_approved=True, is_email_verified=True,
    )


def _project(ws, identifier, network=Project.Network.SECRET):
    project = Project.objects.create(workspace=ws, name=identifier, identifier=identifier, network=network)
    State.objects.filter(project=project).delete()
    State.objects.create(project=project, name="Backlog", group="backlog", color="#999", sequence=1)
    State.objects.create(project=project, name="Todo", group="unstarted", color="#aaa", sequence=2)
    State.objects.create(project=project, name="Done", group="completed", color="#0a0", sequence=3)
    return project


class V1TestBase(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.other_ws = Workspace.objects.create(name="Other", slug="other")
        self.me = _user("me@x.io")
        self.teammate = _user("mate@x.io")
        self.outsider = _user("out@x.io")
        for u in (self.me, self.teammate):
            WorkspaceMember.objects.create(workspace=self.ws, member=u, role=WorkspaceMember.Role.MEMBER)

        self.proj = _project(self.ws, "OUR")                                    # 내가 멤버
        self.secret = _project(self.ws, "SEC")                                  # 비공개, 내가 멤버 아님
        self.public = _project(self.ws, "PUB", network=Project.Network.PUBLIC)  # 공개, 멤버 아님
        self.foreign = _project(self.other_ws, "FOR")                           # 다른 워크스페이스
        ProjectMember.objects.create(project=self.proj, member=self.me, role=ProjectMember.Role.MEMBER)
        ProjectMember.objects.create(project=self.proj, member=self.teammate, role=ProjectMember.Role.MEMBER)
        ProjectMember.objects.create(project=self.secret, member=self.teammate, role=ProjectMember.Role.MEMBER)

        self.todo = State.objects.get(project=self.proj, group="unstarted")
        self.done = State.objects.get(project=self.proj, group="completed")
        self.label = Label.objects.create(project=self.proj, name="bug", color="#f00")
        self.foreign_label = Label.objects.create(project=self.public, name="other", color="#0f0")

        _, self.read_raw = ApiToken.issue(workspace=self.ws, user=self.me, name="r", scope="read")
        _, self.write_raw = ApiToken.issue(workspace=self.ws, user=self.me, name="w", scope="write")

    def client_for(self, raw):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
        return c

    @property
    def r(self):
        return self.client_for(self.read_raw)

    @property
    def w(self):
        return self.client_for(self.write_raw)

    def make_issue(self, project=None, **kw):
        project = project or self.proj
        return Issue.objects.create(
            project=project, workspace=project.workspace, title=kw.pop("title", "이슈"),
            state=kw.pop("state", State.objects.filter(project=project).first()), created_by=self.me, **kw,
        )


class ProjectTests(V1TestBase):
    def test_lists_only_readable_projects_in_token_workspace(self):
        r = self.r.get("/api/v1/projects/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(sorted(p["identifier"] for p in r.data["results"]), ["OUR", "PUB"])

    def test_secret_and_foreign_projects_are_404(self):
        self.assertEqual(self.r.get(f"/api/v1/projects/{self.secret.id}/").status_code, 404)
        self.assertEqual(self.r.get(f"/api/v1/projects/{self.foreign.id}/").status_code, 404)
        self.assertEqual(self.r.get("/api/v1/projects/not-a-uuid/").status_code, 404)

    def test_sub_resources(self):
        states = self.r.get(f"/api/v1/projects/{self.proj.id}/states/").data
        self.assertEqual([st["group"] for st in states], ["backlog", "unstarted", "completed"])
        self.assertEqual([lb["name"] for lb in self.r.get(f"/api/v1/projects/{self.proj.id}/labels/").data], ["bug"])
        members = self.r.get(f"/api/v1/projects/{self.proj.id}/members/").data
        self.assertEqual(sorted(m["user"]["email"] for m in members), ["mate@x.io", "me@x.io"])


class IssueReadTests(V1TestBase):
    def test_list_excludes_unreadable_and_deleted(self):
        self.make_issue(title="mine")
        self.make_issue(project=self.public, title="public")
        self.make_issue(project=self.secret, title="secret")
        self.make_issue(project=self.foreign, title="foreign")
        self.make_issue(title="trashed", deleted_at=timezone.now())
        titles = sorted(i["title"] for i in self.r.get("/api/v1/issues/").data["results"])
        self.assertEqual(titles, ["mine", "public"])

    def test_get_by_identifier_and_id(self):
        issue = self.make_issue(title="찾기")
        by_ref = self.r.get(f"/api/v1/issues/OUR-{issue.sequence_id}/")
        self.assertEqual(by_ref.status_code, 200)
        self.assertEqual(by_ref.data["id"], str(issue.id))
        self.assertEqual(by_ref.data["identifier"], f"OUR-{issue.sequence_id}")
        self.assertEqual(self.r.get(f"/api/v1/issues/our-{issue.sequence_id}/").status_code, 200)
        self.assertEqual(self.r.get(f"/api/v1/issues/{issue.id}/").status_code, 200)
        secret = self.make_issue(project=self.secret)
        self.assertEqual(self.r.get(f"/api/v1/issues/SEC-{secret.sequence_id}/").status_code, 404)

    def test_filters(self):
        a = self.make_issue(title="a", state=self.todo)
        a.assignees.set([self.me])
        b = self.make_issue(title="b", state=self.done)
        child = self.make_issue(title="child", parent=b)
        Issue.objects.filter(pk=b.pk).update(updated_at=timezone.now() - timedelta(days=3))

        def titles(q):
            r = self.r.get(f"/api/v1/issues/?{q}")
            self.assertEqual(r.status_code, 200, r.data)
            return sorted(i["title"] for i in r.data["results"])

        self.assertEqual(titles("assignee=me"), ["a"])
        self.assertEqual(titles("state_group=completed"), ["b"])
        self.assertEqual(titles(f"parent={b.id}"), ["child"])
        self.assertEqual(titles(f"project={self.proj.id}&parent=none"), ["a", "b"])
        since = (timezone.now() - timedelta(days=1)).isoformat()
        self.assertNotIn("b", titles("updated_since=" + since.replace("+", "%2B")))
        self.assertEqual(self.r.get("/api/v1/issues/?ordering=title").status_code, 400)
        self.assertEqual(self.r.get("/api/v1/issues/?updated_since=yesterday").status_code, 400)
        self.assertEqual(child.parent_id, b.id)

    def test_pagination(self):
        for i in range(3):
            self.make_issue(title=f"p{i}")
        r = self.r.get("/api/v1/issues/?page_size=2")
        self.assertEqual(r.data["count"], 3)
        self.assertEqual(len(r.data["results"]), 2)
        self.assertIsNotNone(r.data["next"])


class IssueWriteTests(V1TestBase):
    def test_create_with_defaults_and_markdown(self):
        r = self.w.post("/api/v1/issues/", {
            "project": str(self.proj.id), "title": "새 이슈",
            "description": "**굵게** <script>x</script> [나쁜](javascript:alert(1))",
            "labels": [str(self.label.id)], "assignees": [str(self.teammate.id)], "priority": "high",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["state"]["group"], "unstarted")  # 기본 상태
        self.assertEqual(r.data["labels"][0]["name"], "bug")
        issue = Issue.objects.get(pk=r.data["id"])
        self.assertIn("<strong>굵게</strong>", issue.description_html)
        self.assertNotIn("<script>", issue.description_html)
        self.assertNotIn("javascript:", issue.description_html.replace("[나쁜](javascript:alert(1))", ""))
        self.assertTrue(IssueActivity.objects.filter(issue=issue, verb="created").exists())

    def test_read_token_cannot_create(self):
        r = self.r.post("/api/v1/issues/", {"project": str(self.proj.id), "title": "x"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_cannot_create_in_public_project_as_non_member_or_in_secret(self):
        r = self.w.post("/api/v1/issues/", {"project": str(self.public.id), "title": "x"}, format="json")
        self.assertEqual(r.status_code, 403)
        r = self.w.post("/api/v1/issues/", {"project": str(self.secret.id), "title": "x"}, format="json")
        self.assertEqual(r.status_code, 404)

    def test_viewer_cannot_create(self):
        ProjectMember.objects.filter(project=self.proj, member=self.me).update(role=ProjectMember.Role.VIEWER)
        r = self.w.post("/api/v1/issues/", {"project": str(self.proj.id), "title": "x"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_rejects_relations_from_other_project_or_outsiders(self):
        base = {"project": str(self.proj.id), "title": "x"}
        self.assertEqual(self.w.post("/api/v1/issues/", {**base, "labels": [str(self.foreign_label.id)]},
                                     format="json").status_code, 400)
        other_state = State.objects.filter(project=self.public).first()
        self.assertEqual(self.w.post("/api/v1/issues/", {**base, "state": str(other_state.id)},
                                     format="json").status_code, 400)
        self.assertEqual(self.w.post("/api/v1/issues/", {**base, "assignees": [str(self.outsider.id)]},
                                     format="json").status_code, 400)
        self.assertEqual(Issue.objects.filter(project=self.proj).count(), 0)

    def test_patch_updates_only_sent_fields_and_logs_activity(self):
        issue = self.make_issue(title="원래", state=self.todo, priority="low")
        r = self.w.patch(f"/api/v1/issues/OUR-{issue.sequence_id}/", {"state": str(self.done.id)}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        issue.refresh_from_db()
        self.assertEqual(issue.state, self.done)
        self.assertEqual(issue.title, "원래")
        self.assertEqual(issue.priority, "low")
        self.assertTrue(IssueActivity.objects.filter(issue=issue, field="state", new_value="Done").exists())

    def test_patch_rejects_cycles_and_project_move(self):
        parent = self.make_issue(title="parent")
        child = self.make_issue(title="child", parent=parent)
        r = self.w.patch(f"/api/v1/issues/{parent.id}/", {"parent": str(child.id)}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.w.patch(f"/api/v1/issues/{parent.id}/", {"project": str(self.public.id)}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_delete_moves_tree_to_trash(self):
        parent = self.make_issue(title="parent")
        child = self.make_issue(title="child", parent=parent)
        self.assertEqual(self.w.delete(f"/api/v1/issues/{parent.id}/").status_code, 204)
        parent.refresh_from_db()
        child.refresh_from_db()
        self.assertIsNotNone(parent.deleted_at)
        self.assertIsNotNone(child.deleted_at)
        self.assertEqual(self.r.get(f"/api/v1/issues/{parent.id}/").status_code, 404)

    def test_comments(self):
        issue = self.make_issue()
        r = self.w.post(f"/api/v1/issues/{issue.id}/comments/", {"body": "확인 <b>함</b>"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        comment = IssueComment.objects.get(pk=r.data["id"])
        self.assertNotIn("<b>", comment.comment_html)
        reply = self.w.post(f"/api/v1/issues/{issue.id}/comments/",
                            {"body": "답", "parent": str(comment.id)}, format="json")
        self.assertEqual(reply.data["parent"], str(comment.id))
        listed = self.r.get(f"/api/v1/issues/{issue.id}/comments/").data
        self.assertEqual(listed["count"], 2)
        secret_issue = self.make_issue(project=self.secret)
        self.assertEqual(self.w.post(f"/api/v1/issues/{secret_issue.id}/comments/", {"body": "x"},
                                     format="json").status_code, 404)


class DocumentReadTests(V1TestBase):
    def setUp(self):
        super().setUp()
        self.open_space = DocumentSpace.objects.create(workspace=self.ws, name="위키", space_type="shared")
        self.closed_space = DocumentSpace.objects.create(
            workspace=self.ws, name="비밀", space_type="shared", is_private=True,
        )
        self.doc = Document.objects.create(
            space=self.open_space, title="회의록", content_html="<h2>안건</h2><p><strong>결정</strong></p>",
            created_by=self.me,
        )
        self.hidden = Document.objects.create(space=self.closed_space, title="숨김", content_html="<p>x</p>")

    def test_spaces_and_documents(self):
        names = [sp["name"] for sp in self.r.get("/api/v1/spaces/").data]
        self.assertIn("위키", names)
        self.assertNotIn("비밀", names)
        listed = self.r.get(f"/api/v1/spaces/{self.open_space.id}/documents/").data["results"]
        self.assertEqual([d["title"] for d in listed], ["회의록"])
        self.assertEqual(self.r.get(f"/api/v1/spaces/{self.closed_space.id}/documents/").status_code, 404)

    def test_document_as_markdown(self):
        r = self.r.get(f"/api/v1/documents/{self.doc.id}/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("## 안건", r.data["content"])
        self.assertIn("**결정**", r.data["content"])
        self.assertEqual(self.r.get(f"/api/v1/documents/{self.hidden.id}/").status_code, 404)


class DocumentWriteTests(V1TestBase):
    def setUp(self):
        super().setUp()
        self.space = DocumentSpace.objects.create(workspace=self.ws, name="위키", space_type="shared")
        self.closed = DocumentSpace.objects.create(workspace=self.ws, name="비밀", space_type="shared", is_private=True)
        self.doc = Document.objects.create(space=self.space, title="회의록", content_html="<p>처음</p>")

    def test_create_with_markdown_and_wikilink(self):
        target = Document.objects.create(space=self.space, title="배포 절차", content_html="")
        r = self.w.post(f"/api/v1/spaces/{self.space.id}/documents/", {
            "title": "새 문서", "content": "[[배포 절차]] 참고\n\n<script>x</script>", "properties": {"상태": "초안"},
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        doc = Document.objects.get(pk=r.data["id"])
        self.assertIn(f'data-id="{target.id}"', doc.content_html)
        self.assertNotIn("<script>", doc.content_html)
        self.assertEqual(doc.properties, {"상태": "초안"})
        self.assertEqual(doc.created_by, self.me)
        self.assertTrue(doc.outgoing_links.filter(target=target).exists())

    def test_create_requires_write_token_edit_right_and_access(self):
        url = f"/api/v1/spaces/{self.space.id}/documents/"
        self.assertEqual(self.r.post(url, {"title": "x"}, format="json").status_code, 403)
        self.assertEqual(self.w.post(f"/api/v1/spaces/{self.closed.id}/documents/", {"title": "x"},
                                     format="json").status_code, 404)
        other = Document.objects.create(space=self.closed, title="남의 폴더", is_folder=True)
        self.assertEqual(self.w.post(url, {"title": "x", "parent": str(other.id)}, format="json").status_code, 400)
        self.assertEqual(self.w.post(url, {"title": "x", "is_folder": True, "content": "본문"},
                                     format="json").status_code, 400)

    def test_patch_metadata_and_reject_cycle(self):
        folder = Document.objects.create(space=self.space, title="폴더", is_folder=True)
        sub = Document.objects.create(space=self.space, title="하위", is_folder=True, parent=folder)
        r = self.w.patch(f"/api/v1/documents/{self.doc.id}/",
                         {"title": "고친 제목", "parent": str(folder.id)}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.doc.refresh_from_db()
        self.assertEqual((self.doc.title, self.doc.parent_id), ("고친 제목", folder.id))
        self.assertEqual(self.doc.content_html, "<p>처음</p>")  # 본문은 건드리지 않는다
        r = self.w.patch(f"/api/v1/documents/{folder.id}/", {"parent": str(sub.id)}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_content_goes_through_collab_server(self):
        from unittest import mock

        with mock.patch("apps.api.v1.views.write_document_content", return_value="<p>새 본문</p>") as write:
            r = self.w.put(f"/api/v1/documents/{self.doc.id}/content/", {"content": "새 **본문**"}, format="json")
            self.assertEqual(r.status_code, 200, r.data)
            doc_id, html, mode = write.call_args.args
            self.assertEqual((str(doc_id), mode), (str(self.doc.id), "replace"))
            self.assertIn("<strong>본문</strong>", html)
            self.assertEqual(r.data["content"].strip(), "새 본문")

            self.w.post(f"/api/v1/documents/{self.doc.id}/append/", {"content": "끝"}, format="json")
            self.assertEqual(write.call_args.args[2], "append")
        # DB 의 본문은 이 경로에서 직접 쓰지 않는다 — 협업 서버의 저장이 쓴다
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.content_html, "<p>처음</p>")

    def test_collab_down_is_503_and_nothing_written(self):
        from unittest import mock

        from .v1.collab_client import CollabUnavailable

        with mock.patch("apps.api.v1.views.write_document_content", side_effect=CollabUnavailable("down")):
            r = self.w.put(f"/api/v1/documents/{self.doc.id}/content/", {"content": "x"}, format="json")
        self.assertEqual(r.status_code, 503)
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.content_html, "<p>처음</p>")

    def test_read_token_cannot_write_content(self):
        self.assertEqual(self.r.put(f"/api/v1/documents/{self.doc.id}/content/", {"content": "x"},
                                    format="json").status_code, 403)

    def test_delete_moves_subtree_to_trash(self):
        folder = Document.objects.create(space=self.space, title="폴더", is_folder=True)
        child = Document.objects.create(space=self.space, title="하위", parent=folder)
        self.assertEqual(self.w.delete(f"/api/v1/documents/{folder.id}/").status_code, 204)
        child.refresh_from_db()
        self.assertIsNotNone(child.deleted_at)
        self.assertEqual(child.deleted_by, self.me)
