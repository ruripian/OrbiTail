from datetime import timedelta

from django.utils import timezone
from django.utils.translation import gettext
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from apps.workspaces.models import WorkspaceMember

from .models import TOKEN_PREFIX, ApiToken, hash_token

# 요청마다 last_used_at 을 쓰면 읽기 요청도 전부 쓰기가 된다. 이 간격보다 오래됐을 때만 갱신한다.
LAST_USED_RESOLUTION = timedelta(minutes=1)


class ApiTokenAuthentication(BaseAuthentication):
    """`Authorization: Bearer orbt_…` — 공개 API(/api/v1/) 전용.

    JWT 와 같은 Bearer 헤더를 쓰지만 접두어로 구분한다. 접두어가 아니면 None 을 돌려
    다른 인증에 넘기지 않고, v1 뷰에는 이 인증 하나만 붙인다 — 사람 세션(JWT)으로
    공개 API 를 부르거나 토큰으로 내부 API 를 부르는 경로가 둘 다 없다.
    """

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if len(parts) != 2 or parts[0].lower() != b"bearer":
            return None
        try:
            raw = parts[1].decode()
        except UnicodeDecodeError:
            return None
        if not raw.startswith(TOKEN_PREFIX):
            return None

        token = (
            ApiToken.objects.select_related("user", "workspace")
            .filter(token_hash=hash_token(raw))
            .first()
        )
        # 없는 토큰·폐기·만료를 구분해서 알려주지 않는다 — 훔친 토큰이 살아 있는지 떠볼 수 없게
        if token is None or not token.is_active:
            raise AuthenticationFailed(gettext("Invalid token."))

        user = token.user
        if not user.is_active or user.is_suspended or user.deleted_at is not None:
            raise AuthenticationFailed(gettext("Invalid token."))
        # 발급 후 워크스페이스에서 나갔거나 게스트로 내려갔으면 토큰도 함께 죽는다
        if not WorkspaceMember.objects.filter(
            workspace_id=token.workspace_id, member=user, role__gte=WorkspaceMember.Role.MEMBER,
        ).exists():
            raise AuthenticationFailed(gettext("Invalid token."))

        now = timezone.now()
        if token.last_used_at is None or now - token.last_used_at > LAST_USED_RESOLUTION:
            ApiToken.objects.filter(pk=token.pk).update(last_used_at=now)
            token.last_used_at = now

        return user, token

    def authenticate_header(self, request):
        return 'Bearer realm="api"'
