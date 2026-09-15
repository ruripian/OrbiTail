from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.api"

    def ready(self):
        from . import schema  # noqa: F401 — 스키마 확장은 import 되는 것만으로 등록된다
