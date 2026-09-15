"""저장하는 HTML 을 허용 목록으로 정리한다 — 저장형 XSS 차단.

에디터가 만든 HTML 이라고 믿으면 안 된다. API 는 본문 필드(comment_html, description_html,
content_html)에 아무 문자열이나 받고, 일부 화면(댓글·요청·공개 문서·버전·휴지통 미리보기)은 저장된
HTML 을 그대로 그린다. 토큰이 브라우저 저장소에 있어 스크립트 한 줄이 곧 계정 탈취다.

모델 저장 직전(pre_save)에 정리한다. 뷰마다 붙이면 새 경로(일괄 처리·가져오기·협업 서버 저장·공개 API)
에서 반드시 빠진다. 화면에서도 한 번 더 정리한다(frontend/src/lib/sanitize-html.ts) — 이미 저장된 값 대비.

허용 목록은 에디터 스키마가 실제로 내보내는 HTML(schema_sample.html)을 한 글자도 바꾸지 않는지로
검증한다(tests.py). 노드를 추가했는데 그 테스트가 깨지면 여기 목록을 넓혀야 한다 — 안 그러면
저장할 때마다 그 서식이 조용히 지워진다.
"""
import nh3
from django.db.models.signals import pre_save

TAGS = set(nh3.ALLOWED_TAGS) | {"input", "label", "iframe", "video"}

ATTRIBUTES = {
    "*": {"class", "style", "title", "dir"},
    "a": {"href", "target", "rel", "download", "hreflang"},
    "img": {"src", "alt", "width", "height", "align"},
    "video": {"src", "controls", "preload"},
    "iframe": {"src"},
    "input": {"type", "checked", "disabled"},
    "ol": {"start", "type"},
    "th": {"colspan", "rowspan", "colwidth", "scope", "align"},
    "td": {"colspan", "rowspan", "colwidth", "align"},
    "col": {"span", "width"},
    "colgroup": {"span"},
    # TipTap 이 노드 속성을 그대로 찍어 내는 커스텀 블록들 (값은 글자일 뿐 브라우저가 해석하지 않는다)
    "div": {"kind", "open", "projectid", "viewmode", "filters", "height", "url", "description", "image",
            "items", "columns"},
    "blockquote": {"cite"},
}

URL_SCHEMES = {"http", "https", "mailto", "data"}


def _attribute_filter(tag, attr, value):
    if attr in ("href", "src"):
        lowered = value.strip().lower()
        if lowered.startswith("data:"):
            # 붙여 넣은 이미지는 data:image 로 들어온다. 그 밖의 data: (text/html 등)는 문서를 여는 통로다
            return value if tag == "img" and lowered.startswith("data:image/") and not lowered.startswith(
                "data:image/svg") else None
        if tag == "iframe" and not (lowered.startswith("/media/") or lowered.startswith("https://")):
            # PDF 미리보기용. 스킴 없는 상대 주소·http 로 같은 출처 페이지를 끼워 넣지 못하게
            return None
    if tag == "input" and attr == "type" and value.lower() != "checkbox":
        return None
    return value


def sanitize_html(html):
    if not html:
        return html
    return nh3.clean(
        html,
        tags=TAGS,
        clean_content_tags={"script", "style"},
        attributes=ATTRIBUTES,
        attribute_filter=_attribute_filter,
        generic_attribute_prefixes={"data-"},
        url_schemes=URL_SCHEMES,
        link_rel=None,
        strip_comments=False,  # 마크다운 반출이 되돌리기용 메타를 주석으로 싣는다(<!--orbitail:…-->)
    )


def _html_fields():
    from apps.documents.models import Document, DocumentTemplate, DocumentVersion
    from apps.issues.models import Issue, IssueComment, IssueRequest, IssueTemplate
    return {
        Issue: ("description_html",),
        IssueComment: ("comment_html",),
        IssueRequest: ("description_html",),
        IssueTemplate: ("description_html",),
        Document: ("content_html",),
        DocumentVersion: ("content_html",),
        DocumentTemplate: ("content_html",),
    }


def _make_handler(fields):
    def handler(sender, instance, update_fields=None, **kwargs):
        for field in fields:
            if update_fields is not None and field not in update_fields:
                continue
            value = getattr(instance, field, None)
            if value:
                setattr(instance, field, sanitize_html(value))
    return handler


_handlers = []


def connect():
    for model, fields in _html_fields().items():
        handler = _make_handler(fields)
        _handlers.append(handler)  # 약한 참조로 사라지지 않게 붙들어 둔다
        pre_save.connect(handler, sender=model, dispatch_uid=f"sanitize_html_{model.__name__}")
