import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Issue.module→category, Issue.cycle→sprint.
    projects.0007(RenameModel)보다 먼저 적용되어야 함.
    DB 컬럼은 이미 변경 완료. state만 업데이트."""

    dependencies = [
        ("issues", "0009_issue_archived_at"),
        ("projects", "0006_module_icon_prop"),  # 0007 전에 적용
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(model_name="Issue", name="module"),
                migrations.RemoveField(model_name="Issue", name="cycle"),
                migrations.AddField(
                    model_name="Issue",
                    name="category",
                    field=models.ForeignKey(
                        blank=True, null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="issues",
                        to="projects.module",
                    ),
                ),
                migrations.AddField(
                    model_name="Issue",
                    name="sprint",
                    field=models.ForeignKey(
                        blank=True, null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="issues",
                        to="projects.cycle",
                    ),
                ),
            ],
            database_operations=[],
        ),
    ]
