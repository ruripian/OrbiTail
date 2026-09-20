from html.parser import HTMLParser
from pathlib import Path

from django.test import SimpleTestCase, TestCase

from apps.documents.markdown import html_to_markdown, markdown_to_html

from .html_sanitize import sanitize_html


def _shape(html):
    """태그·속성(정렬)·글자만 뽑는다 — 속성 순서나 따옴표 같은 직렬화 차이는 무시."""
    out = []

    class P(HTMLParser):
        def handle_starttag(self, tag, attrs):
            out.append(("start", tag, tuple(sorted((k, v or "") for k, v in attrs))))

        def handle_endtag(self, tag):
            out.append(("end", tag))

        def handle_data(self, data):
            if data.strip():
                out.append(("text", data))

    P(convert_charrefs=True).feed(html)
    return out


class SanitizeTests(SimpleTestCase):
    def test_editor_schema_output_passes_unchanged(self):
        # 에디터 스키마의 모든 노드·마크를 한 번씩 렌더한 샘플. 여기서 무엇이든 사라지면 저장 때마다 서식이 지워진다.
        sample = (Path(__file__).parent / "schema_sample.html").read_text()
        self.assertEqual(_shape(sanitize_html(sample)), _shape(sample))

    def test_markdown_import_output_passes_unchanged(self):
        md = ("# 제목\n\n**굵게** *기울임* `코드` [링크](https://a.io) ~~취소~~ ==강조==\n\n"
              "> [!warning] 주의\n> 내용\n\n- [ ] 할 일\n- 항목\n\n1. 하나\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n"
              "$x^2$\n\n```mermaid\ngraph TD\n```\n\n![그림](https://a.io/p.png)")
        html = markdown_to_html(md)
        self.assertEqual(_shape(sanitize_html(html)), _shape(html))

    def test_task_list_matches_editor_schema(self):
        """할 일 목록은 에디터가 찍는 모양과 같아야 한다.

        `data-type="taskItem"` 이 빠지면 TipTap 이 li 를 할 일 항목으로 못 읽어서, 열었을 때
        빈 체크박스 하나와 글자만 든 별개 불릿으로 쪼개진다.
        """
        html = markdown_to_html("- [ ] 할 일\n- [x] 끝난 일")
        self.assertIn('<ul data-type="taskList">', html)
        self.assertEqual(html.count('data-type="taskItem"'), 2)
        self.assertIn('data-checked="false"', html)
        self.assertIn('data-checked="true"', html)
        # 체크 상태까지 되돌아와야 한다
        self.assertEqual(html_to_markdown(html).strip(), "- [ ] 할 일\n- [x] 끝난 일")

    def test_pasted_image_data_uri_kept(self):
        html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="p">'
        self.assertIn("data:image/png", sanitize_html(html))

    def test_strips_script_vectors(self):
        cases = [
            "<img src=x onerror=alert(1)>",
            "<script>alert(1)</script>",
            '<a href="javascript:alert(1)">x</a>',
            '<a href=" JaVa\tscript:alert(1)">x</a>',
            '<iframe src="javascript:alert(1)"></iframe>',
            '<iframe src="/api/admin/users/"></iframe>',
            '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
            '<a href="data:text/html,<script>alert(1)</script>">x</a>',
            '<img src="data:image/svg+xml,<svg onload=alert(1)>">',
            "<svg><animate onbegin=alert(1)></svg>",
            "<math><mtext><script>alert(1)</script></mtext></math>",
            '<div style="x" onclick="alert(1)">x</div>',
            '<input type="text" autofocus onfocus="alert(1)">',
            '<form action="https://evil"><button>x</button></form>',
            '<object data="x"></object><embed src="x">',
            '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
        ]
        for html in cases:
            with self.subTest(html=html):
                out = sanitize_html(html).lower()
                for bad in ("onerror", "onload", "onclick", "onfocus", "onbegin", "<script", "javascript:",
                            "srcdoc", "<svg", "<form", "<object", "<embed", "<meta", "text/html", "/api/admin"):
                    self.assertNotIn(bad, out)


class StoredHtmlIsSanitizedTests(TestCase):
    """API 로 들어온 HTML 이 저장될 때 정리되는가 — 뷰가 아니라 모델 저장 단계에서."""

    def test_comment_and_document_html(self):
        from rest_framework.test import APIClient

        from apps.accounts.models import User
        from apps.documents.models import Document, DocumentSpace
        from apps.issues.models import Issue, IssueComment
        from apps.projects.models import Project, ProjectMember
        from apps.workspaces.models import Workspace, WorkspaceMember

        ws = Workspace.objects.create(name="WS", slug="ws")
        user = User.objects.create_user(email="a@x.io", password="pw-123456!", display_name="a", is_active=True)
        WorkspaceMember.objects.create(workspace=ws, member=user, role=15)
        project = Project.objects.create(workspace=ws, name="P", identifier="P")
        ProjectMember.objects.create(project=project, member=user, role=20)
        issue = Issue.objects.create(project=project, workspace=ws, title="t", created_by=user)
        space = DocumentSpace.objects.create(workspace=ws, name="s", space_type="shared")
        doc = Document.objects.create(space=space, title="d")

        c = APIClient()
        c.force_authenticate(user)
        payload = '<p>안녕</p><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>'
        r = c.post(f"/api/workspaces/ws/projects/{project.id}/issues/{issue.id}/comments/",
                   {"comment_html": payload}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        stored = IssueComment.objects.get(pk=r.data["id"]).comment_html
        self.assertIn("<p>안녕</p>", stored)
        self.assertNotIn("onerror", stored)
        self.assertNotIn("javascript:", stored)

        r = c.patch(f"/api/workspaces/ws/documents/spaces/{space.id}/docs/{doc.id}/", {"content_html": payload},
                    format="json")
        self.assertEqual(r.status_code, 200, r.data)
        doc.refresh_from_db()
        self.assertNotIn("onerror", doc.content_html)
