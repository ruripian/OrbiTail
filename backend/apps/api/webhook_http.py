"""웹훅 HTTP 발송 — 서버 안쪽을 찌르지 못하게.

웹훅 주소는 사용자가 정한다. 그대로 요청을 보내면 `http://redis:6379`, `http://192.168.0.1`,
클라우드 메타데이터 주소처럼 **이 서버만 닿을 수 있는 곳**에 대신 요청을 보내는 통로가 된다(SSRF).

그래서 주소를 IP 로 풀어 공인 주소인지 확인하고, **확인한 그 IP 로** 연결한다. 이름을 한 번 더
풀면 확인과 연결 사이에 DNS 응답을 바꿔 내부 주소로 돌리는 우회(DNS rebinding)가 가능해진다.
리다이렉트는 따라가지 않는다 — 따라가면 확인하지 않은 주소로 가게 된다.

사설망에 받는 쪽을 둔 자체 호스팅이라면 WEBHOOK_ALLOW_PRIVATE_NETWORKS=True 로 끈다.
"""
import http.client
import ipaddress
import socket
import ssl
from urllib.parse import urlsplit

from django.conf import settings
from django.utils.translation import gettext

TIMEOUT_SECONDS = 10
MAX_RESPONSE_BYTES = 1000


class WebhookTargetError(Exception):
    """보낼 수 없는 주소."""


def _allowed_ip(ip: str) -> bool:
    if getattr(settings, "WEBHOOK_ALLOW_PRIVATE_NETWORKS", False):
        return True
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global


def resolve_target(url: str) -> tuple[str, str, int, str]:
    """(scheme, host, port, ip) — 보낼 수 없으면 WebhookTargetError."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise WebhookTargetError(gettext("Must be an http or https URL."))
    if parts.username or parts.password:
        raise WebhookTargetError(gettext("The URL cannot contain user credentials."))
    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise WebhookTargetError(gettext("Could not resolve the address: %(host)s") % {"host": parts.hostname}) from exc
    ips = [info[4][0] for info in infos]
    # 여러 IP 가 나오면 전부 공인이어야 한다. 하나라도 내부면 그쪽으로 붙을 수 있다.
    if not ips or not all(_allowed_ip(ip) for ip in ips):
        raise WebhookTargetError(gettext("Cannot send to a private network address."))
    return parts.scheme, parts.hostname, port, ips[0]


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, ip, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._ip = ip

    def connect(self):
        self.sock = socket.create_connection((self._ip, self.port), self.timeout)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, ip, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        # 인증서는 IP 가 아니라 원래 이름으로 검증한다
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def post_json(url: str, body: bytes, headers: dict) -> tuple[int, str]:
    """(상태 코드, 응답 앞부분). 연결 실패는 OSError 계열로 올라온다."""
    scheme, host, port, ip = resolve_target(url)
    parts = urlsplit(url)
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    if scheme == "https":
        conn = _PinnedHTTPSConnection(ip, host, port, timeout=TIMEOUT_SECONDS, context=ssl.create_default_context())
    else:
        conn = _PinnedHTTPConnection(ip, host, port, timeout=TIMEOUT_SECONDS)
    try:
        conn.request("POST", path, body=body, headers=headers)
        res = conn.getresponse()
        text = res.read(MAX_RESPONSE_BYTES).decode("utf-8", errors="replace")
        return res.status, text
    finally:
        conn.close()
