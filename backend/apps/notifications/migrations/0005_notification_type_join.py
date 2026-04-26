"""Notification.Type — workspace 가입 신청/승인/거절 타입 추가."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0004_notification_archived_at_alter_notification_type_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="notification",
            name="type",
            field=models.CharField(
                max_length=30,
                choices=[
                    ("issue_assigned", "Issue Assigned"),
                    ("issue_unassigned", "Issue Unassigned"),
                    ("issue_updated", "Issue Updated"),
                    ("comment_added", "Comment Added"),
                    ("comment_replied", "Comment Replied"),
                    ("issue_created", "Issue Created"),
                    ("mentioned", "Mentioned"),
                    ("join_requested", "Workspace Join Requested"),
                    ("join_approved", "Workspace Join Approved"),
                    ("join_rejected", "Workspace Join Rejected"),
                ],
            ),
        ),
    ]
