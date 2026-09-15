"""이슈를 다른 프로젝트로 옮기기."""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.documents.models import DocumentIssueLink, DocumentSpace, Document
from apps.issues.models import Issue, IssueActivity, IssueComment, Label
from apps.projects.models import Category, Project, ProjectMember, Sprint, State
from apps.workspaces.models import Workspace, WorkspaceMember


def _user(email):
    return User.objects.create_user(email=email, password="pw-123456!", display_name=email.split("@")[0],
                                    is_active=True, is_approved=True, is_email_verified=True)


class IssueMoveTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.user = _user("u@x.io")
        WorkspaceMember.objects.create(workspace=self.ws, member=self.user, role=15)
        self.src = Project.objects.create(workspace=self.ws, name="원래", identifier="SRC")
        self.dst = Project.objects.create(workspace=self.ws, name="대상", identifier="DST")
        for p in (self.src, self.dst):
            State.objects.filter(project=p).delete()
            ProjectMember.objects.create(project=p, member=self.user, role=15)
        self.src_doing = State.objects.create(project=self.src, name="In Review", group="started", color="#000", sequence=1)
        self.src_todo = State.objects.create(project=self.src, name="Todo", group="unstarted", color="#000", sequence=2)
        self.dst_todo = State.objects.create(project=self.dst, name="할 일", group="unstarted", color="#000", sequence=1)
        self.dst_doing = State.objects.create(project=self.dst, name="진행 중", group="started", color="#000", sequence=2)
        self.dst_named = State.objects.create(project=self.dst, name="todo", group="backlog", color="#000", sequence=3)
        Issue.objects.create(project=self.dst, workspace=self.ws, title="기존", created_by=self.user)  # DST-1

        bug_src = Label.objects.create(project=self.src, name="Bug", color="#f00")
        only_src = Label.objects.create(project=self.src, name="원래만", color="#0f0")
        self.bug_dst = Label.objects.create(project=self.dst, name="bug", color="#f00")
        sprint = Sprint.objects.create(project=self.src, name="s", start_date="2026-09-01", end_date="2026-09-14")
        cat = Category.objects.create(project=self.src, name="c")

        self.grand = Issue.objects.create(project=self.src, workspace=self.ws, title="조상", created_by=self.user)
        self.issue = Issue.objects.create(project=self.src, workspace=self.ws, title="옮길 이슈", parent=self.grand,
                                          state=self.src_doing, sprint=sprint, created_by=self.user)
        self.issue.label.set([bug_src, only_src])
        self.issue.assignees.set([self.user])
        Issue.objects.filter(pk=self.issue.pk).update(category=cat)
        self.child = Issue.objects.create(project=self.src, workspace=self.ws, title="하위", parent=self.issue,
                                          state=self.src_todo, created_by=self.user)
        IssueComment.objects.create(issue=self.issue, actor=self.user, comment_html="<p>댓글</p>")
        space = DocumentSpace.objects.create(workspace=self.ws, name="위키", space_type="shared")
        DocumentIssueLink.objects.create(document=Document.objects.create(space=space, title="d"), issue=self.issue)

    def move(self, user=None, target=None):
        c = APIClient()
        c.force_authenticate(user or self.user)
        return c.post(f"/api/workspaces/ws/projects/{self.src.id}/issues/{self.issue.id}/move/",
                      {"target_project": str((target or self.dst).id)}, format="json")

    def test_moves_tree_and_remaps_values(self):
        r = self.move()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["moved_count"], 2)
        self.issue.refresh_from_db()
        self.child.refresh_from_db()
        self.assertEqual((self.issue.project_id, self.child.project_id), (self.dst.id, self.dst.id))
        self.assertEqual(self.issue.parent_id, None)           # 원래 프로젝트 상위와 연결 끊음
        self.assertEqual(self.child.parent_id, self.issue.id)  # 트리는 유지
        self.assertEqual(sorted([self.issue.sequence_id, self.child.sequence_id]), [2, 3])  # 대상에서 새 번호
        self.assertEqual(self.issue.state, self.dst_doing)     # 이름 없으면 같은 그룹
        self.assertEqual(self.child.state, self.dst_named)     # 같은 이름 우선(대소문자 무시)
        self.assertEqual([lb.pk for lb in self.issue.label.all()], [self.bug_dst.pk])
        self.assertEqual((self.issue.sprint_id, self.issue.category_id), (None, None))
        self.assertEqual(list(self.issue.assignees.all()), [self.user])
        self.assertEqual(self.issue.comments.count(), 1)
        self.assertTrue(DocumentIssueLink.objects.filter(issue=self.issue).exists())
        self.assertTrue(IssueActivity.objects.filter(issue=self.issue, field="project", new_value="대상").exists())
        self.grand.refresh_from_db()
        self.assertEqual(self.grand.project_id, self.src.id)

    def test_requires_edit_on_both_projects(self):
        ProjectMember.objects.filter(project=self.dst, member=self.user).update(can_edit=False)
        self.assertEqual(self.move().status_code, 403)
        self.issue.refresh_from_db()
        self.assertEqual(self.issue.project_id, self.src.id)

    def test_rejects_other_workspace_and_same_project(self):
        other = Workspace.objects.create(name="O", slug="o")
        foreign = Project.objects.create(workspace=other, name="F", identifier="FOR")
        self.assertEqual(self.move(target=foreign).status_code, 400)
        self.assertEqual(self.move(target=self.src).status_code, 400)

    def test_outsider_cannot_move(self):
        outsider = _user("o@x.io")
        WorkspaceMember.objects.create(workspace=self.ws, member=outsider, role=15)
        self.assertEqual(self.move(user=outsider).status_code, 404)
