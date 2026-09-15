from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.workspaces.models import Workspace, WorkspaceMember

from .models import ApiToken, hash_token


def _user(email, **extra):
    return User.objects.create_user(
        email=email, password="pw-123456!", display_name=email.split("@")[0],
        is_active=True, is_approved=True, is_email_verified=True, **extra,
    )


class ApiTokenTestBase(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="WS", slug="ws")
        self.owner = _user("owner@x.io")
        self.member = _user("member@x.io")
        self.guest = _user("guest@x.io")
        WorkspaceMember.objects.create(workspace=self.ws, member=self.owner, role=WorkspaceMember.Role.OWNER)
        WorkspaceMember.objects.create(workspace=self.ws, member=self.member, role=WorkspaceMember.Role.MEMBER)
        WorkspaceMember.objects.create(workspace=self.ws, member=self.guest, role=WorkspaceMember.Role.GUEST)

    def session(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def bearer(self, raw):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
        return c


class TokenManagementTests(ApiTokenTestBase):
    url = "/api/workspaces/ws/api-tokens/"

    def test_issue_returns_raw_once_and_stores_only_hash(self):
        r = self.session(self.member).post(self.url, {"name": "CI", "scope": "write"}, format="json")
        self.assertEqual(r.status_code, 201)
        raw = r.data["token"]
        self.assertTrue(raw.startswith("orbt_"))
        token = ApiToken.objects.get(pk=r.data["id"])
        self.assertEqual(token.token_hash, hash_token(raw))
        self.assertNotIn(raw, str(token.__dict__))
        # 기본 만료 90일
        self.assertAlmostEqual(token.expires_at, timezone.now() + timedelta(days=90), delta=timedelta(minutes=1))

        listed = self.session(self.member).get(self.url)
        self.assertEqual(len(listed.data), 1)
        self.assertNotIn("token", listed.data[0])

    def test_no_expiry(self):
        r = self.session(self.member).post(self.url, {"name": "n", "expires_in_days": None}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertIsNone(r.data["expires_at"])

    def test_rejects_arbitrary_expiry(self):
        r = self.session(self.member).post(self.url, {"name": "n", "expires_in_days": 7}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_guest_and_outsider_cannot_issue(self):
        self.assertEqual(self.session(self.guest).post(self.url, {"name": "n"}, format="json").status_code, 403)
        outsider = _user("out@x.io")
        self.assertEqual(self.session(outsider).post(self.url, {"name": "n"}, format="json").status_code, 404)

    @override_settings(DEMO_MODE=True)
    def test_demo_mode_blocks_issue(self):
        self.assertEqual(self.session(self.member).post(self.url, {"name": "n"}, format="json").status_code, 403)

    def test_list_all_is_admin_only(self):
        ApiToken.issue(workspace=self.ws, user=self.member, name="m", scope="read")
        ApiToken.issue(workspace=self.ws, user=self.owner, name="o", scope="read")
        self.assertEqual(len(self.session(self.member).get(self.url).data), 1)
        self.assertEqual(self.session(self.member).get(self.url + "?all=true").status_code, 403)
        self.assertEqual(len(self.session(self.owner).get(self.url + "?all=true").data), 2)

    def test_revoke_own_and_admin_can_revoke_others(self):
        mine, _ = ApiToken.issue(workspace=self.ws, user=self.member, name="m", scope="read")
        theirs, _ = ApiToken.issue(workspace=self.ws, user=self.owner, name="o", scope="read")
        # 남의 토큰은 없는 것처럼
        self.assertEqual(self.session(self.member).delete(f"{self.url}{theirs.pk}/").status_code, 404)
        self.assertEqual(self.session(self.member).delete(f"{self.url}{mine.pk}/").status_code, 204)
        self.assertEqual(self.session(self.owner).delete(f"{self.url}{theirs.pk}/").status_code, 204)
        mine.refresh_from_db()
        self.assertIsNotNone(mine.revoked_at)
        self.assertEqual(mine.revoked_by, self.member)

    def test_active_token_cap(self):
        for i in range(20):
            ApiToken.issue(workspace=self.ws, user=self.member, name=f"t{i}", scope="read")
        r = self.session(self.member).post(self.url, {"name": "one more"}, format="json")
        self.assertEqual(r.status_code, 400)


class TokenAuthenticationTests(ApiTokenTestBase):
    url = "/api/v1/me/"

    def test_valid_token_resolves_owner_and_workspace(self):
        token, raw = ApiToken.issue(workspace=self.ws, user=self.member, name="CI", scope="read")
        r = self.bearer(raw).get(self.url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["user"]["email"], "member@x.io")
        self.assertEqual(r.data["workspace"]["slug"], "ws")
        self.assertEqual(r.data["token"]["scope"], "read")
        token.refresh_from_db()
        self.assertIsNotNone(token.last_used_at)

    def test_missing_wrong_revoked_expired_all_401(self):
        self.assertEqual(APIClient().get(self.url).status_code, 401)
        self.assertEqual(self.bearer("orbt_not-a-real-token").get(self.url).status_code, 401)

        revoked, raw_revoked = ApiToken.issue(workspace=self.ws, user=self.member, name="r", scope="read")
        revoked.revoked_at = timezone.now()
        revoked.save()
        self.assertEqual(self.bearer(raw_revoked).get(self.url).status_code, 401)

        _, raw_expired = ApiToken.issue(
            workspace=self.ws, user=self.member, name="e", scope="read",
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        self.assertEqual(self.bearer(raw_expired).get(self.url).status_code, 401)

    def test_token_dies_with_membership_or_account(self):
        _, raw = ApiToken.issue(workspace=self.ws, user=self.member, name="t", scope="read")
        WorkspaceMember.objects.filter(workspace=self.ws, member=self.member).update(role=WorkspaceMember.Role.GUEST)
        self.assertEqual(self.bearer(raw).get(self.url).status_code, 401)

        WorkspaceMember.objects.filter(workspace=self.ws, member=self.member).update(role=WorkspaceMember.Role.MEMBER)
        self.assertEqual(self.bearer(raw).get(self.url).status_code, 200)

        User.objects.filter(pk=self.member.pk).update(is_suspended=True)
        self.assertEqual(self.bearer(raw).get(self.url).status_code, 401)

    def test_session_jwt_is_not_accepted_on_v1(self):
        # force_authenticate 는 인증 단계를 건너뛰므로 실제 JWT 를 헤더로 보낸다
        jwt = str(RefreshToken.for_user(self.member).access_token)
        self.assertEqual(self.bearer(jwt).get(self.url).status_code, 401)

    def test_token_is_not_accepted_on_internal_api(self):
        _, raw = ApiToken.issue(workspace=self.ws, user=self.member, name="t", scope="write")
        self.assertEqual(self.bearer(raw).get("/api/workspaces/ws/api-tokens/").status_code, 401)

    def test_read_scope_cannot_write(self):
        _, raw = ApiToken.issue(workspace=self.ws, user=self.member, name="t", scope="read")
        r = self.bearer(raw).post(self.url, {}, format="json")
        self.assertEqual(r.status_code, 403)
        _, raw_w = ApiToken.issue(workspace=self.ws, user=self.member, name="w", scope="write")
        # 권한은 통과하고, me 에 POST 가 없으니 405
        self.assertEqual(self.bearer(raw_w).post(self.url, {}, format="json").status_code, 405)
