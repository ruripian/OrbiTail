"""백엔드 문장의 언어 — 요청은 요청 언어로, 메일·알림은 받는 사람 언어로.

원문은 코드의 영어, 한국어는 locale/ko/LC_MESSAGES/django.po. 이 테스트는 .mo 가
컴파일돼 있어야 한다(entrypoint·CI 가 compilemessages 를 돌린다).
"""
import ast
import re
from pathlib import Path

from django.conf import settings
from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.issues.models import Issue
from apps.notifications.models import Notification
from apps.projects.models import Project, ProjectMember, State
from apps.workspaces.models import Workspace, WorkspaceMember

HANGUL = re.compile(r"[가-힣]")
PLACEHOLDER = re.compile(r"%\((\w+)\)s")
BAD_INVITE = "/api/invitations/00000000-0000-0000-0000-000000000000/"


def _user(email, language="en"):
    return User.objects.create_user(email=email, password="pw-123456!", display_name=email.split("@")[0],
                                    is_active=True, is_approved=True, is_email_verified=True,
                                    language=language)


class RequestLanguageTests(TestCase):
    def detail(self, accept_language):
        return APIClient().get(BAD_INVITE, HTTP_ACCEPT_LANGUAGE=accept_language).data["detail"]

    def test_영어_요청은_영어(self):
        self.assertEqual(self.detail("en"), "This invitation link is not valid.")

    def test_한국어_요청은_한국어(self):
        self.assertEqual(self.detail("ko"), "유효하지 않은 초대 링크입니다.")

    def test_지역_표기도_언어로_읽는다(self):
        self.assertEqual(self.detail("ko-KR,ko;q=0.9"), "유효하지 않은 초대 링크입니다.")

    def test_지원하지_않는_언어는_기본_영어(self):
        self.assertEqual(self.detail("fr"), "This invitation link is not valid.")


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class RegistrationLanguageTests(TestCase):
    def setUp(self):
        # 첫 가입자는 슈퍼유저 부트스트랩 경로로 빠진다 — 일반 가입 경로를 보려고 한 명 둔다
        User.objects.create_superuser(email="root@x.io", password="pw-123456!", display_name="root")

    def register(self, email, accept_language):
        return APIClient().post("/api/auth/register/", {
            "email": email, "display_name": "Kim", "password": "Pass-word-123!",
        }, format="json", HTTP_ACCEPT_LANGUAGE=accept_language)

    def test_가입한_화면의_언어가_계정_언어가_된다(self):
        self.assertEqual(self.register("en@x.io", "en").status_code, 201)
        self.assertEqual(self.register("ko@x.io", "ko").status_code, 201)
        self.assertEqual(User.objects.get(email="en@x.io").language, "en")
        self.assertEqual(User.objects.get(email="ko@x.io").language, "ko")

    def test_인증_메일이_가입한_언어로_간다(self):
        self.register("ko@x.io", "ko")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("인증", mail.outbox[0].subject)
        self.assertIn("안녕하세요", mail.outbox[0].body)


class NotificationLanguageTests(TestCase):
    """알림 하나가 여러 언어 사용자에게 간다 — 각자 자기 언어로 받아야 한다."""

    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.actor = _user("actor@x.io", "en")
        self.ko = _user("ko@x.io", "ko")
        self.en = _user("en@x.io", "en")
        project = Project.objects.create(workspace=self.ws, name="Alpha", identifier="ALP")
        for u in (self.actor, self.ko, self.en):
            WorkspaceMember.objects.create(workspace=self.ws, member=u, role=15)
            ProjectMember.objects.create(project=project, member=u, role=15)
        state = State.objects.create(project=project, name="Todo", group="unstarted", color="#000")
        self.issue = Issue.objects.create(project=project, workspace=self.ws, title="Fix login",
                                          state=state, created_by=self.actor)

    def test_담당자_배정_알림이_받는_사람_언어로_저장된다(self):
        self.issue.assignees.add(self.ko, self.en)
        ko = Notification.objects.get(recipient=self.ko, type=Notification.Type.ISSUE_ASSIGNED)
        en = Notification.objects.get(recipient=self.en, type=Notification.Type.ISSUE_ASSIGNED)
        self.assertIn("담당자로 배정", ko.message)
        self.assertIn("assigned you to", en.message)
        self.assertNotRegex(en.message, HANGUL)


class CatalogTests(TestCase):
    """번역 파일 자체의 결함 — 빈 번역, 남은 fuzzy, 자리표시자 누락."""

    @staticmethod
    def entries():
        po = Path(settings.LOCALE_PATHS[0]) / "ko" / "LC_MESSAGES" / "django.po"
        text = po.read_text(encoding="utf-8")
        for block in text.split("\n\n"):
            lines = block.strip().splitlines()
            if not any(line.startswith("msgid ") for line in lines):
                continue
            fields, current = {"msgid": "", "msgstr": ""}, None
            for line in lines:
                if line.startswith("msgid "):
                    current = "msgid"; fields[current] = ast.literal_eval(line[6:])
                elif line.startswith("msgstr "):
                    current = "msgstr"; fields[current] = ast.literal_eval(line[7:])
                elif line.startswith('"') and current:
                    fields[current] += ast.literal_eval(line)
            fields["fuzzy"] = any(line.startswith("#,") and "fuzzy" in line for line in lines)
            if fields["msgid"]:  # 머리말(빈 msgid) 제외
                yield fields

    def test_번역이_비었거나_fuzzy_인_항목이_없다(self):
        bad = [e["msgid"] for e in self.entries() if not e["msgstr"] or e["fuzzy"]]
        self.assertEqual(bad, [], "locale/ko 에서 번역을 채우고 fuzzy 표시를 지우세요")

    def test_자리표시자가_원문과_번역에서_같다(self):
        bad = [(e["msgid"], e["msgstr"]) for e in self.entries()
               if set(PLACEHOLDER.findall(e["msgid"])) != set(PLACEHOLDER.findall(e["msgstr"]))]
        self.assertEqual(bad, [])


class NoHangulLiteralTests(TestCase):
    """코드에 한국어 문장을 직접 쓰면 언어 설정과 무관하게 한국어로 나간다.

    영어 원문을 gettext/gettext_lazy 로 감싸고 한국어는 .po 에 넣을 것.
    한국어가 꼭 필요한 줄(한글 매칭 정규식 등)은 줄 끝에 # i18n-ignore.
    """

    SKIP_DIRS = {"migrations", "management", "__pycache__"}

    def test_코드에_한국어_문자열이_없다(self):
        root = Path(settings.BASE_DIR) / "apps"
        found = []
        for path in sorted(root.rglob("*.py")):
            if self.SKIP_DIRS & set(path.parts) or path.name.startswith("test"):
                continue
            src = path.read_text(encoding="utf-8")
            lines = src.splitlines()
            tree = ast.parse(src)
            docstrings = {
                id(n.body[0].value) for n in ast.walk(tree)
                if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
                and n.body and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)
            }
            for node in ast.walk(tree):
                if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                        and id(node) not in docstrings and HANGUL.search(node.value)
                        and "i18n-ignore" not in lines[node.lineno - 1]):
                    found.append(f"{path.relative_to(root)}:{node.lineno}")
        self.assertEqual(found, [])
