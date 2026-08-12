"""Personal 프로젝트("내 이슈") 기본 상태 색상을 일반 프로젝트 팔레트에 맞춘다.

기존에 Personal 프로젝트는 별도 팔레트로 생성돼 Todo·In Progress 색이 일반 프로젝트와
반대였다(주황 ↔ 보라). Backlog 도 슬레이트 톤이라 달랐다.

사용자가 직접 색을 바꾼 상태는 보존해야 하므로, **옛 기본값과 정확히 일치하는 색만**
새 팔레트로 교체한다. 그 외 색은 커스터마이즈로 간주하고 손대지 않는다.
"""

from django.db import migrations


# (group, 옛 Personal 기본색, 새 공용 팔레트색)
# Done/Cancelled 는 원래부터 같아서 대상 아님.
_COLOR_FIXES = [
    ("backlog",   "#94a3b8", "#A3A3A3"),
    ("unstarted", "#5E6AD2", "#F0AD4E"),
    ("started",   "#F0AD4E", "#5E6AD2"),
]


def _apply(apps, reverse=False):
    State = apps.get_model("projects", "State")
    for group, old, new in _COLOR_FIXES:
        src, dst = (new, old) if reverse else (old, new)
        # group 으로 좁히므로 unstarted↔started 스왑끼리 서로 덮어쓰지 않는다
        State.objects.filter(
            project__kind="personal",
            group=group,
            color=src,
        ).update(color=dst)


def forwards(apps, schema_editor):
    _apply(apps)


def backwards(apps, schema_editor):
    _apply(apps, reverse=True)


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0018_project_kind_project_owner_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
