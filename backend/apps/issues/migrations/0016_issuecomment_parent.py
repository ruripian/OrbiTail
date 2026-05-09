from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("issues", "0015_field_state_clear"),
    ]

    operations = [
        migrations.AddField(
            model_name="issuecomment",
            name="parent",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="replies",
                to="issues.issuecomment",
            ),
        ),
    ]
