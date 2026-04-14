from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import User, Announcement


class UserSerializer(serializers.ModelSerializer):
    """공용 사용자 직렬화기 — 리스트 응답에도 쓰이므로 N+1 유발 필드는 금지."""

    class Meta:
        model = User
        fields = [
            "id", "email", "display_name", "first_name", "last_name",
            "avatar",
            "is_staff", "is_superuser", "is_approved", "is_email_verified",
            "is_suspended",
            "timezone", "language",
            "first_day_of_week", "theme", "created_at",
        ]
        read_only_fields = [
            "id", "email", "is_staff", "is_superuser", "is_approved",
            "is_email_verified", "is_suspended", "created_at",
        ]


class MeSerializer(UserSerializer):
    """`/api/auth/me/` 전용 — 현재 사용자에 한해 워크스페이스 관리자 여부를 계산해 포함."""

    is_workspace_admin = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ["is_workspace_admin"]
        read_only_fields = UserSerializer.Meta.read_only_fields + ["is_workspace_admin"]

    def get_is_workspace_admin(self, obj) -> bool:
        from apps.workspaces.models import WorkspaceMember
        return WorkspaceMember.objects.filter(
            member=obj, role__gte=WorkspaceMember.Role.ADMIN,
        ).exists()


class AdminUserSerializer(UserSerializer):
    """관리자 페이지 전용 — 마지막 로그인, 활성화 여부, 가입일까지 포함"""

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ["is_active", "last_login", "deleted_at"]
        read_only_fields = UserSerializer.Meta.read_only_fields + ["last_login", "deleted_at"]


class AnnouncementSerializer(serializers.ModelSerializer):
    created_by_detail = UserSerializer(source="created_by", read_only=True)

    class Meta:
        model = Announcement
        fields = [
            "id", "title", "body", "version", "category",
            "is_published", "created_by", "created_by_detail",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["email", "display_name", "first_name", "last_name", "password"]

    def validate_password(self, value):
        """Django AUTH_PASSWORD_VALIDATORS 전체 적용 (복잡도 포함)"""
        validate_password(value)
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = MeSerializer(self.user).data
        return data


class PasswordChangeSerializer(serializers.Serializer):
    """비밀번호 변경 — 현재 비밀번호 확인 후 새 비밀번호로 교체"""
    current_password = serializers.CharField()
    new_password = serializers.CharField(min_length=8)

    def validate_new_password(self, value):
        validate_password(value)
        return value


class EmailChangeRequestSerializer(serializers.Serializer):
    """이메일 변경 요청 — 새 이메일 중복 체크 후 인증 메일 발송"""
    new_email = serializers.EmailField()

    def validate_new_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("이미 사용 중인 이메일입니다.")
        return value


class EmailChangeVerifySerializer(serializers.Serializer):
    """이메일 변경 토큰 검증"""
    token = serializers.UUIDField()


class VerifyEmailSerializer(serializers.Serializer):
    """회원가입 후 초기 이메일 인증 토큰 검증"""
    token = serializers.UUIDField()


class PasswordResetRequestSerializer(serializers.Serializer):
    """비밀번호 찾기 — 인증 메일 발송 (이메일 존재 여부를 노출하지 않음)"""
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    """비밀번호 찾기 — 토큰 검증 및 새 비밀번호 설정"""
    token = serializers.UUIDField()
    new_password = serializers.CharField(min_length=8)

    def validate_new_password(self, value):
        validate_password(value)
        return value
