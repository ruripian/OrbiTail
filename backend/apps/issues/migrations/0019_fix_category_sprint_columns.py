"""0010 이 상태만 바꾸고 실제 컬럼은 그대로 둔 것을 바로잡는다.

0010(rename_module_to_category_cycle_to_sprint)은 SeparateDatabaseAndState 로
Issue.module→category, Issue.cycle→sprint 를 Django 상태에만 반영하고
database_operations 를 비워뒀다. 당시 작업 DB 는 컬럼명을 수동으로 바꿔둔
상태였기 때문인데, 그 사실이 마이그레이션에 남지 않았다.

그래서 마이그레이션만으로 구축한 DB 에는 module_id / cycle_id 가 그대로
남아 있고, Django 는 category_id / sprint_id 를 조회한다. Django 는 이슈를
읽을 때 모든 구체 필드를 SELECT 하므로 이슈를 한 건만 조회해도
ProgrammingError: column issues.category_id does not exist 가 난다.
즉 신규 설치에서는 이슈 기능이 통째로 동작하지 않는다.

이미 새 이름을 가진 DB(0010 당시의 작업 머신)도 존재하므로, 컬럼이 실제로
있는지 확인한 뒤에만 바꾼다. 어느 쪽 상태에서 시작하든 결과는 같다.
"""
from django.db import migrations


RENAMES = [("module_id", "category_id"), ("cycle_id", "sprint_id")]
TABLE = "issues"


def _rename(cursor, table, old, new):
    """old 가 있고 new 가 없을 때만 바꾼다. 그 외에는 아무것도 하지 않는다."""
    cursor.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = %s "
        "AND column_name IN (%s, %s)",
        [table, old, new],
    )
    present = {row[0] for row in cursor.fetchall()}
    if old in present and new not in present:
        cursor.execute(f'ALTER TABLE "{table}" RENAME COLUMN "{old}" TO "{new}"')


def forward(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        for old, new in RENAMES:
            _rename(cursor, TABLE, old, new)


def backward(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        for old, new in RENAMES:
            _rename(cursor, TABLE, new, old)


class Migration(migrations.Migration):

    dependencies = [
        ("issues", "0018_issue_shared_with_team"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
