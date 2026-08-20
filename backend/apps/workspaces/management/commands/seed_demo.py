"""Nimbus Studio 데모 워크스페이스를 시드한다 (위키 스크린샷용).

실제 생성 로직은 apps.workspaces.seeding.DemoSeeder 에 있다.
데모 모드의 방문자 샌드박스도 같은 생성기를 쓴다.

Usage:
    docker compose exec backend python manage.py seed_demo
"""
from django.core.management.base import BaseCommand

from apps.workspaces.seeding import (
    DEFAULT_PASSWORD,
    DEFAULT_WORKSPACE_NAME,
    DEFAULT_WORKSPACE_SLUG,
    DemoSeeder,
)


class Command(BaseCommand):
    help = "Seed the Nimbus Studio demo workspace for wiki screenshots."

    def handle(self, *args, **opts):
        DemoSeeder(log=lambda m: self.stdout.write(f"  {m}")).run()
        self.stdout.write(self.style.SUCCESS(
            f"Seeded {DEFAULT_WORKSPACE_NAME} ({DEFAULT_WORKSPACE_SLUG}) — "
            f"login with any user @nimbus.studio / {DEFAULT_PASSWORD}"
        ))
