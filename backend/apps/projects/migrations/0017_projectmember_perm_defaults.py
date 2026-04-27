from django.db import migrations, models


class Migration(migrations.Migration):
    """can_archive, can_delete 기본값 True 로 변경 (영구 삭제는 그대로 False).
    기존 멤버에게는 영향 없음 — default 만 변경. 새 멤버부터 적용."""

    dependencies = [
        ("projects", "0016_projectmember_can_schedule"),
    ]

    operations = [
        migrations.AlterField(
            model_name="projectmember",
            name="can_archive",
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name="projectmember",
            name="can_delete",
            field=models.BooleanField(default=True),
        ),
    ]
