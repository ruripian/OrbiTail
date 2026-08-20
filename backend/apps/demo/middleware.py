"""데모 모드에서 통째로 막는 요청들.

뷰 단위 권한이 아니라 미들웨어로 처리한다. 관리자 API 는 여러 앱에 흩어져
있고 업로드는 여러 뷰에 붙어 있어서, 새 엔드포인트가 생겼을 때 가드를
빠뜨리는 사고를 막으려면 입구에서 경로/컨텐츠 타입으로 끊는 편이 안전하다.
"""
from django.conf import settings
from django.http import JsonResponse

# 관리자 영역 — 전역 콘솔, 감사 로그, Django admin
BLOCKED_PREFIXES = ("/api/admin/", "/admin/")

# 파일 업로드는 multipart 로만 들어온다. 다만 컨텐츠 타입만 보고 끊으면
# 안 된다. 커버 이미지 "제거" 처럼 파일 없이 multipart 로 오는 정상 요청이
# 있기 때문이다(frontend/src/api/documents.ts). 실제로 파일이 실려 있을
# 때만 막는다.
UPLOAD_CONTENT_TYPE = "multipart/form-data"

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


class DemoGuardMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if settings.DEMO_MODE:
            blocked = self._blocked_reason(request)
            if blocked:
                return JsonResponse({"detail": blocked}, status=403)
        return self.get_response(request)

    @staticmethod
    def _blocked_reason(request):
        path = request.path
        if path.startswith(BLOCKED_PREFIXES):
            return "데모에서는 관리자 기능을 사용할 수 없습니다."
        if request.method not in SAFE_METHODS:
            content_type = (request.META.get("CONTENT_TYPE") or "").lower()
            if content_type.startswith(UPLOAD_CONTENT_TYPE) and request.FILES:
                return "데모에서는 파일 업로드를 사용할 수 없습니다."
        return None
