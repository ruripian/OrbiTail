"""
ASGI 설정 — HTTP + WebSocket 라우팅

WebSocket 경로:
  ws://<host>/ws/workspace/<slug>/  — 워크스페이스별 실시간 이벤트
"""

import os
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

# Django ASGI app을 먼저 초기화 (ORM 등 준비)
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from apps.notifications.routing import websocket_urlpatterns  # noqa: E402
from apps.documents.routing import websocket_urlpatterns as doc_ws_patterns  # noqa: E402
from apps.notifications.middleware import JWTAuthMiddleware  # noqa: E402

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": JWTAuthMiddleware(
        URLRouter(websocket_urlpatterns + doc_ws_patterns)
    ),
})
