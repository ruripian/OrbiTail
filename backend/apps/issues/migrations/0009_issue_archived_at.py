from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("issues", "0008_issuetemplate"),
    ]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="archived_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
