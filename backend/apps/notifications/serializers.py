from rest_framework import serializers
from apps.accounts.serializers import UserSerializer
from .models import Notification, NotificationPreference, ProjectNotificationPreference


class NotificationSerializer(serializers.ModelSerializer):
    actor_detail = UserSerializer(source="actor", read_only=True)

    # 이슈 요약 정보 (전체 시리얼라이저 사용 시 순환 참조 위험 → 인라인 정의)
    issue_title = serializers.CharField(source="issue.title", read_only=True, default=None)
    issue_sequence_id = serializers.IntegerField(source="issue.sequence_id", read_only=True, default=None)
    project_id = serializers.UUIDField(source="issue.project_id", read_only=True, default=None)
    project_identifier = serializers.CharField(source="issue.project.identifier", read_only=True, default=None)

    class Meta:
        model = Notification
        fields = [
            "id", "type", "message", "read",
            "actor", "actor_detail",
            "issue", "issue_title", "issue_sequence_id",
            "project_id", "project_identifier",
            "workspace", "created_at",
        ]
        read_only_fields = [
            "id", "type", "message", "actor", "issue",
            "workspace", "created_at",
        ]


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = [
            "email_enabled",
            "email_issue_assigned",
            "email_issue_updated",
            "email_comment_added",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]


class ProjectNotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectNotificationPreference
        fields = [
            "muted",
            "email_issue_assigned",
            "email_issue_updated",
            "email_comment_added",
            "email_issue_created",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]
