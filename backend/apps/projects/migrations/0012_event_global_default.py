# is_global 기본값 False → True 변경

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0010_project_member_perms'),
    ]

    operations = [
        migrations.AlterField(
            model_name='projectevent',
            name='is_global',
            field=models.BooleanField(default=True),
        ),
    ]
