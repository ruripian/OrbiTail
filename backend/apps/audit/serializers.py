from rest_framework import serializers
from apps.accounts.serializers import UserSerializer
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_detail = UserSerializer(source="actor", read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "id", "actor", "actor_detail", "actor_label", "action",
            "target_type", "target_id", "target_label", "metadata", "created_at",
        ]
        read_only_fields = fields
