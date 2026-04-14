from rest_framework import permissions


class IsSuperUser(permissions.BasePermission):
    """슈퍼유저(is_superuser=True) 전용 엔드포인트 가드"""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_superuser)


class IsWorkspaceAdminOrSuperUser(permissions.BasePermission):
    """관리자 페이지 진입용 — 어떤 워크스페이스에서든 ADMIN 이상이거나 슈퍼유저"""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_superuser:
            return True
        from apps.workspaces.models import WorkspaceMember
        return WorkspaceMember.objects.filter(
            member=user, role__gte=WorkspaceMember.Role.ADMIN,
        ).exists()
