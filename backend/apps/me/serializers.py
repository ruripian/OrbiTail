from rest_framework import serializers
from .models import PersonalEvent


class PersonalEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = PersonalEvent
        fields = [
            "id", "title", "date", "end_date",
            "event_type", "color", "description",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
