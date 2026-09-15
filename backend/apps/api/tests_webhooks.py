import hashlib
import hmac
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.issues.models import IssueComment
from apps.workspaces.models import WorkspaceMember

from . import tasks
from .models import Webhook, WebhookDelivery
from .tests_v1 import V1TestBase, _user
from .webhook_http import WebhookTargetError, resolve_target

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


class TargetCheckTests(TestCase):
    def test_blocks_internal_addresses(self):
        for url in [
            "http://127.0.0.1/", "http://localhost:8000/", "http://10.0.0.5/", "http://192.168.0.1/",
            "http://172.17.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/",
            "http://[::ffff:127.0.0.1]/", "http://0.0.0.0/",
        ]:
            with self.subTest(url=url), self.assertRaises(WebhookTargetError):
                resolve_target(url)

    def test_blocks_bad_shapes(self):
        for url in ["ftp://93.184.216.34/", "http://user:pw@93.184.216.34/", "http:///nohost",
                    "http://no-such-host.invalid/"]:
            with self.subTest(url=url), self.assertRaises(WebhookTargetError):
                resolve_target(url)

    def test_allows_public_ip(self):
        self.assertEqual(resolve_target("https://93.184.216.34/hook")[3], "93.184.216.34")

    @override_settings(WEBHOOK_ALLOW_PRIVATE_NETWORKS=True)
    def test_private_allowed_when_configured(self):
        self.assertEqual(resolve_target("http://127.0.0.1:9000/")[3], "127.0.0.1")


class WebhookManagementTests(V1TestBase):
    url = "/api/workspaces/ws/webhooks/"
    body = {"name": "슬랙", "url": "https://93.184.216.34/hook", "events": ["issue.created", "issue.created"]}

    def setUp(self):
        super().setUp()
        self.admin = _user("admin@x.io")
        WorkspaceMember.objects.create(workspace=self.ws, member=self.admin, role=WorkspaceMember.Role.ADMIN)

    def session(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def test_admin_creates_and_secret_is_shown_once(self):
        r = self.session(self.admin).post(self.url, self.body, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(len(r.data["secret"]), 64)
        self.assertEqual(r.data["events"], ["issue.created"])
        listed = self.session(self.admin).get(self.url).data
        self.assertNotIn("secret", listed[0])

    def test_member_cannot_manage(self):
        self.assertEqual(self.session(self.me).post(self.url, self.body, format="json").status_code, 403)
        self.assertEqual(self.session(self.me).get(self.url).status_code, 403)

    def test_rejects_internal_url_and_unknown_event(self):
        r = self.session(self.admin).post(self.url, {**self.body, "url": "http://redis:6379/"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.session(self.admin).post(self.url, {**self.body, "events": ["issue.exploded"]}, format="json")
        self.assertEqual(r.status_code, 400)

    @override_settings(DEMO_MODE=True)
    def test_demo_blocks_creation(self):
        self.assertEqual(self.session(self.admin).post(self.url, self.body, format="json").status_code, 403)

    def test_reenabling_resets_failures_and_sub_routes_do_not_patch(self):
        hook = Webhook.objects.create(workspace=self.ws, created_by=self.admin, name="h", url="https://93.184.216.34/",
                                      secret="s", events=["issue.created"], is_active=False,
                                      consecutive_failures=20, disabled_reason="x")
        c = self.session(self.admin)
        self.assertEqual(c.patch(f"{self.url}{hook.id}/ping/", {"is_active": True}, format="json").status_code, 405)
        self.assertEqual(c.patch(f"{self.url}{hook.id}/", {"is_active": True}, format="json").status_code, 200)
        hook.refresh_from_db()
        self.assertEqual((hook.is_active, hook.consecutive_failures, hook.disabled_reason), (True, 0, ""))


@override_settings(CACHES=LOCMEM)
class WebhookEventTests(V1TestBase):
    def setUp(self):
        super().setUp()
        from django.core.cache import cache
        cache.clear()
        self.hook = Webhook.objects.create(
            workspace=self.ws, created_by=self.me, name="h", url="https://93.184.216.34/", secret="sekrit",
            events=[e.value for e in Webhook.Event],
        )

    def scheduled(self, fn):
        with mock.patch.object(tasks.dispatch_event, "apply_async") as apply_async, \
                self.captureOnCommitCallbacks(execute=True):
            fn()
        return [c.args[0][0] for c in apply_async.call_args_list]

    def test_create_then_relations_is_one_event(self):
        def create():
            issue = self.make_issue(title="새")
            issue.label.set([self.label])
            issue.assignees.set([self.me])
            issue.title = "고침"
            issue.save()
        self.assertEqual(self.scheduled(create), ["issue.created"])

    def test_updates_are_coalesced(self):
        issue = self.make_issue()
        from django.core.cache import cache
        cache.clear()

        def update_twice():
            issue.title = "1"
            issue.save()
            issue.title = "2"
            issue.save()
        self.assertEqual(self.scheduled(update_twice), ["issue.updated"])

    def test_delete_and_comment(self):
        issue = self.make_issue()

        def delete():
            from django.utils import timezone
            issue.deleted_at = timezone.now()
            issue.save(update_fields=["deleted_at"])
        self.assertEqual(self.scheduled(delete), ["issue.deleted"])
        other = self.make_issue()
        self.assertEqual(self.scheduled(lambda: IssueComment.objects.create(issue=other, actor=self.me,
                                                                              comment_html="<p>x</p>")),
                         ["comment.created"])

    def test_no_hooks_no_events(self):
        Webhook.objects.all().delete()
        self.assertEqual(self.scheduled(lambda: self.make_issue()), [])

    def test_dispatch_respects_creator_visibility_and_subscription(self):
        mine = self.make_issue(title="mine")
        secret = self.make_issue(project=self.secret, title="secret")
        with mock.patch.object(tasks.deliver, "delay"):
            tasks.dispatch_event("issue.updated", str(self.ws.id), "issue", str(secret.id))
            self.assertEqual(WebhookDelivery.objects.count(), 0)
            tasks.dispatch_event("issue.updated", str(self.ws.id), "issue", str(mine.id))
            self.assertEqual(WebhookDelivery.objects.count(), 1)
            d = WebhookDelivery.objects.get()
            self.assertEqual(d.payload["data"]["title"], "mine")
            self.assertTrue(d.payload["data"]["web_url"].startswith("http"))

            self.hook.events = ["document.created"]
            self.hook.save()
            tasks.dispatch_event("issue.updated", str(self.ws.id), "issue", str(mine.id))
            self.assertEqual(WebhookDelivery.objects.count(), 1)

    def test_creator_leaving_workspace_stops_events(self):
        issue = self.make_issue()
        WorkspaceMember.objects.filter(workspace=self.ws, member=self.me).delete()
        with mock.patch.object(tasks.deliver, "delay"):
            tasks.dispatch_event("issue.updated", str(self.ws.id), "issue", str(issue.id))
        self.assertEqual(WebhookDelivery.objects.count(), 0)


class WebhookDeliveryTests(V1TestBase):
    def setUp(self):
        super().setUp()
        self.hook = Webhook.objects.create(workspace=self.ws, created_by=self.me, name="h",
                                           url="https://93.184.216.34/", secret="sekrit", events=["issue.created"])

    def delivery(self):
        return WebhookDelivery.objects.create(webhook=self.hook, event="issue.created", payload={"event": "x"})

    def test_success_is_signed(self):
        d = self.delivery()
        with mock.patch("apps.api.tasks.post_json", return_value=(200, "ok")) as post:
            tasks.deliver(str(d.id))
        url, body, headers = post.call_args.args
        expected = hmac.new(b"sekrit", headers["X-OrbiTail-Timestamp"].encode() + b"." + body, hashlib.sha256).hexdigest()
        self.assertEqual(headers["X-OrbiTail-Signature"], f"sha256={expected}")
        d.refresh_from_db()
        self.assertEqual((d.status, d.attempts), ("success", 1))

    def test_failure_retries_then_fails_and_disables_at_threshold(self):
        self.hook.consecutive_failures = tasks.DISABLE_AFTER_FAILURES - 1
        self.hook.save()
        d = self.delivery()
        with mock.patch("apps.api.tasks.post_json", return_value=(500, "boom")), \
                mock.patch.object(tasks.deliver, "apply_async") as retry:
            for _ in range(len(tasks.RETRY_DELAYS) + 1):
                tasks.deliver(str(d.id))
        self.assertEqual([c.kwargs["countdown"] for c in retry.call_args_list], tasks.RETRY_DELAYS)
        d.refresh_from_db()
        self.hook.refresh_from_db()
        self.assertEqual((d.status, d.attempts, d.response_status), ("failed", 5, 500))
        self.assertFalse(self.hook.is_active)
        self.assertTrue(self.hook.disabled_reason)

    def test_blocked_target_fails_without_retry(self):
        d = self.delivery()
        with mock.patch("apps.api.tasks.post_json", side_effect=WebhookTargetError("내부망")), \
                mock.patch.object(tasks.deliver, "apply_async") as retry:
            tasks.deliver(str(d.id))
        retry.assert_not_called()
        d.refresh_from_db()
        self.assertEqual(d.status, "failed")

    @override_settings(WEBHOOK_ALLOW_PRIVATE_NETWORKS=True)
    def test_real_http_roundtrip(self):
        received = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received["headers"] = dict(self.headers)
                received["body"] = self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(204)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.handle_request, daemon=True).start()
        self.hook.url = f"http://127.0.0.1:{server.server_address[1]}/hook?x=1"
        self.hook.save()
        d = self.delivery()
        tasks.deliver(str(d.id))
        server.server_close()
        d.refresh_from_db()
        self.assertEqual((d.status, d.response_status), ("success", 204))
        self.assertEqual(json.loads(received["body"]), {"event": "x"})
        self.assertEqual(received["headers"]["X-OrbiTail-Event"], "issue.created")
