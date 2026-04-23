from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # trailing slash 옵션 — y-websocket 클라이언트는 `${url}/${roomname}` 형태로
    # 끝 슬래시 없이 접속해서 strict `/$` 패턴이면 routing miss → WS reject.
    re_path(r"ws/documents/(?P<doc_id>[^/]+)/?$", consumers.DocumentConsumer.as_asgi()),
]
