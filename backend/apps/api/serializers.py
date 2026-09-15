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
            raise serializers.ValidationError("이름을 입력하세요.")
        return value
