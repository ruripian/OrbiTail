from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0015_project_request_review_policy"),
    ]

    operations = [
        migrations.AddField(
            model_name="projectmember",
            name="can_schedule",
            field=models.BooleanField(default=True),
        ),
    ]
