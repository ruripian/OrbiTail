import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0012_event_global_default"),
    ]

    operations = [
        migrations.CreateModel(
            name="SavedFilter",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=100)),
                ("filters", models.JSONField(default=dict)),
                ("sort_order", models.FloatField(default=65535)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="saved_filters", to="projects.project")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="saved_filters", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "db_table": "saved_filters",
                "ordering": ["sort_order", "created_at"],
            },
        ),
    ]
