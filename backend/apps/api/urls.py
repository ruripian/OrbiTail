from django.urls import path

from .views import ApiTokenListCreateView, ApiTokenRevokeView

urlpatterns = [
    path("workspaces/<slug:workspace_slug>/api-tokens/", ApiTokenListCreateView.as_view(), name="api-token-list"),
    path("workspaces/<slug:workspace_slug>/api-tokens/<uuid:pk>/", ApiTokenRevokeView.as_view(), name="api-token-revoke"),
]
