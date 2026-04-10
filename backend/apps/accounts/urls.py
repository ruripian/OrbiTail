from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView, TokenBlacklistView
from .views import (
    RegisterView,
    CustomTokenObtainPairView,
    MeView,
    ChangePasswordView,
    DeleteAccountView,
    VerifyEmailView,
    PasswordResetRequestView,
    PasswordResetConfirmView,
    AdminUserListView,
    AdminUserApproveView,
    AnnouncementListCreateView,
    AnnouncementDetailView,
    AnnouncementUnreadCountView,
    AnnouncementMarkSeenView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("login/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("logout/", TokenBlacklistView.as_view(), name="token_blacklist"),
    path("me/", MeView.as_view(), name="me"),
    path("me/delete/", DeleteAccountView.as_view(), name="delete-account"),
    path("me/password/", ChangePasswordView.as_view(), name="change-password"),
    path("verify-email/", VerifyEmailView.as_view(), name="verify-email"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    
    # Admin
    path("admin/users/", AdminUserListView.as_view(), name="admin-user-list"),
    path("admin/users/<uuid:pk>/approve/", AdminUserApproveView.as_view(), name="admin-user-approve"),

    # Announcements
    path("announcements/", AnnouncementListCreateView.as_view(), name="announcement-list-create"),
    path("announcements/<uuid:pk>/", AnnouncementDetailView.as_view(), name="announcement-detail"),
    path("announcements/unread/", AnnouncementUnreadCountView.as_view(), name="announcement-unread"),
    path("announcements/mark-seen/", AnnouncementMarkSeenView.as_view(), name="announcement-mark-seen"),
]
