"""데모 배포용 전역 공지를 심는다.

공지(Announcement)는 워크스페이스가 아니라 서비스 전체에 걸리는 모델이라
샌드박스마다 만들면 다른 방문자에게도 보이고 계속 쌓인다. 그래서 샌드박스
시드에서는 제외하고, 배포 시 이 커맨드로 한 번만 심는다.

멱등하다. 다시 돌리면 이 커맨드가 심었던 것을 지우고 새로 만든다.

Usage:
    docker compose exec backend python manage.py seed_demo_announcements
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import Announcement

User = get_user_model()

ENTRIES = [
    dict(
        title="OrbiTail 데모에 오신 것을 환영합니다",
        version="v0.1.0",
        category=Announcement.Category.NOTICE,
        body=(
            "이 화면은 둘러보기용 데모입니다. 지금 보고 계신 워크스페이스는 "
            "방문자마다 따로 만들어지며, 무엇을 바꾸거나 지워도 다른 사람에게는 "
            "영향이 없습니다. 하루가 지나면 자동으로 사라집니다."
        ),
    ),
    dict(
        title="캘린더·타임라인 개편",
        version="v0.1.0",
        category=Announcement.Category.FEATURE,
        body=(
            "캘린더가 프로젝트 전역 일정과 사용자별 필터를 지원합니다. "
            "타임라인은 배율을 바꿔도 보고 있던 위치를 유지합니다."
        ),
    ),
    dict(
        title="데모에서 막혀 있는 기능",
        version="",
        category=Announcement.Category.NOTICE,
        body=(
            "공개 데모라서 관리자 콘솔, 파일 업로드, 메일 발송은 사용할 수 없습니다. "
            "그 외 이슈·문서·스프린트 기능은 자유롭게 써 보셔도 됩니다."
        ),
    ),
]

MARKER = "[demo-seed]"


class Command(BaseCommand):
    help = "데모 배포용 전역 공지를 심는다 (멱등)."

    def handle(self, *args, **opts):
        author = User.objects.filter(is_superuser=True).order_by("created_at").first()
        if author is None:
            raise CommandError(
                "슈퍼유저가 없습니다. 초기 설정(/api/setup/)을 먼저 마친 뒤 실행하세요."
            )

        # 이 커맨드가 심은 것만 지운다. 손으로 쓴 공지는 건드리지 않는다.
        removed, _ = Announcement.objects.filter(body__endswith=MARKER).delete()

        for entry in ENTRIES:
            Announcement.objects.create(
                created_by=author,
                is_published=True,
                **{**entry, "body": f"{entry['body']}\n\n{MARKER}"},
            )

        self.stdout.write(self.style.SUCCESS(
            f"공지 {len(ENTRIES)}건 생성 (이전 {removed}건 정리, 작성자: {author.email})"
        ))
