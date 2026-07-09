from rest_framework import serializers
from .models import PersonalEvent


class PersonalEventSerializer(serializers.ModelSerializer):
    workspace_slug = serializers.CharField(source="workspace.slug", read_only=True)

    class Meta:
        model = PersonalEvent
        fields = [
            "id", "title", "date", "end_date",
            "event_type", "color", "description",
            "shared_with_team", "user",
            "workspace_slug",
            "created_at", "updated_at",
        ]
        # user(소유자)는 팀 캘린더에서 멤버 필터 판별용으로만 노출 — 생성 시엔 뷰가 request.user 지정.
        read_only_fields = ["id", "user", "workspace_slug", "created_at", "updated_at"]
