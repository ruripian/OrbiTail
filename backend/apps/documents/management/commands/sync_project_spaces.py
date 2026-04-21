from django.core.management.base import BaseCommand

from apps.documents.signals import _ensure_space_for_project
from apps.projects.models import Project


class Command(BaseCommand):
    """프로젝트 전체를 순회하며 누락된 문서 스페이스를 생성하고 메타데이터를 동기화.

    사용처:
    - 초기 리빌드 후 누락 정합성 보정
    - 마이그레이션 이후 일괄 동기화
    - 디버깅용 수동 실행
    """
    help = "모든 프로젝트에 대해 project-type 문서 스페이스를 보장·동기화"

    def handle(self, *args, **options):
        created = updated = 0
        for project in Project.objects.all().iterator():
            before_exists = project.document_space is not None if hasattr(project, "document_space") else False
            _ensure_space_for_project(project)
            if before_exists:
                updated += 1
            else:
                created += 1
        self.stdout.write(self.style.SUCCESS(
            f"완료: 생성 {created} / 동기화 {updated}"
        ))
