# Generated for OrbiTail event participants + global flag

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0008_add_category_sort_order'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='projectevent',
            name='is_global',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='projectevent',
            name='participants',
            field=models.ManyToManyField(
                blank=True,
                related_name='participating_events',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
