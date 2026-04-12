import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="NotificationPreference",
            fields=[
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="notification_preference",
                        serialize=False,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("email_enabled", models.BooleanField(default=True)),
                ("email_issue_assigned", models.BooleanField(default=True)),
                ("email_issue_updated", models.BooleanField(default=False)),
                ("email_comment_added", models.BooleanField(default=True)),
                ("email_mentioned", models.BooleanField(default=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "notification_preferences",
            },
        ),
    ]
