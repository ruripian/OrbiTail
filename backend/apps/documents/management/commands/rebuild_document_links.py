"""기존 문서의 본문에서 문서→문서 링크를 다시 뽑아 DocumentLink 를 채운다.

링크 테이블이 생기기 전에 쓰인 문서들은 본문에 멘션이 있어도 링크 행이 없다.
그대로 두면 백링크 패널이 "없음"으로 보여 기능이 고장 난 것처럼 읽힌다 —
배포 직후 한 번 돌려서 과거 문서를 따라잡게 한다. 여러 번 돌려도 안전하다.
"""

from django.core.management.base import BaseCommand

from apps.documents.links import sync_document_links
from apps.documents.models import Document


class Command(BaseCommand):
    help = "본문의 문서 멘션에서 DocumentLink 를 재구축한다"

    def add_arguments(self, parser):
        parser.add_argument(
            "--space", help="특정 스페이스 id 만 (생략하면 전체)", default=None,
        )

    def handle(self, *args, **options):
        qs = Document.objects.filter(is_folder=False)
        if options["space"]:
            qs = qs.filter(space_id=options["space"])

        changed = 0
        total = qs.count()
        for doc in qs.iterator():
            if sync_document_links(doc):
                changed += 1
        self.stdout.write(self.style.SUCCESS(f"문서 {total}건 확인, {changed}건 링크 갱신"))
