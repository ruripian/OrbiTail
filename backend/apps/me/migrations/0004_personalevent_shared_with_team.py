from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('me', '0003_personalevent_workspace_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='personalevent',
            name='shared_with_team',
            field=models.BooleanField(default=False),
        ),
    ]
