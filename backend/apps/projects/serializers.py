from rest_framework import serializers
from apps.accounts.serializers import UserSerializer
from .models import Project, ProjectMember, Category, Sprint, State, ProjectEvent


class ProjectEventSerializer(serializers.ModelSerializer):
    """프로젝트 캘린더 이벤트 serializer — 프론트 렌더 + CRUD 공통."""
    created_by_detail = UserSerializer(source="created_by", read_only=True)

    class Meta:
        model = ProjectEvent
        fields = [
            "id", "project", "title", "date", "end_date",
            "event_type", "color", "description",
            "created_by", "created_by_detail",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "project", "created_by", "created_at", "updated_at"]

    def validate(self, attrs):
        """end_date가 date보다 앞서면 안됨"""
        date = attrs.get("date") or (self.instance and self.instance.date)
        end_date = attrs.get("end_date")
        if end_date and date and end_date < date:
            raise serializers.ValidationError({"end_date": "종료일은 시작일보다 이후여야 합니다."})
        return attrs


class StateSerializer(serializers.ModelSerializer):
    class Meta:
        model = State
        fields = ["id", "name", "color", "group", "sequence", "default"]


class ProjectSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    # lead는 쓰기 시 user id(UUID)만 받고, 읽기 시 lead_detail로 전체 User 정보 반환
    lead_detail = UserSerializer(source="lead", read_only=True)
    state_count = serializers.SerializerMethodField()
    is_member = serializers.SerializerMethodField()
    user_role = serializers.SerializerMethodField()
    # 초기 참여자 목록 — 생성 시에만 사용 (write-only). 생성자/리더는 자동 추가되므로 제외 가능
    member_ids = serializers.ListField(
        child=serializers.UUIDField(),
        write_only=True,
        required=False,
        default=list,
        help_text="생성 시 초기 멤버로 등록할 워크스페이스 멤버의 user id 목록(MEMBER 역할로 추가)",
    )

    class Meta:
        model = Project
        fields = [
            "id", "name", "identifier", "description",
            "workspace", "network", "icon_prop",
            "created_by", "lead", "lead_detail", "state_count",
            "is_member", "user_role",
            "member_ids",
            "archived_at", "auto_archive_days",
            "created_at",
        ]
        # workspace와 created_by는 view의 perform_create에서 URL/인증 정보로 주입
        read_only_fields = ["id", "workspace", "created_by", "created_at", "archived_at"]

    def get_state_count(self, obj):
        return obj.states.count()

    def get_is_member(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        return ProjectMember.objects.filter(project=obj, member=request.user).exists()

    def get_user_role(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        pm = ProjectMember.objects.filter(project=obj, member=request.user).first()
        return pm.role if pm else None

    def validate_lead(self, value):
        """lead로 지정하려는 유저가 해당 워크스페이스 멤버인지 검증.

        - 생성(create) 시에는 workspace가 아직 validated_data에 없으므로,
          view의 perform_create에서 주입되는 workspace를 context로 받는다.
        - 수정(update) 시에는 self.instance.workspace를 사용한다.
        """
        if value is None:
            return value

        # workspace 확보 — update 시 instance에서, create 시 context에서
        workspace = None
        if self.instance is not None:
            workspace = self.instance.workspace
        else:
            workspace = self.context.get("workspace")

        if workspace is not None:
            from apps.workspaces.models import WorkspaceMember
            is_member = WorkspaceMember.objects.filter(
                workspace=workspace, member=value,
            ).exists()
            if not is_member:
                raise serializers.ValidationError(
                    "리더는 해당 워크스페이스 멤버여야 합니다."
                )
        return value

    def create(self, validated_data):
        # workspace, created_by는 serializer.save(workspace=..., created_by=...) 로 전달됨
        # 초기 멤버 id 목록 분리 (모델 필드가 아님)
        member_ids = validated_data.pop("member_ids", [])

        # lead가 비어 있으면 생성자 본인을 기본 리더로 세팅
        if not validated_data.get("lead"):
            validated_data["lead"] = validated_data.get("created_by")

        project = Project.objects.create(**validated_data)

        # 기본 5개 상태 자동 생성
        default_states = [
            {"name": "Backlog",     "color": "#A3A3A3", "group": State.Group.BACKLOG,    "sequence": 1, "default": True},
            {"name": "Todo",        "color": "#F0AD4E", "group": State.Group.UNSTARTED,  "sequence": 2},
            {"name": "In Progress", "color": "#5E6AD2", "group": State.Group.STARTED,    "sequence": 3},
            {"name": "Done",        "color": "#26B55E", "group": State.Group.COMPLETED,  "sequence": 4},
            {"name": "Cancelled",   "color": "#D94F4F", "group": State.Group.CANCELLED,  "sequence": 5},
        ]
        for state_data in default_states:
            State.objects.create(project=project, **state_data)

        # 생성자를 Admin으로 멤버 등록
        ProjectMember.objects.create(
            project=project,
            member=validated_data["created_by"],
            role=ProjectMember.Role.ADMIN,
        )

        # 리더가 생성자와 다른 사람이면 리더도 Admin으로 멤버 등록(권한 보장)
        lead_user = validated_data.get("lead")
        if lead_user and lead_user != validated_data["created_by"]:
            ProjectMember.objects.get_or_create(
                project=project,
                member=lead_user,
                defaults={"role": ProjectMember.Role.ADMIN},
            )

        # 초기 멤버 등록 — 워크스페이스 멤버인 유저만 MEMBER 역할로 추가
        if member_ids:
            from apps.workspaces.models import WorkspaceMember
            from apps.accounts.models import User
            workspace = validated_data["workspace"]
            ws_member_ids = set(
                WorkspaceMember.objects.filter(workspace=workspace)
                .values_list("member_id", flat=True)
            )
            valid_users = User.objects.filter(
                id__in=[mid for mid in member_ids if mid in ws_member_ids]
            )
            for user in valid_users:
                ProjectMember.objects.get_or_create(
                    project=project, member=user,
                    defaults={"role": ProjectMember.Role.MEMBER},
                )
        return project

    def update(self, instance, validated_data):
        """lead가 바뀌면 신규 리더가 ADMIN 멤버로 등록돼 있는지 보장."""
        new_lead = validated_data.get("lead", instance.lead)
        project = super().update(instance, validated_data)
        if new_lead is not None:
            pm, _ = ProjectMember.objects.get_or_create(
                project=project,
                member=new_lead,
                defaults={"role": ProjectMember.Role.ADMIN},
            )
            # 기존 멤버인데 Admin이 아니면 Admin으로 승격
            if pm.role != ProjectMember.Role.ADMIN:
                pm.role = ProjectMember.Role.ADMIN
                pm.save(update_fields=["role"])
        return project


class ProjectMemberSerializer(serializers.ModelSerializer):
    member = UserSerializer(read_only=True)

    class Meta:
        model = ProjectMember
        fields = ["id", "member", "role", "created_at"]


class ProjectMemberCreateSerializer(serializers.Serializer):
    """프로젝트 멤버 추가 시 사용 — member_id로 User를 지정"""
    member_id = serializers.UUIDField()
    role = serializers.ChoiceField(
        choices=ProjectMember.Role.choices,
        default=ProjectMember.Role.MEMBER,
    )


class CategorySerializer(serializers.ModelSerializer):
    lead_detail = UserSerializer(source="lead", read_only=True)
    issue_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = [
            "id", "name", "description", "icon_prop", "status",
            "lead", "lead_detail",
            "start_date", "target_date",
            "sort_order", "issue_count", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_issue_count(self, obj):
        return obj.issues.filter(deleted_at__isnull=True).count()


class SprintSerializer(serializers.ModelSerializer):
    created_by_detail = UserSerializer(source="created_by", read_only=True)
    issue_count = serializers.SerializerMethodField()

    class Meta:
        model = Sprint
        fields = [
            "id", "name", "description", "status",
            "start_date", "end_date",
            "created_by", "created_by_detail",
            "issue_count", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def get_issue_count(self, obj):
        return obj.issues.filter(deleted_at__isnull=True).count()
