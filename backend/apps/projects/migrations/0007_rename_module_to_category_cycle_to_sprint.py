import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    """Module→Category, Cycle→Sprint 모델 리네이밍.
    issues.0010에서 FK target이 이미 갱신됨. DB는 이미 변경 완료."""

    dependencies = [
        ("projects", "0006_module_icon_prop"),
        ("issues", "0010_rename_module_to_category_cycle_to_sprint"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RenameModel(old_name="Module", new_name="Category"),
                migrations.RenameModel(old_name="Cycle", new_name="Sprint"),
                migrations.AlterField(
                    model_name="category",
                    name="project",
                    field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="categories", to="projects.project"),
                ),
                migrations.AlterField(
                    model_name="category",
                    name="lead",
                    field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="led_categories", to=settings.AUTH_USER_MODEL),
                ),
                migrations.AlterField(
                    model_name="sprint",
                    name="project",
                    field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sprints", to="projects.project"),
                ),
                migrations.AlterField(
                    model_name="sprint",
                    name="created_by",
                    field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_sprints", to=settings.AUTH_USER_MODEL),
                ),
            ],
            database_operations=[],
        ),
    ]
