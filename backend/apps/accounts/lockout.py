"""django-axes lockout 응답 핸들러.

Default 핸들러는 HTML 응답이라 SPA 입장에서 "왜 갑자기 응답이 깨졌지?" 가 됨.
프론트가 알아볼 수 있게 JSON + 표준 detail 메시지 + Retry-After 헤더 반환.
"""

from django.http import JsonResponse
from django.utils.translation import gettext as _

LOCKOUT_DETAIL = _(
    "Too many failed sign-in attempts. Please try again later."
)


def lockout_response(request, credentials, *args, **kwargs):
    """403 + JSON. 프론트 axios interceptor 가 detail 을 toast 로 띄움."""
    return JsonResponse(
        {"detail": str(LOCKOUT_DETAIL), "code": "account_locked"},
        status=403,
    )
