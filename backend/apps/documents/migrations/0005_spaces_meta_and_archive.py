from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0004_documentattachment_documentcomment"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="documentspace",
            name="archived_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="documentspace",
            name="icon_prop",
            field=models.JSONField(blank=True, default=None, null=True),
        ),
        migrations.AddField(
            model_name="documentspace",
            name="identifier",
            field=models.CharField(blank=True, default="", max_length=24),
        ),
        migrations.AddField(
            model_name="documentspace",
            name="members",
            field=models.ManyToManyField(
                blank=True,
                related_name="document_space_memberships",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
