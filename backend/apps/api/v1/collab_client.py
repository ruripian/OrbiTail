"""협업 서버의 내부 쓰기 창구를 부른다.

문서 본문은 DB 에 직접 쓰지 않는다. 누가 편집 중이면 그 사람의 다음 저장이 조용히 덮어써서
외부 쓰기가 흔적 없이 사라지기 때문이다. 협업 서버가 살아 있는 Y.Doc 에 편집으로 넣게 한다.
"""
import json
import urllib.error
import urllib.request

from django.conf import settings


class CollabUnavailable(Exception):
    """협업 서버에 닿지 못했거나 쓰기를 거절당했다."""


def write_document_content(doc_id, html: str, mode: str) -> str:
    """mode: "replace" | "append". 반영된 뒤의 본문 HTML 을 돌려준다."""
    url = f"{settings.COLLAB_INTERNAL_URL.rstrip('/')}/documents/{doc_id}/content"
    body = json.dumps({"html": html, "mode": mode}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "X-Collab-Secret": settings.COLLAB_SHARED_SECRET,
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read())["content_html"]
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as exc:
        raise CollabUnavailable(str(exc)) from exc
