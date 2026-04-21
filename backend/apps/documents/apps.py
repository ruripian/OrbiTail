from django.apps import AppConfig
from django.db.models.signals import post_migrate


def _sync_project_spaces_after_migrate(sender, **kwargs):
    """마이그레이션 이후 누락된 프로젝트 스페이스를 자동 복구.

    운영 환경에서 rebuild/마이그레이션 적용 후 기존 프로젝트에 스페이스가 누락된 경우
    별도 명령 실행 없이 일관성을 맞추기 위한 안전망.
    """
    if sender.name != "apps.documents":
        return
    try:
        from apps.projects.models import Project
        from apps.documents.signals import _ensure_space_for_project
        for project in Project.objects.all().iterator():
            _ensure_space_for_project(project)
    except Exception:
        # 초기 마이그레이션 중 모델이 아직 준비되지 않은 경우 등은 조용히 skip
        pass


class DocumentsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.documents"

    def ready(self):
        import apps.documents.signals  # noqa: F401
        post_migrate.connect(_sync_project_spaces_after_migrate, sender=self)
