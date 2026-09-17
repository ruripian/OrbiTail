"""실시간 협업 서버(Hocuspocus)가 부르는 내부 엔드포인트.

문서 구조를 아는 쪽을 Node 서버로 옮기면서 생긴 세 가지 필요를 채운다.
  1) 이 사용자가 이 문서를 열어도 되는가 / 고쳐도 되는가
  2) 문서를 열 때 저장된 Yjs 상태를 넘겨주기
  3) 편집이 멈추면 Yjs 상태와, **서버가 만든** content_html 을 저장하기

3번이 핵심이다. 지금까지 content_html 은 브라우저가 2초마다 REST 로 덮어쓰는 사본이었고,
그래서 원본(yjs_state)과 최대 2초 어긋났다. 이제 같은 시점에 같은 곳에서 함께 저장된다.

인증: 1번은 **사용자 본인의 JWT** 로 판정한다(협업 서버가 대신 물어볼 뿐이다).
2·3번은 사용자 토큰으로 할 수 없는 일(디바운스 저장은 연결이 끊긴 뒤에도 일어난다)이라
공유 비밀(COLLAB_SHARED_SECRET)로 협업 서버만 부를 수 있게 막는다.
"""

import base64
import hmac

from django.conf import settings
from django.utils.translation import gettext
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .consumers import document_role
from .models import Document, DocumentSpaceMember
from .links import sync_document_links


def _secret_ok(request) -> bool:
    """협업 서버만 부를 수 있게. 비밀값이 비어 있으면 아예 막는다 — 설정을 빠뜨린 채
    내부 엔드포인트가 열려 있는 상태가 가장 나쁘다."""
    expected = getattr(settings, "COLLAB_SHARED_SECRET", "") or ""
    given = request.headers.get("X-Collab-Secret", "")
    if not expected:
        return False
    return hmac.compare_digest(expected, given)


class CollabAuthView(APIView):
    """협업 서버가 연결을 받아들이기 전에 묻는다 — 이 사람이 이 문서를 열어도 되나.

    사용자 JWT 로 인증하므로 여기서는 공유 비밀을 쓰지 않는다.
    """

    def get(self, request, doc_pk):
        # 동기 함수로 판정한다. 전에는 async 로 감싼 함수를 await 없이 불러, 돌아온 코루틴 객체가 항상
        # 참이라 문서 id 만 알면 누구나 협업 서버에 붙어 본문을 받았다.
        role = document_role(request.user, str(doc_pk))
        if role is None:
            return Response({"detail": gettext("You do not have access.")}, status=status.HTTP_403_FORBIDDEN)
        return Response({
            "allowed": True,
            # 편집 권한이 없으면 협업 서버가 읽기 전용으로 붙인다
            "can_edit": role >= DocumentSpaceMember.Role.EDITOR,
            "user": {
                "id": str(request.user.id),
                "name": request.user.display_name or request.user.email,
            },
        })


class CollabDocumentView(APIView):
    """Yjs 상태 읽기/쓰기 — 협업 서버 전용."""

    permission_classes = [AllowAny]   # 사용자 세션이 아니라 공유 비밀로 판정한다
    authentication_classes = []

    def get(self, request, doc_pk):
        if not _secret_ok(request):
            return Response(status=status.HTTP_403_FORBIDDEN)
        try:
            doc = Document.objects.only("id", "yjs_state", "content_html").get(
                pk=doc_pk, deleted_at__isnull=True,
            )
        except Document.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        state = bytes(doc.yjs_state) if doc.yjs_state else b""
        return Response({
            # 바이너리를 JSON 으로 실어 보내야 하므로 base64
            "yjs_base64": base64.b64encode(state).decode() if len(state) > 2 else "",
            # 아직 Yjs 상태가 없는 문서를 협업 서버가 본문으로 초기화할 수 있게 함께 보낸다
            "content_html": doc.content_html or "",
        })

    def post(self, request, doc_pk):
        if not _secret_ok(request):
            return Response(status=status.HTTP_403_FORBIDDEN)
        try:
            doc = Document.objects.get(pk=doc_pk, deleted_at__isnull=True)
        except Document.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        raw = request.data.get("yjs_base64") or ""
        html = request.data.get("content_html")
        fields = []
        if raw:
            try:
                state = base64.b64decode(raw)
            except Exception:
                return Response({"detail": gettext("Could not read yjs_base64.")},
                                status=status.HTTP_400_BAD_REQUEST)
            # 빈 Y.Doc 의 업데이트는 2바이트다. 그걸 저장하면 다음 로드에서 "상태 있음"으로
            # 잘못 판정돼 시드가 건너뛰어지고 빈 문서가 확정된다.
            if len(state) > 2:
                doc.yjs_state = state
                fields.append("yjs_state")
        if isinstance(html, str):
            doc.content_html = html
            fields.append("content_html")

        if not fields:
            return Response({"saved": False})

        doc.save(update_fields=fields)
        if "content_html" in fields:
            try:
                sync_document_links(doc)
            except Exception:
                # 링크 반영 실패가 본문 저장을 되돌리면 안 된다. 다음 저장에서 다시 맞춰진다.
                pass
        return Response({"saved": True})
