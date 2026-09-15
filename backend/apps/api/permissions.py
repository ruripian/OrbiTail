from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import ApiToken


class TokenScopePermission(BasePermission):
    """read 토큰은 읽기만, write 토큰은 읽기·쓰기."""

    message = "이 토큰에는 쓰기 권한이 없습니다."

    def has_permission(self, request, view):
        token = request.auth
        if not isinstance(token, ApiToken):
            return False
        if request.method in SAFE_METHODS:
            return True
        return token.scope == ApiToken.Scope.WRITE
