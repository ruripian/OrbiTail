from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("issues", "0012_issuerequest"),
    ]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="is_field",
            field=models.BooleanField(default=False),
        ),
    ]
