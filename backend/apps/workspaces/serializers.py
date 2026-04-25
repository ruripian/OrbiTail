from rest_framework import serializers
from apps.accounts.serializers import UserSerializer
from .models import Workspace, WorkspaceMember, WorkspaceInvitation


class WorkspaceMemberSerializer(serializers.ModelSerializer):
    member = UserSerializer(read_only=True)

    class Meta:
        model = WorkspaceMember
        fields = ["id", "member", "role", "created_at"]


class WorkspaceSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = ["id", "name", "slug", "logo", "owner", "member_count", "priority_colors", "brand_color", "created_at"]
        read_only_fields = ["id", "owner", "created_at"]

    def get_member_count(self, obj):
        return obj.members.count()

    def create(self, validated_data):
        workspace = Workspace.objects.create(
            owner=self.context["request"].user, **validated_data
        )
        WorkspaceMember.objects.create(
            workspace=workspace,
            member=self.context["request"].user,
            role=WorkspaceMember.Role.OWNER,
        )
        return workspace


class WorkspaceInvitationSerializer(serializers.ModelSerializer):
    """초대 목록 조회용 — invited_by 상세 포함"""
    invited_by = UserSerializer(read_only=True)
    workspace_name = serializers.CharField(source="workspace.name", read_only=True)

    class Meta:
        model = WorkspaceInvitation
        fields = [
            "id", "workspace", "workspace_name", "email", "token",
            "role", "invited_by", "status", "message", "expires_at", "created_at",
        ]
        read_only_fields = ["id", "token", "invited_by", "status", "expires_at", "created_at"]


class WorkspaceInvitationCreateSerializer(serializers.Serializer):
    """초대 발송용 — email + role + message"""
    email = serializers.EmailField()
    role = serializers.ChoiceField(
        choices=WorkspaceMember.Role.choices, default=WorkspaceMember.Role.MEMBER
    )
    message = serializers.CharField(required=False, default="")
