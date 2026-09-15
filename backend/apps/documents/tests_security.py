"""문서 스페이스·문서·딸린 자원의 권한 경계."""
import io
import zipfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.documents.links import sync_document_links
from apps.documents.models import (
    CommentThread, Document, DocumentAttachment, DocumentComment, DocumentLabel, DocumentSpace,
    DocumentSpaceMember, DocumentTemplate, DocumentVersion,
)
from apps.issues.models import Issue
from apps.projects.models import Project, ProjectMember
from apps.workspaces.models import Workspace, WorkspaceMember


def _user(email):
    return User.objects.create_user(email=email, password="pw-123456!", display_name=email.split("@")[0],
                                    is_active=True, is_approved=True, is_email_verified=True)


def rows(data):
    return data["results"] if isinstance(data, dict) else data


class DocumentSecurityTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.other_ws = Workspace.objects.create(name="Other", slug="other")
        self.owner = _user("owner@x.io")
        self.member = _user("member@x.io")     # 같은 워크스페이스, 비공개 스페이스 멤버 아님
        self.viewer = _user("viewer@x.io")     # 비공개 스페이스 VIEWER
        self.stranger = _user("str@x.io")      # 다른 워크스페이스
        for u in (self.owner, self.member, self.viewer):
            WorkspaceMember.objects.create(workspace=self.ws, member=u, role=15)
        WorkspaceMember.objects.create(workspace=self.other_ws, member=self.stranger, role=25)

        self.private = DocumentSpace.objects.create(workspace=self.ws, name="비밀", space_type="shared", is_private=True)
        DocumentSpaceMember.objects.create(space=self.private, member=self.owner, role=DocumentSpaceMember.Role.ADMIN)
        DocumentSpaceMember.objects.create(space=self.private, member=self.viewer, role=DocumentSpaceMember.Role.VIEWER)
        self.open = DocumentSpace.objects.create(workspace=self.ws, name="위키", space_type="shared")
        self.doc = Document.objects.create(space=self.private, title="비밀 문서", content_html="<p>비밀</p>",
                                           created_by=self.owner)
        DocumentVersion.objects.create(document=self.doc, version_number=1, title="v", content_html="<p>옛 비밀</p>",
                                       created_by=self.owner)
        self.thread = CommentThread.objects.create(document=self.doc, created_by=None, anchor_text="x")
        DocumentComment.objects.create(document=self.doc, thread=self.thread, author=self.owner, content="비밀 댓글")

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def durl(self, doc, tail=""):
        return f"/api/workspaces/{doc.space.workspace.slug}/documents/spaces/{doc.space_id}/docs/{doc.id}/{tail}"

    def test_document_read_and_delete_need_access(self):
        c = self.as_(self.member)
        self.assertEqual(c.get(self.durl(self.doc)).status_code, 404)
        self.assertEqual(c.delete(self.durl(self.doc)).status_code, 404)
        self.doc.refresh_from_db()
        self.assertIsNone(self.doc.deleted_at)
        self.assertEqual(self.as_(self.viewer).get(self.durl(self.doc)).status_code, 200)
        self.assertEqual(self.as_(self.viewer).delete(self.durl(self.doc)).status_code, 403)

    def test_attached_resources_need_access(self):
        c = self.as_(self.member)
        for tail in ("versions/", "comments/", "threads/", "attachments/", "issues/"):
            with self.subTest(tail=tail):
                self.assertEqual(c.get(self.durl(self.doc, tail)).status_code, 404)
        self.assertEqual(c.post(self.durl(self.doc, "comments/"), {"content": "x"}, format="json").status_code, 404)
        self.assertEqual(c.post(self.durl(self.doc, "threads/"), {"anchor_text": "a", "initial_content": "x"},
                                format="json").status_code, 404)
        self.assertEqual(c.post(self.durl(self.doc, f"threads/{self.thread.id}/resolve/")).status_code, 404)
        self.assertEqual(c.delete(self.durl(self.doc, f"threads/{self.thread.id}/")).status_code, 404)
        self.assertEqual(c.post(self.durl(self.doc, "versions/"), {}, format="json").status_code, 404)
        self.thread.refresh_from_db()
        self.assertFalse(self.thread.resolved)
        self.assertEqual(DocumentVersion.objects.filter(document=self.doc).count(), 1)

    def test_viewer_cannot_upload_or_snapshot_and_orphan_thread_needs_edit(self):
        c = self.as_(self.viewer)
        f = SimpleUploadedFile("a.txt", b"hi", content_type="text/plain")
        self.assertEqual(c.post(self.durl(self.doc, "attachments/"), {"file": f}).status_code, 403)
        self.assertEqual(c.post(self.durl(self.doc, "versions/"), {}, format="json").status_code, 403)
        self.assertEqual(c.delete(self.durl(self.doc, f"threads/{self.thread.id}/")).status_code, 403)
        self.assertEqual(DocumentAttachment.objects.count(), 0)

    def test_collab_auth_denies_without_access(self):
        self.assertEqual(self.as_(self.member).get(f"/api/internal/collab/documents/{self.doc.id}/auth/").status_code, 403)
        r = self.as_(self.viewer).get(f"/api/internal/collab/documents/{self.doc.id}/auth/")
        self.assertEqual((r.status_code, r.data["can_edit"]), (200, False))

    def test_other_workspace_cannot_see_public_spaces_or_search(self):
        Document.objects.create(space=self.open, title="공개 위키 문서", content_html="<p>검색어</p>")
        c = self.as_(self.stranger)
        self.assertEqual(rows(c.get("/api/workspaces/ws/documents/spaces/").data), [])
        self.assertEqual(rows(c.get("/api/workspaces/ws/documents/search/?q=검색어").data), [])
        self.assertEqual(c.post("/api/workspaces/ws/documents/spaces/", {"name": "끼워넣기"}, format="json").status_code, 403)
        self.assertEqual(rows(c.get("/api/workspaces/ws/documents/labels/").data), [])

    def test_issue_link_requires_readable_issue(self):
        project = Project.objects.create(workspace=self.ws, name="S", identifier="SEC")
        ProjectMember.objects.create(project=project, member=self.owner, role=20)
        secret_issue = Issue.objects.create(project=project, workspace=self.ws, title="비밀 이슈", created_by=self.owner)
        mine = Document.objects.create(space=self.open, title="내 문서")
        r = self.as_(self.member).post(self.durl(mine, "issues/"), {"issue": str(secret_issue.id)}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_parent_and_labels_must_stay_in_scope(self):
        mine = Document.objects.create(space=self.open, title="내 문서")
        foreign_label = DocumentLabel.objects.create(workspace=self.other_ws, name="남의 라벨")
        c = self.as_(self.member)
        self.assertEqual(c.patch(self.durl(mine), {"parent": str(self.doc.id)}, format="json").status_code, 400)
        self.assertEqual(c.patch(self.durl(mine), {"labels": [str(foreign_label.id)]}, format="json").status_code, 400)
        self.assertEqual(c.post(self.durl(mine, "move/"), {"parent": str(self.doc.id)}, format="json").status_code, 400)

    def test_templates_of_private_space_hidden(self):
        DocumentTemplate.objects.create(scope=DocumentTemplate.Scope.SPACE, workspace=self.ws, space=self.private,
                                        name="비밀 템플릿", content_html="<p>x</p>")
        c = self.as_(self.member)
        names = [t["name"] for t in rows(c.get(f"/api/workspaces/ws/documents/templates/?space={self.private.id}").data)]
        self.assertNotIn("비밀 템플릿", names)

    def test_links_to_other_workspace_are_dropped(self):
        foreign_space = DocumentSpace.objects.create(workspace=self.other_ws, name="f", space_type="shared")
        foreign = Document.objects.create(space=foreign_space, title="남의 문서")
        mine = Document.objects.create(
            space=self.open, title="내 문서",
            content_html=f'<span data-mention="" data-kind="doc" data-id="{foreign.id}">x</span>',
        )
        sync_document_links(mine)
        self.assertFalse(mine.outgoing_links.exists())

    def test_zip_bomb_rejected(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("big.md", "a" * (40 * 1024 * 1024))
        upload = SimpleUploadedFile("vault.zip", buf.getvalue(), content_type="application/zip")
        r = self.as_(self.member).post(f"/api/workspaces/ws/documents/spaces/{self.open.id}/import/", {"file": upload})
        self.assertEqual(r.status_code, 400)


class WorkspaceAdminPrivateSpaceTests(TestCase):
    """비공개 스페이스는 관리자에게도 문서 화면에서 숨기고, 워크스페이스 설정에서만 관리한다."""

    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.owner = _user("owner@x.io")
        self.admin = _user("admin@x.io")
        self.superuser = _user("root@x.io")
        User.objects.filter(pk=self.superuser.pk).update(is_superuser=True, is_staff=True)
        self.superuser.refresh_from_db()
        WorkspaceMember.objects.create(workspace=self.ws, member=self.owner, role=15)
        WorkspaceMember.objects.create(workspace=self.ws, member=self.admin, role=25)
        WorkspaceMember.objects.create(workspace=self.ws, member=self.superuser, role=15)
        self.private = DocumentSpace.objects.create(workspace=self.ws, name="비밀", space_type="shared", is_private=True)
        DocumentSpaceMember.objects.create(space=self.private, member=self.owner, role=DocumentSpaceMember.Role.ADMIN)
        self.doc = Document.objects.create(space=self.private, title="비밀 문서", content_html="<p>내용</p>")
        self.personal = DocumentSpace.objects.create(workspace=self.ws, name="남의 개인", space_type="personal",
                                                     owner=self.owner)
        self.personal_doc = Document.objects.create(space=self.personal, title="개인 문서")

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def test_admin_and_superuser_do_not_see_private_or_personal_in_documents(self):
        for user in (self.admin, self.superuser):
            c = self.as_(user)
            with self.subTest(user=user.email):
                names = [s["name"] for s in rows(c.get("/api/workspaces/ws/documents/spaces/").data)]
                self.assertNotIn("비밀", names)
                self.assertNotIn("남의 개인", names)
                self.assertEqual(rows(c.get("/api/workspaces/ws/documents/search/?q=비밀").data), [])
                self.assertEqual(c.get(f"/api/workspaces/ws/documents/spaces/{self.private.id}/docs/{self.doc.id}/").status_code, 404)
                self.assertEqual(c.get(f"/api/workspaces/ws/documents/spaces/{self.personal.id}/docs/{self.personal_doc.id}/").status_code, 404)

    def test_workspace_settings_lists_and_manages_without_content(self):
        c = self.as_(self.admin)
        listed = c.get("/api/workspaces/ws/documents/admin/spaces/").data
        row = next(r for r in listed if r["name"] == "비밀")
        self.assertEqual((row["is_private"], row["document_count"], row["i_am_member"]), (True, 1, False))
        self.assertNotIn("남의 개인", [r["name"] for r in listed])
        self.assertNotIn("content_html", str(listed))

        # 자신을 멤버로 추가해야 비로소 연다
        r = c.post(f"/api/workspaces/ws/documents/admin/spaces/{self.private.id}/members/",
                   {"member": str(self.admin.id), "role": DocumentSpaceMember.Role.VIEWER}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(c.get(f"/api/workspaces/ws/documents/spaces/{self.private.id}/docs/{self.doc.id}/").status_code, 200)

        self.assertEqual(c.patch(f"/api/workspaces/ws/documents/admin/spaces/{self.private.id}/", {"is_private": False},
                                 format="json").status_code, 200)
        self.private.refresh_from_db()
        self.assertFalse(self.private.is_private)

    def test_non_admin_cannot_use_workspace_space_admin(self):
        c = self.as_(self.owner)
        self.assertEqual(c.get("/api/workspaces/ws/documents/admin/spaces/").status_code, 403)
        self.assertEqual(c.delete(f"/api/workspaces/ws/documents/admin/spaces/{self.private.id}/").status_code, 403)
        self.assertEqual(c.get(f"/api/workspaces/ws/documents/admin/spaces/{self.personal.id}/members/").status_code, 404)
