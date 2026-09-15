from rest_framework.throttling import SimpleRateThrottle

from .models import ApiToken


class ApiTokenRateThrottle(SimpleRateThrottle):
    """토큰마다 따로 센다. 한 사람이 토큰을 여러 개 쓰는 자동화가 서로를 막지 않게.

    사람 세션의 user 스로틀과도 분리된다 — 자동화가 폭주해도 그 사람의 화면은 멈추지 않는다.
    """

    scope = "api_token"

    def get_cache_key(self, request, view):
        if not isinstance(request.auth, ApiToken):
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.auth.pk}
