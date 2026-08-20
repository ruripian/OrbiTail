"""데모 워크스페이스 생성기.

`seed_demo` 관리 커맨드와 데모 모드 샌드박스(apps.demo)가 함께 쓴다.
워크스페이스 이름·슬러그·구성원·포함할 프로젝트를 파라미터로 받아
같은 구조를 반복 생성할 수 있게 한 것이 커맨드 시절과의 유일한 차이다.

멱등성은 그대로다. 같은 슬러그로 다시 돌리면 그 워크스페이스의
프로젝트를 지우고 새로 만든다. 다른 워크스페이스는 건드리지 않는다.
"""
from __future__ import annotations

from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Announcement, User
from apps.issues.models import Issue, Label
from apps.projects.models import (
    Category,
    Project,
    ProjectEvent,
    ProjectMember,
    Sprint,
    State,
)
from apps.workspaces.models import Workspace, WorkspaceMember


DEFAULT_WORKSPACE_NAME = "Nimbus Studio"
DEFAULT_WORKSPACE_SLUG = "nimbus"
DEFAULT_PASSWORD = "nimbus1234!"

DEFAULT_USERS = [
    # (email, display_name, ws_role)
    ("daniel@nimbus.studio", "Daniel Kim",  WorkspaceMember.Role.OWNER),
    ("sarah@nimbus.studio",  "Sarah Lee",   WorkspaceMember.Role.ADMIN),
    ("jake@nimbus.studio",   "Jake Park",   WorkspaceMember.Role.MEMBER),
    ("yuna@nimbus.studio",   "Yuna Choi",   WorkspaceMember.Role.MEMBER),
    ("minjae@nimbus.studio", "Minjae Jung", WorkspaceMember.Role.MEMBER),
    ("sophie@nimbus.studio", "Sophie Han",  WorkspaceMember.Role.MEMBER),
]

DEFAULT_STATES = [
    {"name": "Backlog",     "color": "#A3A3A3", "group": State.Group.BACKLOG,   "sequence": 1, "default": True},
    {"name": "Todo",        "color": "#F0AD4E", "group": State.Group.UNSTARTED, "sequence": 2},
    {"name": "In Progress", "color": "#5E6AD2", "group": State.Group.STARTED,   "sequence": 3},
    {"name": "Done",        "color": "#26B55E", "group": State.Group.COMPLETED, "sequence": 4},
    {"name": "Cancelled",   "color": "#D94F4F", "group": State.Group.CANCELLED, "sequence": 5},
]


class DemoSeeder:
    """워크스페이스 하나를 데모 데이터로 채운다.

    users 는 (email, display_name, WorkspaceMember.Role) 튜플 목록이며
    첫 번째가 소유자가 된다. projects 로 만들 프로젝트를 고른다.
    """

    PROJECT_BUILDERS = ("aurora", "meteor", "archive")

    def __init__(
        self,
        *,
        workspace_name=DEFAULT_WORKSPACE_NAME,
        workspace_slug=DEFAULT_WORKSPACE_SLUG,
        users=DEFAULT_USERS,
        password=DEFAULT_PASSWORD,
        projects=PROJECT_BUILDERS,
        with_announcements=True,
        log=None,
    ):
        self.workspace_name = workspace_name
        self.workspace_slug = workspace_slug
        self.users_spec = list(users)
        self.password = password
        self.projects = tuple(projects)
        self.with_announcements = with_announcements
        self._log_fn = log

    def _log(self, message):
        if self._log_fn:
            self._log_fn(message)

    def run(self):
        """워크스페이스를 만들고 (workspace, users) 를 돌려준다."""
        today = timezone.localdate()
        builders = {
            "aurora": self._seed_aurora,
            "meteor": self._seed_meteor,
            "archive": self._seed_archive,
        }
        with transaction.atomic():
            users = self._seed_users()
            workspace = self._seed_workspace(users[0])
            self._seed_members(workspace, users)
            self._wipe_projects(workspace)
            for key in self.projects:
                builders[key](workspace, users, today)
            if self.with_announcements:
                self._seed_announcements(users[0])
        self._log(f"seeded {self.workspace_name} ({self.workspace_slug})")
        return workspace, users

    # -- users ---------------------------------------------------------------

    def _seed_users(self) -> list[User]:
        created: list[User] = []
        for email, display_name, _role in self.users_spec:
            user, was_new = User.objects.get_or_create(
                email=email,
                defaults={
                    "display_name": display_name,
                    "is_active": True,
                    "is_email_verified": True,
                    "is_approved": True,
                    "language": "en",
                },
            )
            if was_new:
                user.set_password(self.password)
                user.save()
            else:
                # keep name in sync in case it drifted
                if user.display_name != display_name:
                    user.display_name = display_name
                    user.save(update_fields=["display_name"])
            created.append(user)
            self._log(f"  user: {email} ({'new' if was_new else 'existing'})")
        return created

    # -- workspace -----------------------------------------------------------

    def _seed_workspace(self, owner: User) -> Workspace:
        ws, _ = Workspace.objects.get_or_create(
            slug=self.workspace_slug,
            defaults={"name": self.workspace_name, "owner": owner},
        )
        if ws.owner_id != owner.id or ws.name != self.workspace_name:
            ws.owner = owner
            ws.name = self.workspace_name
            ws.save()
        return ws

    def _seed_members(self, ws: Workspace, users: list[User]):
        for user, (_, _, role) in zip(users, self.users_spec):
            WorkspaceMember.objects.update_or_create(
                workspace=ws, member=user, defaults={"role": role},
            )

    # -- wipe ----------------------------------------------------------------

    def _wipe_projects(self, ws: Workspace):
        """Remove all projects under Nimbus so we can rebuild idempotently."""
        # Cascading: deletes issues, states, categories, sprints, events, members.
        ws.projects.all().delete()
        self._log("  wiped existing Nimbus projects")

    # -- project: Aurora -----------------------------------------------------

    def _seed_aurora(self, ws: Workspace, users: list[User], today: date) -> Project:
        daniel, sarah, jake, yuna, minjae, sophie = users
        project = Project.objects.create(
            name="Aurora",
            identifier="AUR",
            description="Mobile app revamp — onboarding, auth, push notifications.",
            workspace=ws,
            network=Project.Network.PUBLIC,
            created_by=daniel,
            lead=sarah,
            icon_prop={"emoji": "🌌"},
        )
        states = self._create_states(project)
        self._seed_project_members(project, users, {
            sarah.id:  (ProjectMember.Role.ADMIN,  True,  True,  True,  True),
            jake.id:   (ProjectMember.Role.MEMBER, True,  True,  True,  False),
            yuna.id:   (ProjectMember.Role.MEMBER, True,  False, False, False),
            minjae.id: (ProjectMember.Role.VIEWER, False, False, False, False),
            sophie.id: (ProjectMember.Role.MEMBER, True,  True,  False, False),
        })

        # Labels
        labels = {
            name: Label.objects.create(project=project, name=name, color=color)
            for name, color in [
                ("bug",         "#D94F4F"),
                ("feature",     "#5E6AD2"),
                ("enhancement", "#26B55E"),
                ("design",      "#F06EBD"),
                ("backend",     "#F0AD4E"),
                ("frontend",    "#26C3D9"),
            ]
        }

        # Categories
        design_cat = Category.objects.create(
            project=project, name="Design", status=Category.Status.ACTIVE,
            lead=sarah, icon_prop={"name": "Palette", "color": "#F06EBD"},
            start_date=today - timedelta(days=10),
            target_date=today + timedelta(days=14),
            sort_order=1,
        )
        eng_cat = Category.objects.create(
            project=project, name="Engineering", status=Category.Status.ACTIVE,
            lead=jake, icon_prop={"name": "Code", "color": "#5E6AD2"},
            start_date=today - timedelta(days=5),
            target_date=today + timedelta(days=21),
            sort_order=2,
        )
        qa_cat = Category.objects.create(
            project=project, name="QA", status=Category.Status.BACKLOG,
            lead=sophie, icon_prop={"name": "CheckCircle", "color": "#26B55E"},
            start_date=today + timedelta(days=14),
            target_date=today + timedelta(days=28),
            sort_order=3,
        )

        # Sprint
        sprint = Sprint.objects.create(
            project=project, name="Sprint 1 — Onboarding",
            description="First sprint covering onboarding and auth flows.",
            status=Sprint.Status.ACTIVE,
            start_date=today - timedelta(days=5),
            end_date=today + timedelta(days=9),
            created_by=daniel,
        )

        # Issues — varied state/priority/date/assignee mix
        S = {s.name: s for s in states}
        specs = [
            dict(title="Redesign onboarding screens",
                 state=S["In Progress"], priority=Issue.Priority.HIGH,
                 assignees=[sarah, yuna], labels=["design", "frontend"],
                 category=design_cat, sprint=sprint,
                 start_date=today - timedelta(days=4), due_date=today + timedelta(days=7),
                 estimate_point=5, created_by=sarah),
            dict(title="Wire login API",
                 state=S["Done"], priority=Issue.Priority.MEDIUM,
                 assignees=[jake], labels=["backend"],
                 category=eng_cat, sprint=sprint,
                 start_date=today - timedelta(days=8), due_date=today - timedelta(days=3),
                 estimate_point=3, created_by=jake),
            dict(title="Push notification permission flow",
                 state=S["In Progress"], priority=Issue.Priority.HIGH,
                 assignees=[yuna], labels=["feature", "frontend"],
                 category=eng_cat, sprint=sprint,
                 start_date=today - timedelta(days=2), due_date=today + timedelta(days=9),
                 estimate_point=5, created_by=yuna),
            dict(title="App icon A/B test",
                 state=S["Todo"], priority=Issue.Priority.LOW,
                 assignees=[sophie], labels=["design"],
                 category=design_cat,
                 start_date=today + timedelta(days=5), due_date=today + timedelta(days=12),
                 estimate_point=2, created_by=sophie),
            dict(title="Investigate 0.3% crash on launch",
                 state=S["In Progress"], priority=Issue.Priority.URGENT,
                 assignees=[daniel, jake], labels=["bug", "backend"],
                 category=eng_cat, sprint=sprint,
                 start_date=today, due_date=today + timedelta(days=1),
                 estimate_point=3, created_by=daniel),
            dict(title="Onboarding copy review",
                 state=S["Backlog"], priority=Issue.Priority.NONE,
                 assignees=[sarah], labels=["design"],
                 category=design_cat,
                 created_by=sarah),  # no dates — filter showcase
            dict(title="Splash screen animation",
                 state=S["In Progress"], priority=Issue.Priority.MEDIUM,
                 assignees=[jake], labels=["frontend", "enhancement"],
                 category=design_cat, sprint=sprint,
                 start_date=today + timedelta(days=1), due_date=today + timedelta(days=1),
                 estimate_point=2, created_by=jake),  # single-day timeline bar
            dict(title="Biometric login support",
                 state=S["Todo"], priority=Issue.Priority.HIGH,
                 assignees=[jake, minjae], labels=["feature", "backend"],
                 category=eng_cat,
                 start_date=today + timedelta(days=10), due_date=today + timedelta(days=20),
                 estimate_point=8, created_by=jake),
            dict(title="Accessibility audit",
                 state=S["Backlog"], priority=Issue.Priority.MEDIUM,
                 assignees=[yuna, sophie], labels=["enhancement"],
                 category=qa_cat,
                 start_date=today + timedelta(days=14), due_date=today + timedelta(days=25),
                 estimate_point=5, created_by=yuna),
            dict(title="Analytics event schema",
                 state=S["Done"], priority=Issue.Priority.MEDIUM,
                 assignees=[daniel], labels=["backend"],
                 category=eng_cat,
                 start_date=today - timedelta(days=14), due_date=today - timedelta(days=7),
                 estimate_point=3, created_by=daniel),
            dict(title="Dark mode polish",
                 state=S["Todo"], priority=Issue.Priority.LOW,
                 assignees=[sarah], labels=["design", "frontend"],
                 category=design_cat,
                 start_date=today + timedelta(days=3), due_date=today + timedelta(days=8),
                 estimate_point=2, created_by=sarah),
            dict(title="Crash analytics dashboard",
                 state=S["Cancelled"], priority=Issue.Priority.LOW,
                 assignees=[minjae], labels=["backend"],
                 category=eng_cat,
                 created_by=minjae),
            dict(title="Release checklist automation",
                 state=S["Todo"], priority=Issue.Priority.MEDIUM,
                 assignees=[sophie, sarah], labels=["enhancement"],
                 category=qa_cat,
                 start_date=today + timedelta(days=16), due_date=today + timedelta(days=22),
                 estimate_point=3, created_by=sophie),
            dict(title="iOS 18 compatibility pass",
                 state=S["Backlog"], priority=Issue.Priority.HIGH,
                 assignees=[jake], labels=["bug", "frontend"],
                 category=eng_cat,
                 start_date=today + timedelta(days=18), due_date=today + timedelta(days=30),
                 estimate_point=5, created_by=jake),
            dict(title="Empty state illustrations",
                 state=S["In Progress"], priority=Issue.Priority.LOW,
                 assignees=[sarah], labels=["design"],
                 category=design_cat,
                 start_date=today - timedelta(days=1), due_date=today + timedelta(days=5),
                 estimate_point=2, created_by=sarah),
        ]
        for spec in specs:
            self._create_issue(project, ws, spec, labels)

        # Project events — calendar/timeline
        self._seed_aurora_events(project, users, today)
        return project

    def _seed_aurora_events(self, project: Project, users: list[User], today: date):
        daniel, sarah, jake, yuna, minjae, sophie = users
        monday = today - timedelta(days=today.weekday())  # this week's Monday

        events = [
            dict(title="Sprint planning",   date=monday, end_date=None,
                 event_type=ProjectEvent.EventType.MEETING, color="#5E6AD2",
                 is_global=True, participants=users, created_by=daniel,
                 description="Weekly sprint planning. Recurring Mondays 10:00."),
            dict(title="Design review",     date=today + timedelta(days=2), end_date=None,
                 event_type=ProjectEvent.EventType.MEETING, color="#F06EBD",
                 is_global=False, participants=[sarah, yuna], created_by=sarah,
                 description="Review of onboarding flow mockups."),
            dict(title="Backend sync",      date=today + timedelta(days=3), end_date=None,
                 event_type=ProjectEvent.EventType.MEETING, color="#F0AD4E",
                 is_global=False, participants=[jake, daniel], created_by=jake,
                 description="Auth + analytics backend sync."),
            dict(title="Company all-hands", date=today + timedelta(days=4), end_date=None,
                 event_type=ProjectEvent.EventType.MEETING, color="#26C3D9",
                 is_global=True, participants=users, created_by=daniel,
                 description="Monthly all-hands."),
            dict(title="QA dry run",        date=today + timedelta(days=6), end_date=today + timedelta(days=7),
                 event_type=ProjectEvent.EventType.MILESTONE, color="#26B55E",
                 is_global=False, participants=[sophie, yuna], created_by=sophie,
                 description="End-to-end QA pass before beta."),
            dict(title="Beta release",      date=today + timedelta(days=14), end_date=None,
                 event_type=ProjectEvent.EventType.DEADLINE, color="#D94F4F",
                 is_global=True, participants=users, created_by=daniel,
                 description="Aurora beta build to TestFlight."),
        ]
        for ev in events:
            participants = ev.pop("participants")
            obj = ProjectEvent.objects.create(project=project, **ev)
            obj.participants.set(participants)

    # -- project: Meteor -----------------------------------------------------

    def _seed_meteor(self, ws: Workspace, users: list[User], today: date) -> Project:
        daniel, sarah, jake, yuna, minjae, sophie = users
        project = Project.objects.create(
            name="Meteor",
            identifier="MET",
            description="Backend migration from legacy monolith to modular services.",
            workspace=ws,
            network=Project.Network.PUBLIC,
            created_by=daniel,
            lead=jake,
            icon_prop={"emoji": "☄️"},
        )
        states = self._create_states(project)
        S = {s.name: s for s in states}
        self._seed_project_members(project, users, {
            jake.id:   (ProjectMember.Role.ADMIN,  True, True, True, True),
            daniel.id: (ProjectMember.Role.ADMIN,  True, True, True, True),
            minjae.id: (ProjectMember.Role.MEMBER, True, False, False, False),
        })

        labels = {
            name: Label.objects.create(project=project, name=name, color=color)
            for name, color in [
                ("infra",    "#F0AD4E"),
                ("database", "#5E6AD2"),
                ("api",      "#26B55E"),
                ("tech-debt","#A3A3A3"),
            ]
        }

        specs = [
            dict(title="Extract billing service",
                 state=S["In Progress"], priority=Issue.Priority.HIGH,
                 assignees=[jake], labels=["api"],
                 start_date=today - timedelta(days=10), due_date=today + timedelta(days=10),
                 estimate_point=8, created_by=jake),
            dict(title="Postgres 16 upgrade",
                 state=S["Todo"], priority=Issue.Priority.MEDIUM,
                 assignees=[daniel, minjae], labels=["database", "infra"],
                 start_date=today + timedelta(days=7), due_date=today + timedelta(days=21),
                 estimate_point=5, created_by=daniel),
            dict(title="Deprecate v1 API endpoints",
                 state=S["Backlog"], priority=Issue.Priority.LOW,
                 assignees=[jake], labels=["api", "tech-debt"],
                 start_date=today + timedelta(days=20), due_date=today + timedelta(days=45),
                 estimate_point=5, created_by=jake),
            dict(title="Background job queue rework",
                 state=S["Done"], priority=Issue.Priority.HIGH,
                 assignees=[minjae], labels=["infra"],
                 start_date=today - timedelta(days=25), due_date=today - timedelta(days=12),
                 estimate_point=8, created_by=minjae),
        ]
        for spec in specs:
            self._create_issue(project, ws, spec, labels)
        return project

    # -- project: Archive ----------------------------------------------------

    def _seed_archive(self, ws: Workspace, users: list[User], today: date) -> Project:
        daniel = users[0]
        project = Project.objects.create(
            name="Archive 2025",
            identifier="ARC",
            description="Shipped in 2025 — kept for reference.",
            workspace=ws,
            network=Project.Network.SECRET,
            created_by=daniel,
            lead=daniel,
            icon_prop={"emoji": "📦"},
            archived_at=timezone.now(),
        )
        self._create_states(project)
        self._seed_project_members(project, users, {})
        return project

    # -- helpers -------------------------------------------------------------

    def _create_states(self, project: Project) -> list[State]:
        return [State.objects.create(project=project, **s) for s in DEFAULT_STATES]

    def _seed_project_members(self, project: Project, users: list[User], overrides: dict):
        """Create ProjectMember rows. `overrides` maps user_id -> (role, edit, archive, delete, purge)."""
        # The creator's ADMIN row already exists via serializer logic? No — we use ORM directly.
        # Add every workspace user so they all show in UI; overrides decides perms.
        for u in users:
            role, can_edit, can_archive, can_delete, can_purge = overrides.get(
                u.id, (ProjectMember.Role.MEMBER, True, False, False, False),
            )
            ProjectMember.objects.create(
                project=project, member=u, role=role,
                can_edit=can_edit, can_archive=can_archive,
                can_delete=can_delete, can_purge=can_purge,
            )

    def _create_issue(self, project: Project, ws: Workspace, spec: dict, labels: dict):
        assignees = spec.pop("assignees", [])
        label_names = spec.pop("labels", [])
        issue = Issue.objects.create(project=project, workspace=ws, **spec)
        if assignees:
            issue.assignees.set(assignees)
        if label_names:
            issue.label.set([labels[n] for n in label_names if n in labels])
        return issue

    # -- announcements -------------------------------------------------------

    def _seed_announcements(self, staff_user: User):
        if not staff_user.is_staff:
            staff_user.is_staff = True
            staff_user.save(update_fields=["is_staff"])

        Announcement.objects.filter(created_by=staff_user, version__startswith="v0.").delete()

        entries = [
            dict(
                title="Welcome to OrbiTail",
                version="v0.1.0",
                category=Announcement.Category.NOTICE,
                body="Thanks for joining the beta. This workspace is pre-populated with demo data so you can explore every feature.",
            ),
            dict(
                title="Calendar & timeline overhaul",
                version="v0.1.0",
                category=Announcement.Category.FEATURE,
                body="Calendar now supports project-wide events, per-user filters, and dynamic row heights. Timeline preserves your viewport on scale change.",
            ),
            dict(
                title="Scheduled maintenance this week",
                version="",
                category=Announcement.Category.NOTICE,
                body="We will run a short DB maintenance window on Saturday. Expect ~5 minutes of read-only mode.",
            ),
        ]
        for e in entries:
            Announcement.objects.create(created_by=staff_user, is_published=True, **e)
