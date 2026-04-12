from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from apps.accounts.setup_views import SetupStatusView, SetupView
from apps.workspaces.views import InvitationDetailView, InvitationAcceptView
from config.version import VersionView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/version/", VersionView.as_view(), name="version"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/workspaces/", include("apps.workspaces.urls")),
    path("api/", include("apps.projects.urls")),
    path("api/", include("apps.issues.urls")),
    path("api/", include("apps.notifications.urls")),
    # 초대 수락 — 워크스페이스 slug 없이 토큰으로 직접 접근
    path("api/invitations/<uuid:token>/", InvitationDetailView.as_view(), name="invitation-detail"),
    path("api/invitations/<uuid:token>/accept/", InvitationAcceptView.as_view(), name="invitation-accept"),
    # 초기 설정 엔드포인트 (인증 불필요)
    path("api/setup/status/", SetupStatusView.as_view(), name="setup-status"),
    path("api/setup/", SetupView.as_view(), name="setup"),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
