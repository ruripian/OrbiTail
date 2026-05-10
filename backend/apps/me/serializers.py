from rest_framework import serializers
from .models import PersonalEvent


class PersonalEventSerializer(serializers.ModelSerializer):
    workspace_slug = serializers.CharField(source="workspace.slug", read_only=True)

    class Meta:
        model = PersonalEvent
        fields = [
            "id", "title", "date", "end_date",
            "event_type", "color", "description",
            "workspace_slug",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "workspace_slug", "created_at", "updated_at"]
