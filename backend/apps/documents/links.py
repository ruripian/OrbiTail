"""문서 본문에서 문서→문서 링크를 뽑아 DocumentLink 에 반영한다.

본문(content_html)에 박힌 문서 멘션만이 문서 사이 연결의 원본이다. 그걸 테이블로
꺼내 두어야 백링크·그래프·깨진 링크 같은 "링크를 거꾸로 또는 통째로 보는 일"이 가능해진다.
"""

import hashlib
import re

# 우리가 renderHTML 로 직접 찍어내는 형태만 찾으면 되므로 HTML 파서를 들이지 않는다.
_MENTION_TAG_RE = re.compile(r"<span\b[^>]*\bdata-mention\b[^>]*>", re.IGNORECASE)
_KIND_RE = re.compile(r'data-kind="([^"]*)"', re.IGNORECASE)
_ID_RE = re.compile(r'data-id="([^"]*)"', re.IGNORECASE)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


def extract_doc_links(html: str) -> set[str]:
    """본문에서 문서 멘션이 가리키는 문서 id 집합을 뽑는다."""
    ids: set[str] = set()
    for tag in _MENTION_TAG_RE.findall(html or ""):
        kind = _KIND_RE.search(tag)
        if not kind or kind.group(1).lower() != "doc":
            continue
        found = _ID_RE.search(tag)
        # UUID 모양이 아니면 버린다 — 손으로 붙여 넣은 HTML 이 FK 조회까지 가지 않게
        if found and _UUID_RE.match(found.group(1)):
            ids.add(found.group(1).lower())
    return ids


def links_fingerprint(ids) -> str:
    return hashlib.sha1(",".join(sorted(ids)).encode()).hexdigest()


def sync_document_links(doc) -> bool:
    """문서가 내보내는 링크를 본문과 일치시킨다. 실제로 바꿨으면 True.

    본문 저장은 편집 중 2초마다 들어온다. 매번 다시 쓰면 문서 하나를 고치는 동안
    delete+insert 가 수십 번 난다 — 뽑아낸 집합의 지문을 문서에 적어 두고 달라졌을 때만 손댄다.

    지문 갱신을 맨 마지막에 두는 것이 중요하다. 중간에 실패하면 지문이 옛 값으로 남아
    다음 저장 때 다시 시도된다(스스로 복구된다).
    """
    from .models import Document, DocumentLink

    targets = extract_doc_links(doc.content_html)
    targets.discard(str(doc.id))  # 자기 자신을 가리키는 링크는 그래프에 의미가 없다

    fingerprint = links_fingerprint(targets)
    if fingerprint == (doc.links_hash or ""):
        return False

    # 실재하는 문서만 남긴다. 소프트 삭제된 문서는 일부러 포함한다 — 그래야 깨진 링크로 보인다.
    # 같은 워크스페이스의 문서만 — 아무 id 나 본문에 넣어 다른 워크스페이스 문서를 링크 테이블에
    # 올린 뒤 백링크·깨진 링크로 그 제목을 읽어 내지 못하게
    valid = set(
        str(v) for v in Document.objects.filter(
            id__in=targets, space__workspace_id=doc.space.workspace_id,
        ).values_list("id", flat=True)
    )

    DocumentLink.objects.filter(source=doc).delete()
    if valid:
        DocumentLink.objects.bulk_create(
            [DocumentLink(source=doc, target_id=t) for t in valid],
            ignore_conflicts=True,
        )

    Document.objects.filter(pk=doc.pk).update(links_hash=fingerprint)
    doc.links_hash = fingerprint
    return True
