import uuid
from django.db import models
from django.conf import settings


class PersonalEvent(models.Model):
    """개인 일정 — 본인만 보는 캘린더 일정.

    프로젝트 캘린더(ProjectEvent)와 달리 워크스페이스/프로젝트와 독립적이며,
    본인만 CRUD. 마이 페이지의 캘린더 탭에서 ProjectEvent 와 함께 통합 표시된다.
    """

    class EventType(models.TextChoices):
        TASK     = "task",     "할 일"
        MEETING  = "meeting",  "회의"
        DEADLINE = "deadline", "마감"
        REMINDER = "reminder", "알림"
        OTHER    = "other",    "기타"

    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user        = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="personal_events",
    )
    title       = models.CharField(max_length=255)
    date        = models.DateField()
    end_date    = models.DateField(null=True, blank=True)
    event_type  = models.CharField(max_length=20, choices=EventType.choices, default=EventType.OTHER)
    color       = models.CharField(max_length=7, default="#5E6AD2")
    description = models.TextField(blank=True, default="")
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "personal_events"
        ordering = ["date"]
        indexes = [
            models.Index(fields=["user", "date"]),
        ]

    def __str__(self):
        return f"{self.user_id} — {self.title} @ {self.date}"
