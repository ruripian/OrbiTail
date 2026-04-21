import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("issues", "0010_rename_module_to_category_cycle_to_sprint"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="IssueNodeLink",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    "link_type",
                    models.CharField(
                        choices=[
                            ("relates_to", "Relates to"),
                            ("blocks", "Blocks"),
                            ("blocked_by", "Blocked by"),
                            ("duplicates", "Duplicates"),
                            ("references", "References"),
                        ],
                        default="relates_to",
                        max_length=20,
                    ),
                ),
                ("note", models.CharField(blank=True, default="", max_length=500)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_node_links",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "source",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="outgoing_node_links",
                        to="issues.issue",
                    ),
                ),
                (
                    "target",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="incoming_node_links",
                        to="issues.issue",
                    ),
                ),
            ],
            options={
                "db_table": "issue_node_links",
                "ordering": ["-created_at"],
                "unique_together": {("source", "target", "link_type")},
            },
        ),
    ]
