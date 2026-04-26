"""
알림 모델 — 인앱 알림을 저장하는 단일 모델

알림 타입:
  - issue_assigned:  이슈에 담당자로 배정됨
  - issue_updated:   담당 이슈의 상태/우선순위 변경
  - comment_added:   담당 이슈에 새 댓글
  - issue_created:   프로젝트에 새 이슈가 생성됨 (프로젝트별 구독 옵션)
"""

import uuid
from django.conf import settings
from django.db import models


class Notification(models.Model):
    class Type(models.TextChoices):
        ISSUE_ASSIGNED = "issue_assigned", "Issue Assigned"
        ISSUE_UNASSIGNED = "issue_unassigned", "Issue Unassigned"
        ISSUE_UPDATED = "issue_updated", "Issue Updated"
        COMMENT_ADDED = "comment_added", "Comment Added"
        COMMENT_REPLIED = "comment_replied", "Comment Replied"
        ISSUE_CREATED = "issue_created", "Issue Created"
        MENTIONED = "mentioned", "Mentioned"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # 알림 수신자
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )

    # 알림을 발생시킨 사용자
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="triggered_notifications",
    )

    type = models.CharField(max_length=30, choices=Type.choices)

    # 관련 이슈 (nullable — 향후 이슈 외 알림 확장 가능)
    issue = models.ForeignKey(
        "issues.Issue",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notifications",
    )

    # 관련 워크스페이스 — 알림 목록 필터링용
    workspace = models.ForeignKey(
        "workspaces.Workspace",
        on_delete=models.CASCADE,
        related_name="notifications",
    )

    # 알림 메시지 (사람이 읽을 수 있는 요약)
    message = models.TextField()

    read = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["recipient", "-created_at"]),
            models.Index(fields=["recipient", "read"]),
            models.Index(fields=["recipient", "archived_at"]),
        ]

    def __str__(self):
        return f"[{self.type}] {self.recipient} ← {self.actor}: {self.message[:50]}"


class NotificationPreference(models.Model):
    """사용자별 전역 알림 환경설정 — 이메일 발송 마스터 토글 + 타입별 on/off.

    기본값:
      - email_enabled=True (마스터)
      - assigned/comment_added=True, issue_updated=False(노이즈)
    이메일이 실제로 발송되려면 마스터 + 해당 타입 둘 다 True 여야 함.
    레코드가 없으면 위 기본값으로 간주.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_preference",
        primary_key=True,
    )

    # 마스터 — 이메일 발송 자체를 끄는 스위치
    email_enabled = models.BooleanField(default=True)

    # 타입별 토글 — 인앱은 항상 생성되며, 이메일 발송 여부에만 영향
    email_issue_assigned = models.BooleanField(default=True)
    email_issue_updated = models.BooleanField(default=False)
    email_comment_added = models.BooleanField(default=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "notification_preferences"

    def email_allowed(self, ntype: str, project=None) -> bool:
        """전역 + 프로젝트별 prefs를 모두 고려.

        - 프로젝트 pref `muted=True` → 무조건 차단
        - 프로젝트 pref 의 타입별 override 가 명시되어 있으면 그것이 우선
        - 프로젝트 전용 타입(issue_created)은 프로젝트 pref만 보고 결정
        """
        if not self.email_enabled:
            return False

        # 프로젝트 전용 타입 — 전역 설정과 무관
        PROJECT_ONLY = {"issue_created"}

        proj_pref = None
        if project is not None:
            proj_pref = ProjectNotificationPreference.objects.filter(
                user_id=self.user_id, project=project,
            ).first()
            if proj_pref and proj_pref.muted:
                return False

        if ntype in PROJECT_ONLY:
            return bool(proj_pref and getattr(proj_pref, f"email_{ntype}", False))

        # 프로젝트 override 확인 — null 이면 전역 사용
        if proj_pref is not None:
            override = getattr(proj_pref, f"email_{ntype}", None)
            if override is not None:
                return bool(override)

        return bool(getattr(self, f"email_{ntype}", False))

    @classmethod
    def for_user(cls, user) -> "NotificationPreference":
        obj, _ = cls.objects.get_or_create(user=user)
        return obj


class ProjectNotificationPreference(models.Model):
    """사용자×프로젝트 알림 환경설정.

    - `muted=True` 면 해당 프로젝트의 모든 알림 메일을 받지 않음(전역과 무관)
    - 글로벌 타입(assigned/updated/comment) 은 NULL=상속 / True=강제ON / False=강제OFF
    - 프로젝트 전용 구독: `email_any_issue_created` (프로젝트의 새 이슈 알림)
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_notification_preferences",
    )
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="user_notification_preferences",
    )

    muted = models.BooleanField(default=False)

    # 글로벌 타입 override (NULL = 전역 설정 상속)
    email_issue_assigned = models.BooleanField(null=True, blank=True, default=None)
    email_issue_updated = models.BooleanField(null=True, blank=True, default=None)
    email_comment_added = models.BooleanField(null=True, blank=True, default=None)

    # 프로젝트 전용 구독 옵션 — 명시적 opt-in
    email_issue_created = models.BooleanField(default=False)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "project_notification_preferences"
        unique_together = [("user", "project")]
        indexes = [models.Index(fields=["project", "email_issue_created"])]

    @classmethod
    def for_user_project(cls, user, project) -> "ProjectNotificationPreference":
        obj, _ = cls.objects.get_or_create(user=user, project=project)
        return obj
