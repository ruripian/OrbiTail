"""
기본 내장 문서 템플릿 시드 — 회의록, 기술 스펙, RFC, 주간 보고, 프로젝트 킥오프.

Idempotent: 같은 이름의 built_in 템플릿이 있으면 내용만 업데이트.
실행: docker compose exec backend python manage.py seed_document_templates
"""
from django.core.management.base import BaseCommand

from apps.documents.models import DocumentTemplate


TEMPLATES = [
    {
        "name": "회의록",
        "description": "일자·참석자·안건·결정사항·액션 아이템 구조",
        "icon_prop": {"emoji": "📝"},
        "sort_order": 1,
        "content_html": """
<h1>회의록</h1>
<p><strong>일시:</strong> </p>
<p><strong>장소/링크:</strong> </p>
<p><strong>참석자:</strong> </p>
<hr>
<h2>안건</h2>
<ol><li></li></ol>
<h2>논의 내용</h2>
<h3>1. </h3>
<p></p>
<h2>결정사항</h2>
<ul><li></li></ul>
<h2>액션 아이템</h2>
<ul class="task-list"><li><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>
<h2>다음 회의</h2>
<p></p>
""",
    },
    {
        "name": "기술 스펙",
        "description": "배경·목표·설계·트레이드오프·마일스톤",
        "icon_prop": {"emoji": "⚙️"},
        "sort_order": 2,
        "content_html": """
<h1>기술 스펙: </h1>
<p><em>작성자: · 작성일: · 상태: Draft</em></p>
<h2>배경</h2>
<p>이 스펙이 풀려 하는 문제는 무엇인가?</p>
<h2>목표</h2>
<ul><li></li></ul>
<h2>비목표 (Non-goals)</h2>
<ul><li></li></ul>
<h2>설계</h2>
<h3>아키텍처</h3>
<p></p>
<h3>데이터 모델</h3>
<p></p>
<h3>API</h3>
<p></p>
<h2>트레이드오프 / 대안</h2>
<p></p>
<h2>마일스톤</h2>
<ul class="task-list"><li><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>
<h2>오픈 이슈</h2>
<ul><li></li></ul>
""",
    },
    {
        "name": "RFC",
        "description": "제안·동기·상세안·채택 기준·피드백",
        "icon_prop": {"emoji": "📄"},
        "sort_order": 3,
        "content_html": """
<h1>RFC-XXXX: </h1>
<p><strong>작성자:</strong>  · <strong>상태:</strong> Proposed</p>
<h2>요약</h2>
<p></p>
<h2>동기</h2>
<p>왜 이 변경이 필요한가? 현재 어떤 문제가 있는가?</p>
<h2>상세 제안</h2>
<p></p>
<h2>대안 검토</h2>
<p></p>
<h2>영향 / 리스크</h2>
<ul><li></li></ul>
<h2>채택 기준</h2>
<ul class="task-list"><li><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>
<h2>피드백</h2>
<p></p>
""",
    },
    {
        "name": "주간 보고",
        "description": "이번 주 한 일·다음 주 할 일·막힌 점",
        "icon_prop": {"emoji": "📊"},
        "sort_order": 4,
        "content_html": """
<h1>주간 보고: W</h1>
<p><strong>기간:</strong>  ~ </p>
<h2>이번 주 한 일</h2>
<ul><li></li></ul>
<h2>다음 주 계획</h2>
<ul><li></li></ul>
<h2>블로커 / 도움 필요</h2>
<ul><li></li></ul>
<h2>지표</h2>
<p></p>
<h2>메모</h2>
<p></p>
""",
    },
    {
        "name": "프로젝트 킥오프",
        "description": "목표·범위·팀·일정·리스크",
        "icon_prop": {"emoji": "🚀"},
        "sort_order": 5,
        "content_html": """
<h1>프로젝트 킥오프: </h1>
<h2>목표</h2>
<p>프로젝트 한 문장 요약과 성공 기준.</p>
<h2>범위</h2>
<h3>포함</h3>
<ul><li></li></ul>
<h3>제외</h3>
<ul><li></li></ul>
<h2>팀</h2>
<ul>
  <li><strong>PM:</strong> </li>
  <li><strong>Tech Lead:</strong> </li>
  <li><strong>Design:</strong> </li>
</ul>
<h2>일정</h2>
<p></p>
<h2>리스크 / 대응</h2>
<ul><li></li></ul>
<h2>의사결정 로그</h2>
<p></p>
""",
    },
    {
        "name": "빈 페이지",
        "description": "빈 문서로 시작 (템플릿 없음)",
        "icon_prop": {"emoji": "📄"},
        "sort_order": 0,
        "content_html": "<p></p>",
    },
]


class Command(BaseCommand):
    help = "Seed built-in document templates (idempotent)."

    def handle(self, *args, **opts):
        created, updated = 0, 0
        for spec in TEMPLATES:
            obj, was_created = DocumentTemplate.objects.update_or_create(
                scope=DocumentTemplate.Scope.BUILT_IN,
                name=spec["name"],
                defaults={
                    "description": spec["description"],
                    "icon_prop": spec["icon_prop"],
                    "content_html": spec["content_html"].strip(),
                    "sort_order": spec["sort_order"],
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1
        self.stdout.write(self.style.SUCCESS(
            f"Templates: {created} created, {updated} updated, {DocumentTemplate.objects.filter(scope=DocumentTemplate.Scope.BUILT_IN).count()} built-in total."
        ))
