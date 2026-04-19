import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("workspaces", "0002_workspaceinvitation"),
        ("projects", "0013_saved_filter"),
        ("issues", "0004_issue_soft_delete"),
    ]

    operations = [
        migrations.CreateModel(
            name="DocumentSpace",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=200)),
                ("icon", models.CharField(blank=True, default="", max_length=10)),
                ("description", models.TextField(blank=True, default="")),
                ("space_type", models.CharField(choices=[("project", "Project"), ("personal", "Personal"), ("shared", "Shared")], default="shared", max_length=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="document_spaces", to="workspaces.workspace")),
                ("project", models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="document_space", to="projects.project")),
                ("owner", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="personal_spaces", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "db_table": "document_spaces",
                "ordering": ["space_type", "name"],
            },
        ),
        migrations.CreateModel(
            name="Document",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(default="제목 없음", max_length=500)),
                ("icon", models.CharField(blank=True, default="", max_length=10)),
                ("content_html", models.TextField(blank=True, default="")),
                ("yjs_state", models.BinaryField(blank=True, null=True)),
                ("is_folder", models.BooleanField(default=False)),
                ("sort_order", models.FloatField(default=65535)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("space", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="documents", to="documents.documentspace")),
                ("parent", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="children", to="documents.document")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_documents", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "db_table": "documents",
                "ordering": ["-is_folder", "sort_order", "created_at"],
                "indexes": [
                    models.Index(fields=["space", "parent", "sort_order"], name="documents_space_parent_sort_idx"),
                    models.Index(fields=["space", "deleted_at"], name="documents_space_deleted_idx"),
                ],
            },
        ),
        migrations.CreateModel(
            name="DocumentIssueLink",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("document", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="issue_links", to="documents.document")),
                ("issue", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="document_links", to="issues.issue")),
            ],
            options={
                "db_table": "document_issue_links",
                "unique_together": {("document", "issue")},
            },
        ),
        migrations.CreateModel(
            name="DocumentVersion",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("version_number", models.IntegerField()),
                ("title", models.CharField(max_length=500)),
                ("content_html", models.TextField()),
                ("yjs_state", models.BinaryField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("document", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="versions", to="documents.document")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "db_table": "document_versions",
                "ordering": ["-version_number"],
                "unique_together": {("document", "version_number")},
            },
        ),
    ]
