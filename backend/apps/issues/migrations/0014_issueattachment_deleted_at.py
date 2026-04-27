from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("issues", "0013_issue_is_field"),
    ]

    operations = [
        migrations.AddField(
            model_name="issueattachment",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
