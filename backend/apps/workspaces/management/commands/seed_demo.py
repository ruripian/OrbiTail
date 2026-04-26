"""Seed the `Nimbus Studio` demo workspace for wiki screenshots.

Idempotent: rerun wipes the Nimbus workspace's projects/issues/events and
rebuilds from scratch. Other workspaces are untouched.

Usage:
    docker compose exec backend python manage.py seed_demo
"""
from __future__ import annotations

from datetime import date, timedelta

from django.core.management.base import BaseCommand
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


WORKSPACE_NAME = "Nimbus Studio"
WORKSPACE_SLUG = "nimbus"
DEFAULT_PASSWORD = "nimbus1234!"

USERS = [
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


class Command(BaseCommand):
    help = "Seed the Nimbus Studio demo workspace for wiki screenshots."

    def handle(self, *args, **opts):
        today = timezone.localdate()
        with transaction.atomic():
            users = self._seed_users()
            workspace = self._seed_workspace(users[0])
            self._seed_members(workspace, users)
            self._wipe_projects(workspace)
            aurora  = self._seed_aurora(workspace, users, today)
            meteor  = self._seed_meteor(workspace, users, today)
            archive = self._seed_archive(workspace, users, today)
            self._seed_announcements(users[0])
        self.stdout.write(self.style.SUCCESS(
            f"Seeded {WORKSPACE_NAME} ({WORKSPACE_SLUG}) — login with any user @nimbus.studio / {DEFAULT_PASSWORD}"
        ))

    # -- users ---------------------------------------------------------------

    def _seed_users(self) -> list[User]:
        created: list[User] = []
        for email, display_name, _role in USERS:
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
                user.set_password(DEFAULT_PASSWORD)
                user.save()
            else:
                # keep name in sync in case it drifted
                if user.display_name != display_name:
                    user.display_name = display_name
                    user.save(update_fields=["display_name"])
            created.append(user)
            self.stdout.write(f"  user: {email} ({'new' if was_new else 'existing'})")
        return created

    # -- workspace -----------------------------------------------------------

    def _seed_workspace(self, owner: User) -> Workspace:
        ws, _ = Workspace.objects.get_or_create(
            slug=WORKSPACE_SLUG,
            defaults={"name": WORKSPACE_NAME, "owner": owner},
        )
        if ws.owner_id != owner.id or ws.name != WORKSPACE_NAME:
            ws.owner = owner
            ws.name = WORKSPACE_NAME
            ws.save()
        return ws

    def _seed_members(self, ws: Workspace, users: list[User]):
        for user, (_, _, role) in zip(users, USERS):
            WorkspaceMember.objects.update_or_create(
                workspace=ws, member=user, defaults={"role": role},
            )

    # -- wipe ----------------------------------------------------------------

    def _wipe_projects(self, ws: Workspace):
        """Remove all projects under Nimbus so we can rebuild idempotently."""
        # Cascading: deletes issues, states, categories, sprints, events, members.
        ws.projects.all().delete()
        self.stdout.write("  wiped existing Nimbus projects")

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
