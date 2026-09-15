from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.api"

    def ready(self):
        from . import schema, signals  # noqa: F401 — import 되는 것만으로 등록된다
