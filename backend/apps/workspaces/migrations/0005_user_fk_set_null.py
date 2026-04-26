"""User 삭제 시 콘텐츠 보존을 위해 owner/invited_by FK 를 CASCADE → SET_NULL 로 변경."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("workspaces", "0004_workspacejoinrequest"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="workspace",
            name="owner",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="owned_workspaces",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name="workspaceinvitation",
            name="invited_by",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="sent_invitations",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
