from rest_framework import serializers

from .models import ApiToken


class ApiTokenSerializer(serializers.ModelSerializer):
    owner = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = ApiToken
        fields = [
            "id", "name", "prefix", "scope", "expires_at", "last_used_at",
            "created_at", "revoked_at", "owner", "status",
        ]

    def get_owner(self, obj):
        return {"id": str(obj.user_id), "display_name": obj.user.display_name, "email": obj.user.email}

    def get_status(self, obj):
        if obj.revoked_at is not None:
            return "revoked"
        if obj.is_expired:
            return "expired"
        return "active"


class ApiTokenCreateSerializer(serializers.Serializer):
    EXPIRY_CHOICES = (30, 90, 365)

    name = serializers.CharField(max_length=100)
    scope = serializers.ChoiceField(choices=ApiToken.Scope.choices, default=ApiToken.Scope.READ)
    # null = 만료 없음. 임의 일수를 받지 않는 이유: 목록에서 "언제 끊기나"를 한눈에 비교하기 쉽다
    expires_in_days = serializers.ChoiceField(choices=EXPIRY_CHOICES, allow_null=True, default=90)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value


class WebhookSerializer(serializers.ModelSerializer):
    created_by = serializers.SerializerMethodField()
    last_delivery = serializers.SerializerMethodField()

    class Meta:
        from .models import Webhook
        model = Webhook
        fields = [
            "id", "name", "url", "events", "is_active", "disabled_reason", "consecutive_failures",
            "created_by", "created_at", "last_delivery",
        ]

    def get_created_by(self, obj):
        return {"id": str(obj.created_by_id), "display_name": obj.created_by.display_name}

    def get_last_delivery(self, obj):
        d = obj.deliveries.order_by("-created_at").first()
        if d is None:
            return None
        return {"event": d.event, "status": d.status, "response_status": d.response_status, "created_at": d.created_at}


class WebhookWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100, required=False)
    url = serializers.URLField(max_length=500, required=False)
    events = serializers.ListField(child=serializers.CharField(), required=False, allow_empty=False)
    is_active = serializers.BooleanField(required=False)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate_url(self, value):
        from .webhook_http import WebhookTargetError, resolve_target
        try:
            resolve_target(value)
        except WebhookTargetError as exc:
            raise serializers.ValidationError(str(exc))
        return value

    def validate_events(self, value):
        from .models import Webhook
        allowed = set(Webhook.Event.values)
        unknown = [e for e in value if e not in allowed]
        if unknown:
            raise serializers.ValidationError(f"Unknown event: {', '.join(unknown)}")
        return sorted(set(value))


class WebhookDeliverySerializer(serializers.ModelSerializer):
    class Meta:
        from .models import WebhookDelivery
        model = WebhookDelivery
        fields = [
            "id", "event", "status", "attempts", "response_status", "response_body", "error",
            "created_at", "delivered_at", "payload",
        ]
