from django.urls import path

from .views import DemoSessionCheckView, DemoSessionView, DemoStatusView

urlpatterns = [
    path("status/", DemoStatusView.as_view(), name="demo-status"),
    path("session/", DemoSessionView.as_view(), name="demo-session"),
    path("session/check/", DemoSessionCheckView.as_view(), name="demo-session-check"),
]
