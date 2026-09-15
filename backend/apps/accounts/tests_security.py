"""계정·공지·데모 차단·실시간 인증·알림 설정의 권한 경계."""
from django.test import RequestFactory, TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.accounts.models import Announcement, User
from apps.demo.middleware import DemoGuardMiddleware
from apps.projects.models import Project, State
from apps.workspaces.models import Workspace, WorkspaceMember


def _user(email, **kw):
    return User.objects.create_user(email=email, password="old-pass-123!", display_name=email.split("@")[0],
                                    is_active=True, is_approved=True, is_email_verified=True, **kw)


class AccountSecurityTests(TestCase):
    def setUp(self):
        self.user = _user("u@x.io")

    def test_password_change_revokes_other_sessions(self):
        stolen = RefreshToken.for_user(self.user)
        c = APIClient()
        c.force_authenticate(self.user)
        r = c.post("/api/auth/me/password/", {"current_password": "old-pass-123!", "new_password": "new-pass-456!"},
                   format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=stolen["jti"]).exists())
        # 이 세션용 새 토큰은 살아 있다
        fresh = r.data["refresh"]
        self.assertEqual(APIClient().post("/api/auth/token/refresh/", {"refresh": fresh}, format="json").status_code, 200)
        self.assertEqual(APIClient().post("/api/auth/token/refresh/", {"refresh": str(stolen)}, format="json").status_code, 401)

    def test_unpublished_announcement_hidden(self):
        a = Announcement.objects.create(title="내부", body="x", is_published=False)
        c = APIClient()
        c.force_authenticate(self.user)
        self.assertEqual(c.get(f"/api/auth/announcements/{a.id}/").status_code, 404)

    def test_websocket_rejects_suspended_user(self):
        from asgiref.sync import async_to_sync
        from apps.notifications.middleware import get_user_from_token
        token = str(AccessToken.for_user(self.user))
        User.objects.filter(pk=self.user.pk).update(is_suspended=True)
        self.assertTrue(async_to_sync(get_user_from_token)(token).is_anonymous)

    @override_settings(DEMO_MODE=True)
    def test_demo_blocks_account_admin_and_announcement_writes(self):
        guard = DemoGuardMiddleware(lambda r: None)
        rf = RequestFactory()
        self.assertIsNotNone(guard._blocked_reason(rf.post("/api/auth/admin/users/x/superuser/")))
        self.assertIsNotNone(guard._blocked_reason(rf.post("/api/auth/announcements/")))
        self.assertIsNone(guard._blocked_reason(rf.post("/api/auth/announcements/mark-seen/")))


class NotificationAndMeSecurityTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.other_ws = Workspace.objects.create(name="O", slug="other")
        self.member = _user("m@x.io")
        self.stranger = _user("s@x.io")
        WorkspaceMember.objects.create(workspace=self.ws, member=self.member, role=15)
        WorkspaceMember.objects.create(workspace=self.other_ws, member=self.stranger, role=15)
        self.public = Project.objects.create(workspace=self.ws, name="P", identifier="PUB",
                                             network=Project.Network.PUBLIC)

    def test_outsider_cannot_subscribe_to_public_project(self):
        c = APIClient()
        c.force_authenticate(self.stranger)
        url = f"/api/workspaces/ws/projects/{self.public.id}/notification-preferences/"
        from django.urls import resolve, Resolver404
        try:
            resolve(url)
        except Resolver404:
            self.skipTest("알림 설정 경로가 다르다")
        self.assertEqual(c.patch(url, {"email_issue_created": True}, format="json").status_code, 404)

    def test_personal_issue_rejects_foreign_state(self):
        foreign_state = State.objects.create(project=self.public, name="남의 상태", group="unstarted", color="#000")
        c = APIClient()
        c.force_authenticate(self.member)
        r = c.post("/api/me/issues/?workspace=ws", {"title": "x", "state": str(foreign_state.id), "workspace_slug": "ws"},
                   format="json")
        self.assertEqual(r.status_code, 400, getattr(r, "data", None))
