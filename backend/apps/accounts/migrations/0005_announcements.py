# Generated for OrbiTail announcements

import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0004_user_deleted_at'),
    ]

    operations = [
        migrations.CreateModel(
            name='Announcement',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('title', models.CharField(max_length=255)),
                ('body', models.TextField()),
                ('version', models.CharField(blank=True, default='', max_length=32)),
                ('category', models.CharField(
                    choices=[
                        ('feature', '신규 기능'),
                        ('improvement', '개선'),
                        ('bugfix', '버그 수정'),
                        ('notice', '공지'),
                    ],
                    default='notice',
                    max_length=20,
                )),
                ('is_published', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(
                    null=True,
                    on_delete=models.SET_NULL,
                    related_name='created_announcements',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'db_table': 'announcements',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddField(
            model_name='user',
            name='last_seen_announcement',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.SET_NULL,
                related_name='+',
                to='accounts.announcement',
            ),
        ),
    ]
