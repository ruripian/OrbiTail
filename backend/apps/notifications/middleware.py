"""
WebSocket JWT 인증 미들웨어

연결 시 쿼리 파라미터에서 JWT 토큰을 추출하여 사용자 인증:
  ws://host/ws/workspace/slug/?token=<access_token>
"""

from urllib.parse import parse_qs
from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken
from apps.accounts.models import User


@database_sync_to_async
def get_user_from_token(token_str):
    """JWT access token에서 사용자 객체를 반환"""
    try:
        token = AccessToken(token_str)
        user = User.objects.get(id=token["user_id"])
        # HTTP 쪽 로그인과 같은 조건 — 정지·탈퇴한 계정이 남은 access 토큰으로 실시간 이벤트를 계속 받지 못하게
        if not user.is_active or user.is_suspended or user.deleted_at is not None:
            return AnonymousUser()
        return user
    except Exception:
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    """WebSocket 연결 시 JWT 토큰으로 사용자 인증"""

    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"").decode("utf-8")
        params = parse_qs(query_string)
        token_list = params.get("token", [])

        if token_list:
            scope["user"] = await get_user_from_token(token_list[0])
        else:
            scope["user"] = AnonymousUser()

        return await super().__call__(scope, receive, send)
