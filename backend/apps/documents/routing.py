from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r"ws/documents/(?P<doc_id>[^/]+)/$", consumers.DocumentConsumer.as_asgi()),
]
