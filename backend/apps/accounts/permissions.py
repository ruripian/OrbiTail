from rest_framework import permissions


class IsSuperUser(permissions.BasePermission):
    """슈퍼유저(is_superuser=True) 전용 엔드포인트 가드"""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_superuser)
