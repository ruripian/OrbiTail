from django.test import RequestFactory, SimpleTestCase, override_settings
from rest_framework.settings import api_settings
from rest_framework.throttling import AnonRateThrottle

from apps.core.client_ip import client_ip

NGINX = "172.20.0.5"      # Django 가 보는 REMOTE_ADDR
CADDY = "172.19.0.1"      # nginx 가 본 앞단(Caddy) 주소
REAL = "58.148.69.146"
FAKE = "6.6.6.6"


def req(xff=None):
    extra = {"REMOTE_ADDR": NGINX}
    if xff is not None:
        extra["HTTP_X_FORWARDED_FOR"] = xff
    return RequestFactory().get("/", **extra)


class ClientIpTests(SimpleTestCase):
    @override_settings(TRUSTED_PROXY_COUNT=0)
    def test_0이면_XFF를_무시한다(self):
        self.assertEqual(client_ip(req(f"{FAKE}, {REAL}")), NGINX)

    @override_settings(TRUSTED_PROXY_COUNT=1)
    def test_nginx_단독_위조한_XFF는_무시된다(self):
        # 공격자가 XFF: 6.6.6.6 을 보내면 nginx 가 뒤에 실제 주소를 덧붙인다
        self.assertEqual(client_ip(req(f"{FAKE}, {REAL}")), REAL)

    @override_settings(TRUSTED_PROXY_COUNT=2)
    def test_Caddy_nginx_2단(self):
        # 운영에서 실측한 형태: Caddy 가 채운 실제 주소 + nginx 가 덧붙인 Caddy 주소
        self.assertEqual(client_ip(req(f"{REAL}, {CADDY}")), REAL)

    @override_settings(TRUSTED_PROXY_COUNT=2)
    def test_2단에서도_앞쪽_위조는_무시된다(self):
        self.assertEqual(client_ip(req(f"{FAKE}, {REAL}, {CADDY}")), REAL)

    @override_settings(TRUSTED_PROXY_COUNT=2)
    def test_XFF가_없으면_REMOTE_ADDR(self):
        self.assertEqual(client_ip(req()), NGINX)

    @override_settings(TRUSTED_PROXY_COUNT=1)
    def test_빈_항목과_공백을_견딘다(self):
        self.assertEqual(client_ip(req(f" , {REAL} ")), REAL)


class SameIpEverywhereTests(SimpleTestCase):
    """스로틀·axes·데모가 같은 주소를 본다 — 셋이 따로 놀던 것이 원래 문제였다."""

    def test_axes_가_client_ip_를_쓴다(self):
        from axes.helpers import get_client_ip_address

        with override_settings(TRUSTED_PROXY_COUNT=2):
            self.assertEqual(get_client_ip_address(req(f"{FAKE}, {REAL}, {CADDY}")), REAL)

    def test_DRF_스로틀_식별자가_client_ip_와_같다(self):
        # NUM_PROXIES 는 settings 로드 시점의 TRUSTED_PROXY_COUNT 를 받는다
        from django.conf import settings

        self.assertEqual(api_settings.NUM_PROXIES, settings.TRUSTED_PROXY_COUNT)
        with override_settings(TRUSTED_PROXY_COUNT=2, REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 2}):
            api_settings.reload()
            try:
                r = req(f"{FAKE}, {REAL}, {CADDY}")
                self.assertEqual(AnonRateThrottle().get_ident(r), client_ip(r))
            finally:
                api_settings.reload()

    def test_데모_발급_제한이_위조_XFF로_갈라지지_않는다(self):
        from apps.demo.views import _client_hash

        with override_settings(TRUSTED_PROXY_COUNT=1):
            a = _client_hash(req(f"1.1.1.1, {REAL}"))
            b = _client_hash(req(f"2.2.2.2, {REAL}"))
        self.assertEqual(a, b)
