from rest_framework import serializers
from apps.accounts.serializers import UserSerializer
from .models import Workspace, WorkspaceMember, WorkspaceInvitation, WorkspaceJoinRequest, Team, TeamMember


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
        fields = [
            "id", "name", "slug", "description", "logo", "owner", "member_count",
            "priority_colors", "brand_color", "created_at",
        ]
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


class TeamMemberSerializer(serializers.ModelSerializer):
    """팀 멤버 — 다른 도메인 패턴(WorkspaceMemberSerializer) 와 동일하게 member nested."""
    member = UserSerializer(read_only=True)
    added_by = UserSerializer(read_only=True)

    class Meta:
        model = TeamMember
        fields = ["id", "member", "role", "added_by", "created_at"]
        read_only_fields = ["id", "added_by", "created_at"]


class TeamSerializer(serializers.ModelSerializer):
    """팀 — 목록/상세 공용. members 는 nested(상세 응답 시), member_count 는 항상."""
    created_by = UserSerializer(read_only=True)
    member_count = serializers.SerializerMethodField()
    # 본인의 팀 역할 — 사이드바/페이지에서 admin 액션 노출 분기용
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = [
            "id", "workspace", "name", "description", "color", "icon_prop",
            "created_by", "member_count", "my_role",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "workspace", "created_by", "created_at", "updated_at"]

    def get_member_count(self, obj):
        return obj.members.count()

    def get_my_role(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        tm = obj.members.filter(member=request.user).only("role").first()
        return tm.role if tm else None


class WorkspaceJoinRequestSerializer(serializers.ModelSerializer):
    """가입 신청 — 사용자 본인 조회 + 어드민 조회 공용"""
    user = UserSerializer(read_only=True)
    decided_by = UserSerializer(read_only=True)
    workspace_name = serializers.CharField(source="workspace.name", read_only=True)
    workspace_slug = serializers.CharField(source="workspace.slug", read_only=True)

    class Meta:
        model = WorkspaceJoinRequest
        fields = [
            "id", "workspace", "workspace_name", "workspace_slug",
            "user", "status", "message",
            "decided_by", "decided_at", "created_at",
        ]
        read_only_fields = [
            "id", "workspace", "user", "status",
            "decided_by", "decided_at", "created_at",
        ]
