from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0001_initial"),
    ]

    operations = [
        migrations.RemoveField(model_name="document", name="icon"),
        migrations.AddField(
            model_name="document",
            name="icon_prop",
            field=models.JSONField(blank=True, default=None, null=True),
        ),
    ]
