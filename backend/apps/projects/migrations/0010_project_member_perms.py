# Generated for OrbiTail granular project permissions

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0009_add_event_participants_and_global'),
    ]

    operations = [
        migrations.AddField(
            model_name='projectmember',
            name='can_edit',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='projectmember',
            name='can_archive',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='projectmember',
            name='can_delete',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='projectmember',
            name='can_purge',
            field=models.BooleanField(default=False),
        ),
    ]
