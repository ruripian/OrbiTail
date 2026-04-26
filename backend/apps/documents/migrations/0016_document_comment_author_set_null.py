"""DocumentComment.author CASCADE → SET_NULL — User 삭제 시 댓글은 익명으로 보존."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0015_documentbookmark"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="documentcomment",
            name="author",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="document_comments",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
