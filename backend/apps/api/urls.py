from django.urls import path

from .views import (
    ApiTokenListCreateView, ApiTokenRevokeView,
    WebhookDeliveryListView, WebhookDetailView, WebhookListCreateView, WebhookPingView,
)

urlpatterns = [
    path("workspaces/<slug:workspace_slug>/api-tokens/", ApiTokenListCreateView.as_view(), name="api-token-list"),
    path("workspaces/<slug:workspace_slug>/api-tokens/<uuid:pk>/", ApiTokenRevokeView.as_view(), name="api-token-revoke"),
    path("workspaces/<slug:workspace_slug>/webhooks/", WebhookListCreateView.as_view(), name="webhook-list"),
    path("workspaces/<slug:workspace_slug>/webhooks/<uuid:pk>/", WebhookDetailView.as_view(), name="webhook-detail"),
    path("workspaces/<slug:workspace_slug>/webhooks/<uuid:pk>/ping/", WebhookPingView.as_view(), name="webhook-ping"),
    path("workspaces/<slug:workspace_slug>/webhooks/<uuid:pk>/deliveries/", WebhookDeliveryListView.as_view(),
         name="webhook-deliveries"),
]
