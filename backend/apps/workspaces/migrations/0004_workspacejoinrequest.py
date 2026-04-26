import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("workspaces", "0003_workspace_brand_color"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="WorkspaceJoinRequest",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("status", models.CharField(
                    choices=[("pending", "Pending"), ("approved", "Approved"),
                             ("rejected", "Rejected"), ("canceled", "Canceled")],
                    default="pending", max_length=10,
                )),
                ("message", models.TextField(blank=True, default="")),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("decided_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="decided_join_requests",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("user", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="join_requests",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("workspace", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="join_requests",
                    to="workspaces.workspace",
                )),
            ],
            options={
                "db_table": "workspace_join_requests",
                "ordering": ["-created_at"],
                "constraints": [models.UniqueConstraint(
                    condition=models.Q(("status", "pending")),
                    fields=("workspace", "user"),
                    name="unique_pending_join_request",
                )],
            },
        ),
    ]
