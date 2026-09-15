"""개발용 한글 시연 데이터 — "OrbiTail" 워크스페이스를 통째로 만든다.

DemoSeeder(공개 데모용, 영문 위주)와 목적이 다르다. 이쪽은 **개발 중 화면을 실제
프로젝트처럼 채워 보기 위한 것**이라 한글 이름·스프린트·문서까지 촘촘히 넣는다.
내용도 이 저장소가 실제로 만들고 있는 것(이슈 트래커·문서 협업·팀 캘린더·관리자
콘솔)을 그대로 쓴다 — 화면을 볼 때 맥락이 맞아야 판단이 된다.

만드는 것:
  - 워크스페이스 1 (OrbiTail) + 한국 이름 사용자 8명
  - 팀 2개 (제품팀 / 플랫폼팀) — TeamMember.title(직책) 포함
  - 프로젝트 5개
      공개 3 — 실행 계정이 멤버
      비공개 2 — 실행 계정이 **멤버가 아님**(권한 없음 확인용)
  - 프로젝트마다 상태 5 · 라벨 5 · 카테고리 · 스프린트 3(완료/진행/예정) · 이슈(하위 이슈 포함)
  - 프로젝트 캘린더 이벤트
  - 문서: 프로젝트 스페이스 문서 + 전사 위키(공용 스페이스)

사용:
    python manage.py seed_dev_orbitail
    python manage.py seed_dev_orbitail --reset      # 기존 것 삭제 후 재생성

운영에서 절대 실행하지 말 것 — DEBUG=False 면 --force 없이는 거부하고,
DEMO_MODE 가 켜져 있으면 무조건 거부한다.
"""
from __future__ import annotations

import random
from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.documents.models import Document, DocumentLabel, DocumentSpace, DocumentSpaceMember
from apps.issues.models import Issue, IssueActivity, IssueComment, Label
from apps.projects.constants import DEFAULT_STATES
from apps.projects.models import Category, Project, ProjectEvent, ProjectMember, Sprint, State
from apps.workspaces.models import Team, TeamMember, Workspace, WorkspaceMember

User = get_user_model()

WS_SLUG = "orbitail"
WS_NAME = "OrbiTail"
MAIL_DOMAIN = "orbitail.test"

# (key, 이름, 이메일 로컬파트)
PEOPLE = [
    ("seoyeon", "김서연", "seoyeon"),
    ("jihoon", "박지훈", "jihoon"),
    ("haneul", "이하늘", "haneul"),
    ("minsu", "최민수", "minsu"),
    ("yujin", "정유진", "yujin"),
    ("sehun", "오세훈", "sehun"),
    ("jiwoo", "한지우", "jiwoo"),
]

OWNER_PASSWORD = "qa-pass-1234"  # 소유자 계정을 새로 만들 때만 쓴다
MEMBER_PASSWORD = "dev-pass-1234"

TODAY = date.today()


def d(offset: int) -> date:
    return TODAY + timedelta(days=offset)


class Command(BaseCommand):
    help = "개발용 한글 시연 데이터(OrbiTail 워크스페이스) 생성"

    def add_arguments(self, parser):
        parser.add_argument(
            "--owner", default=f"qa@{MAIL_DOMAIN}",
            help="워크스페이스 소유자로 쓸 계정 이메일 (없으면 만든다)",
        )
        parser.add_argument(
            "--reset", action="store_true", help="기존 OrbiTail 워크스페이스를 지우고 새로 만든다",
        )
        parser.add_argument("--force", action="store_true", help="DEBUG=False 환경에서도 실행")

    def handle(self, *args, **opts):
        if not settings.DEBUG and not opts["force"]:
            raise CommandError("DEBUG=False 입니다. 개발용 시드입니다 — 정말 필요하면 --force")
        if getattr(settings, "DEMO_MODE", False):
            raise CommandError("DEMO_MODE 가 켜져 있습니다. 데모 배포에는 넣지 않습니다.")

        self._owner_created = False
        random.seed(20260821)  # 재현 가능하게 — 매번 같은 데이터가 나온다

        with transaction.atomic():
            if opts["reset"]:
                deleted, _ = Workspace.objects.filter(slug=WS_SLUG).delete()
                if deleted:
                    self.stdout.write(f"기존 {WS_SLUG} 삭제 ({deleted} rows)")

            if Workspace.objects.filter(slug=WS_SLUG).exists():
                raise CommandError(f"'{WS_SLUG}' 워크스페이스가 이미 있습니다. --reset 을 쓰세요.")

            owner = self._owner(opts["owner"])
            ws = self._workspace(owner)
            users = self._users(ws, owner)
            self._teams(ws, users, owner)
            projects = self._projects(ws, users, owner)
            self._wiki(ws, users, owner)

            public = sum(1 for p in projects if p.network == Project.Network.PUBLIC)
            owner_pw = OWNER_PASSWORD if self._owner_created else "(기존 비밀번호 그대로)"
            self.stdout.write(self.style.SUCCESS(
                f"\n완료 — /{WS_SLUG}\n"
                f"  로그인: {owner.email} / {owner_pw}\n"
                f"  팀원 계정: <로컬파트>@{MAIL_DOMAIN} / {MEMBER_PASSWORD}\n"
                f"  프로젝트 공개 {public}개 / 비공개 {len(projects) - public}개\n"
                f"  이슈 {Issue.objects.filter(workspace=ws).count()}개 "
                f"/ 문서 {Document.objects.filter(space__workspace=ws).count()}개"
            ))

    # ── 사용자 · 워크스페이스 ────────────────────────────────

    def _owner(self, email: str) -> User:
        """소유자 계정 확보. 이미 있으면 **비밀번호를 건드리지 않는다** — 내 실계정일 수 있다."""
        user = User.objects.filter(email=email).first()
        if user is None:
            user = User.objects.create_user(
                email=email, password=OWNER_PASSWORD, display_name="나 (개발 계정)",
            )
            self._owner_created = True
            self.stdout.write(f"소유자 계정 생성: {email} / {OWNER_PASSWORD}")
        return user

    def _workspace(self, owner: User) -> Workspace:
        ws = Workspace.objects.create(
            name=WS_NAME, slug=WS_SLUG,
            description="프로젝트 관리 도구 OrbiTail 을 만드는 팀",
            owner=owner, brand_color="#5E6AD2",
        )
        WorkspaceMember.objects.create(
            workspace=ws, member=owner, role=WorkspaceMember.Role.OWNER,
        )
        return ws

    def _users(self, ws: Workspace, owner: User) -> dict:
        users = {"me": owner}
        for key, name, local in PEOPLE:
            user, created = User.objects.get_or_create(
                email=f"{local}@{MAIL_DOMAIN}",
                # is_active 는 모델 기본값이 False 다 — create_user 를 안 거치므로
                # 여기서 직접 켜지 않으면 시드 계정으로 로그인이 안 된다.
                defaults={"display_name": name, "is_active": True, "is_email_verified": True},
            )
            if not created:
                user.is_active = True
                user.is_email_verified = True
            user.set_password(MEMBER_PASSWORD)
            user.save()
            WorkspaceMember.objects.get_or_create(
                workspace=ws, member=user, defaults={"role": WorkspaceMember.Role.MEMBER},
            )
            users[key] = user
        # 김서연은 워크스페이스 관리자
        WorkspaceMember.objects.filter(workspace=ws, member=users["seoyeon"]).update(
            role=WorkspaceMember.Role.ADMIN,
        )
        return users

    # ── 팀 ───────────────────────────────────────────────

    def _teams(self, ws: Workspace, u: dict, owner: User):
        specs = [
            {
                "name": "제품팀",
                "description": "이슈·문서·팀 기능 기획과 프론트엔드",
                "icon": {"type": "lucide", "name": "Rocket", "color": "#F06EBD"},
                "members": [
                    (u["seoyeon"], TeamMember.Role.ADMIN, "프로덕트 매니저"),
                    (u["haneul"], TeamMember.Role.MEMBER, "프론트엔드"),
                    (u["minsu"], TeamMember.Role.MEMBER, "프로덕트 디자이너"),
                    (u["yujin"], TeamMember.Role.MEMBER, "QA"),
                    (owner, TeamMember.Role.ADMIN, "테크 리드"),
                ],
            },
            {
                "name": "플랫폼팀",
                "description": "API·인프라·배포 파이프라인",
                "icon": {"type": "lucide", "name": "Server", "color": "#26B55E"},
                "members": [
                    (u["jihoon"], TeamMember.Role.ADMIN, "백엔드 리드"),
                    (u["jiwoo"], TeamMember.Role.MEMBER, "인프라"),
                    (u["sehun"], TeamMember.Role.MEMBER, "데이터 엔지니어"),
                    (owner, TeamMember.Role.MEMBER, "테크 리드"),
                ],
            },
        ]
        for spec in specs:
            team = Team.objects.create(
                workspace=ws, name=spec["name"], description=spec["description"],
                icon_prop=spec["icon"], created_by=owner,
            )
            for member, role, title in spec["members"]:
                TeamMember.objects.create(
                    team=team, member=member, role=role, title=title, added_by=owner,
                )
            self.stdout.write(f"팀: {team.name} ({len(spec['members'])}명)")

    # ── 프로젝트 ─────────────────────────────────────────

    def _projects(self, ws: Workspace, u: dict, owner: User) -> list:
        specs = [
            dict(
                name="이슈 트래커", identifier="ISSUE", public=True,
                icon={"type": "lucide", "name": "CheckCircle", "color": "#5E6AD2"},
                description="보드·테이블·타임라인 뷰와 스프린트. 제품의 중심 기능.",
                lead=u["seoyeon"],
                members=[owner, u["seoyeon"], u["haneul"], u["minsu"], u["yujin"]],
            ),
            dict(
                name="문서 협업", identifier="DOCS", public=True,
                icon={"type": "lucide", "name": "FileText", "color": "#26B55E"},
                description="스페이스·문서·동시 편집. 이슈와 양방향 링크로 묶인다.",
                lead=u["jihoon"],
                members=[owner, u["jihoon"], u["haneul"], u["sehun"]],
            ),
            dict(
                name="팀 · 캘린더", identifier="TEAM", public=True,
                icon={"type": "lucide", "name": "Users", "color": "#F0AD4E"},
                description="팀 단위 일정 모아보기와 팀 설정.",
                lead=u["minsu"],
                members=[owner, u["minsu"], u["haneul"], u["yujin"]],
            ),
            # ── 아래 2개는 실행 계정이 멤버가 아니다 (비공개 = 접근 불가 확인용)
            dict(
                name="관리자 콘솔", identifier="ADMIN", public=False,
                icon={"type": "lucide", "name": "Shield", "color": "#D94F4F"},
                description="전사 운영 데이터와 감사 로그를 다룬다. 접근 최소화.",
                lead=u["seoyeon"],
                members=[u["seoyeon"], u["jiwoo"]],
            ),
            dict(
                name="요금제 · 결제", identifier="BILL", public=False,
                icon={"type": "lucide", "name": "CreditCard", "color": "#A855F7"},
                description="외부 공개 전 사업 검토 단계.",
                lead=u["jihoon"],
                members=[u["jihoon"], u["seoyeon"]],
            ),
        ]

        created = []
        for spec in specs:
            project = self._project(ws, owner, spec)
            created.append(project)
            visible = "공개" if spec["public"] else "비공개(내 권한 없음)"
            self.stdout.write(
                f"프로젝트: {project.identifier:6} {project.name:12} — {visible}, "
                f"이슈 {project.issues.count()}개"
            )
        return created

    def _project(self, ws: Workspace, owner: User, spec: dict) -> Project:
        project = Project.objects.create(
            workspace=ws, name=spec["name"], identifier=spec["identifier"],
            description=spec["description"],
            network=Project.Network.PUBLIC if spec["public"] else Project.Network.SECRET,
            icon_prop=spec["icon"], created_by=owner, lead=spec["lead"],
        )
        for member in spec["members"]:
            ProjectMember.objects.create(
                project=project, member=member,
                role=(ProjectMember.Role.ADMIN if member == spec["lead"]
                      else ProjectMember.Role.MEMBER),
            )
        states = {
            s["group"]: State.objects.create(
                project=project, name=s["name"], group=s["group"], color=s["color"],
                sequence=(i + 1) * 100, default=(s["group"] == "backlog"),
            )
            for i, s in enumerate(DEFAULT_STATES)
        }
        labels = {
            name: Label.objects.create(project=project, name=name, color=color)
            for name, color in [
                ("버그", "#D94F4F"), ("기능", "#5E6AD2"), ("개선", "#26B55E"),
                ("문서", "#A3A3A3"), ("긴급", "#F97316"),
            ]
        }
        sprints = self._sprints(project, owner)
        categories = self._categories(project, spec)
        self._issues(ws, project, spec, states, labels, sprints, categories)
        self._events(project, spec, owner)
        self._project_docs(project, spec)
        return project

    def _sprints(self, project: Project, owner: User) -> dict:
        rows = [
            ("지난 스프린트 (7월 4주)", Sprint.Status.COMPLETED, -28, -15, "회고까지 마친 사이클"),
            ("이번 스프린트 (8월 3주)", Sprint.Status.ACTIVE, -7, 6, "진행 중. 금요일 데모."),
            ("다음 스프린트 (9월 1주)", Sprint.Status.DRAFT, 7, 20, "아직 확정 전 — 후보만 담아둠"),
        ]
        return {
            status: Sprint.objects.create(
                project=project, name=name, description=desc, status=status,
                start_date=d(start), end_date=d(end), created_by=owner,
            )
            for name, status, start, end, desc in rows
        }

    CATEGORY_SETS = {
        "ISSUE": [("보드 · 정렬", "Columns"), ("스프린트", "Repeat"), ("필터 · 검색", "Filter")],
        "DOCS": [("에디터", "Type"), ("스페이스 권한", "Lock"), ("이슈 연동", "Link")],
        "TEAM": [("팀 설정", "Settings"), ("캘린더", "Calendar"), ("알림", "Bell")],
        "ADMIN": [("감사 로그", "ScrollText"), ("사용량", "BarChart")],
        "BILL": [("요금제 설계", "Calculator"), ("결제 연동", "CreditCard")],
    }

    def _categories(self, project: Project, spec: dict) -> list:
        return [
            Category.objects.create(
                project=project, name=name,
                icon_prop={"name": icon, "color": "#5E6AD2"},
                status=Category.Status.ACTIVE if i == 0 else Category.Status.BACKLOG,
                lead=spec["lead"], start_date=d(-20), target_date=d(30), sort_order=i,
            )
            for i, (name, icon) in enumerate(self.CATEGORY_SETS[spec["identifier"]])
        ]

    # ── 이슈 ─────────────────────────────────────────────
    # (제목, 상태그룹, 우선순위, 라벨, 예상포인트, [하위 이슈…])

    ISSUE_SETS = {
        "ISSUE": [
            ("보드에서 이슈를 옮기면 정렬 순서가 가끔 어긋남", "started", "urgent", "버그", 5, [
                "sort_order 재계산 규칙 정리", "동시 이동 시 충돌 재현"]),
            ("하위 이슈 포함 토글이 상태 필터와 충돌", "started", "high", "버그", 5, [
                "필터 조합 표 만들기", "쿼리셋 분기 단순화"]),
            ("이슈 템플릿을 프로젝트별로 관리", "unstarted", "medium", "기능", 8, [
                "템플릿 스코프 설계", "생성 다이얼로그 연결"]),
            ("타임라인 뷰 가로 스크롤이 무거움", "unstarted", "medium", "개선", 8, []),
            ("이슈 대량 편집 (상태·담당자 일괄 변경)", "backlog", "medium", "기능", 13, []),
            ("저장된 필터를 팀원과 공유", "backlog", "low", "기능", 5, []),
            ("상태 변경이 활동 로그에 안 남는 경우", "backlog", "high", "버그", 3, []),
            ("필드 전환을 상태 선택기로 일원화", "completed", "medium", "개선", 5, []),
            ("첨부 드래그앤드롭 업로드", "completed", "medium", "기능", 3, []),
            ("이슈 정렬 기준 사용자 지정", "cancelled", "low", "기능", 5, []),
        ],
        "DOCS": [
            ("동시 편집 중 다른 사람 커서가 사라짐", "started", "urgent", "버그", 8, [
                "Yjs awareness 전파 확인", "재연결 시 상태 복구"]),
            ("문서 버전 이력에서 되돌리기", "started", "high", "기능", 8, [
                "버전 비교 뷰", "복원 확인 다이얼로그"]),
            ("문서 내보내기 (PDF · 마크다운)", "unstarted", "medium", "기능", 8, []),
            ("휴지통에서 문서 복구", "unstarted", "high", "기능", 5, []),
            ("댓글 스레드 알림", "backlog", "medium", "기능", 5, []),
            ("문서 검색에 한글 형태소 분석 적용", "backlog", "medium", "개선", 13, []),
            ("커버 이미지 크롭·오프셋", "completed", "low", "개선", 3, []),
            ("문서 ↔ 이슈 양방향 링크", "completed", "high", "기능", 8, []),
        ],
        "TEAM": [
            ("팀 설정을 별도 페이지로 분리", "started", "high", "개선", 8, [
                "설정 레이아웃 2탭", "멤버 관리 이식", "삭제를 위험 구역으로"]),
            ("팀 멤버 직책(title) 표시", "started", "medium", "기능", 5, [
                "모델 필드 추가", "멤버 목록 인라인 편집"]),
            ("팀 아이콘 지정 (아이콘 · 이미지)", "unstarted", "medium", "기능", 3, []),
            ("캘린더 멤버 필터가 새로고침하면 풀림", "unstarted", "medium", "버그", 3, []),
            ("팀 캘린더 주간 뷰", "backlog", "medium", "기능", 8, []),
            ("팀별 알림 설정", "backlog", "low", "기능", 5, []),
            ("개인 일정 팀 공유 토글", "completed", "medium", "기능", 5, []),
        ],
        "ADMIN": [
            ("감사 로그 검색이 10만 건부터 느려짐", "started", "high", "개선", 8, [
                "인덱스 재설계", "커서 페이지네이션"]),
            ("워크스페이스 사용량 대시보드", "unstarted", "medium", "기능", 8, []),
            ("계정 정지 사유를 기록에 남기기", "backlog", "medium", "기능", 3, []),
            ("관리자 권한 위임", "completed", "high", "기능", 5, []),
        ],
        "BILL": [
            ("요금제 구간 초안", "started", "high", "문서", 5, []),
            ("사용량 기반 과금이 맞는지 검토", "unstarted", "medium", "문서", 5, []),
            ("PG 후보 3곳 비교", "backlog", "medium", "문서", 3, []),
        ],
    }

    def _issues(self, ws, project, spec, states, labels, sprints, categories):
        members = spec["members"]
        rng = random.Random(sum(ord(c) for c in spec["identifier"]))

        for i, (title, group, priority, label, points, subs) in enumerate(
            self.ISSUE_SETS[spec["identifier"]]
        ):
            # 완료/취소는 지난 스프린트, 진행 중은 이번 스프린트, 백로그는 미지정
            if group in ("completed", "cancelled"):
                sprint = sprints[Sprint.Status.COMPLETED]
            elif group == "started":
                sprint = sprints[Sprint.Status.ACTIVE]
            elif group == "unstarted":
                sprint = sprints[Sprint.Status.ACTIVE] if i % 2 else sprints[Sprint.Status.DRAFT]
            else:
                sprint = None

            issue = Issue.objects.create(
                workspace=ws, project=project, title=title,
                state=states[group], priority=priority,
                sprint=sprint, category=rng.choice(categories),
                estimate_point=points, created_by=spec["lead"],
                start_date=d(rng.randint(-25, -1)) if group != "backlog" else None,
                due_date=d(rng.randint(1, 25)) if group != "backlog" else None,
                description_html=f"<p>{title}</p><p>스프린트 계획 회의에서 정리한 항목입니다.</p>",
                sort_order=(i + 1) * 100,
            )
            issue.assignees.add(*rng.sample(members, k=min(2, len(members))))
            issue.label.add(labels[label])
            if priority == "urgent":
                issue.label.add(labels["긴급"])

            for j, sub_title in enumerate(subs):
                # 진행 중 이슈의 첫 하위 항목은 끝난 것으로 둬서 진척도가 보이게 한다
                sub_group = "completed" if (j == 0 and group == "started") else "unstarted"
                sub = Issue.objects.create(
                    workspace=ws, project=project, title=sub_title,
                    state=states[sub_group], priority="medium", parent=issue, sprint=sprint,
                    estimate_point=max(1, points // max(1, len(subs))),
                    created_by=spec["lead"], sort_order=(j + 1) * 100,
                )
                sub.assignees.add(rng.choice(members))
                self._activities(sub, sub_group, spec["lead"], rng)

            self._activities(issue, group, spec["lead"], rng)

            if group == "started":
                IssueComment.objects.create(
                    issue=issue, actor=rng.choice(members),
                    comment_html="<p>재현 조건 정리해서 붙였습니다. 확인 부탁드려요.</p>",
                )

    # 상태 그룹별로 "여기까지 오는 동안 거쳤을 경로" — 활동 로그를 되짚어 만든다
    STATE_FLOW = {
        "backlog": [],
        "unstarted": [("Backlog", "Todo")],
        "started": [("Backlog", "Todo"), ("Todo", "In Progress")],
        "completed": [("Backlog", "Todo"), ("Todo", "In Progress"), ("In Progress", "Done")],
        "cancelled": [("Backlog", "Todo"), ("Todo", "Cancelled")],
    }

    def _activities(self, issue, group, lead, rng):
        """활동 로그를 심는다.

        이슈를 뷰가 아니라 ORM 으로 만들면 IssueListCreateView.perform_create 가
        남기는 "created" 기록이 없다. 그러면 활동 탭이 중간부터 시작해 비어 보인다.
        여기서 생성 + 상태 이동 + 담당자 지정을 시간 순으로 되짚어 넣는다.
        """
        assignees = list(issue.assignees.all())
        rows = [("created", None, None, None)]
        for old_state, new_state in self.STATE_FLOW.get(group, []):
            rows.append(("updated", "state", old_state, new_state))
        if assignees:
            names = ", ".join(sorted(u.display_name or u.email for u in assignees))
            rows.append(("updated", "assignees", None, names))

        created = IssueActivity.objects.bulk_create([
            IssueActivity(issue=issue, actor=(lead if verb == "created" else rng.choice(assignees or [lead])),
                          verb=verb, field=field, old_value=old, new_value=new)
            for verb, field, old, new in rows
        ])

        # created_at 은 auto_now_add 라 생성 시점에 못 넣는다 — 만든 뒤 되돌려 놓는다.
        # 전부 같은 시각이면 타임라인이 한 덩어리로 뭉쳐 보인다.
        base = timezone.now() - timedelta(days=rng.randint(12, 26))
        for i, activity in enumerate(created):
            IssueActivity.objects.filter(pk=activity.pk).update(
                created_at=base + timedelta(days=i * 2, hours=rng.randint(0, 8)),
            )

    def _events(self, project, spec, owner):
        rows = [
            ("스프린트 계획 회의", ProjectEvent.EventType.MEETING, -7, "#5E6AD2"),
            ("주간 데모", ProjectEvent.EventType.MEETING, 5, "#F06EBD"),
            ("QA 마감", ProjectEvent.EventType.DEADLINE, 12, "#D94F4F"),
            ("릴리스", ProjectEvent.EventType.MILESTONE, 20, "#26B55E"),
        ]
        for title, kind, offset, color in rows:
            event = ProjectEvent.objects.create(
                project=project, title=title, date=d(offset),
                event_type=kind, color=color, created_by=owner,
            )
            event.participants.add(*spec["members"])

    # ── 문서 ─────────────────────────────────────────────

    DOC_SETS = {
        "ISSUE": [
            ("이슈 트래커 개요", "CheckCircle", """
<h1>이슈 트래커</h1>
<p>OrbiTail 의 중심 기능입니다. 보드·테이블·캘린더·타임라인 네 가지 뷰가 같은 데이터를 봅니다.</p>
<h2>이번 분기 목표</h2>
<ul><li>보드 드래그 정렬 결함 0건</li><li>타임라인 1,000건에서 60fps</li>
<li>이슈 템플릿 프로젝트별 관리</li></ul>
<h2>담당</h2><p>PM 김서연 · 프론트엔드 이하늘 · 디자인 최민수 · QA 정유진</p>"""),
            ("상태와 워크플로 정책", "Workflow", """
<h1>상태와 워크플로 정책</h1>
<h2>기본 상태 5개</h2>
<table><tr><th>이름</th><th>그룹</th><th>뜻</th></tr>
<tr><td>Backlog</td><td>backlog</td><td>아직 안 잡힌 것. 새 이슈의 출발점</td></tr>
<tr><td>Todo</td><td>unstarted</td><td>이번에 하기로 한 것</td></tr>
<tr><td>In Progress</td><td>started</td><td>지금 하고 있는 것</td></tr>
<tr><td>Done</td><td>completed</td><td>끝난 것</td></tr>
<tr><td>Cancelled</td><td>cancelled</td><td>안 하기로 한 것</td></tr></table>
<h2>필드(Field)</h2><p>상태가 없는 상위 분류입니다. 폴더처럼 쓰며 보드와 번다운에서 빠집니다.</p>"""),
            ("이슈 작성 가이드", "PenLine", """
<h1>이슈 작성 가이드</h1>
<h2>버그</h2><p>재현 조건을 반드시 적습니다 — 환경, 단계, 기대 결과, 실제 결과.
재현이 안 되면 고칠 수도 없습니다.</p>
<h2>기능</h2><p><strong>왜</strong> 필요한지를 먼저 씁니다. 무엇을 만들지는 그다음입니다.</p>
<h2>예상 포인트</h2><p>1·2·3·5·8·13 만 씁니다. 13을 넘으면 쪼갭니다.</p>"""),
            ("스프린트 회고 (7월 4주)", "MessageSquare", """
<h1>스프린트 회고 — 7월 4주</h1>
<h2>좋았던 것</h2><ul><li>필드 전환을 상태 선택기로 합치면서 UI가 단순해짐</li>
<li>드래그앤드롭 업로드가 예상보다 반응이 좋음</li></ul>
<h2>아쉬운 것</h2><ul><li>정렬 결함 재현에 이틀 — 재현 환경을 문서로 남기기로 함</li></ul>
<h2>다음에 할 것</h2><ul><li>버그 이슈에 재현 조건 템플릿 적용</li></ul>"""),
        ],
        "DOCS": [
            ("문서 협업 개요", "FileText", """
<h1>문서 협업</h1>
<p>스페이스 안에 문서를 두고 함께 편집합니다. 이슈와 양방향으로 링크됩니다.</p>
<h2>스페이스 종류</h2>
<ul><li><strong>project</strong> — 프로젝트 생성 시 자동 생성. 권한은 프로젝트를 따름</li>
<li><strong>shared</strong> — 워크스페이스 공용</li>
<li><strong>personal</strong> — 개인 전용</li></ul>"""),
            ("동시 편집 설계", "Users", """
<h1>동시 편집 설계</h1>
<h2>구조</h2><p>Yjs CRDT 문서를 <code>yjs_state</code> 에 스냅숏으로 보관하고,
접속 중에는 awareness 로 커서·선택 영역을 주고받습니다.</p>
<h2>알려진 문제</h2><p>재연결 직후 상대 커서가 사라집니다. awareness 가 복구되지 않아
생기는 것으로 보이며 <code>DOCS-1</code> 에서 다룹니다.</p>"""),
            ("스페이스 권한 정책", "Lock", """
<h1>스페이스 권한 정책</h1>
<h2>등급</h2><ul><li>Viewer(5) — 읽기만</li><li>Editor(15) — 문서 편집</li>
<li>Admin(20) — 스페이스 설정·멤버 관리·삭제</li></ul>
<h2>권한이 겹칠 때</h2><p>프로젝트 스페이스에서는 프로젝트 멤버십과 스페이스 멤버십이
동시에 적용됩니다. <strong>넓은 쪽이 이깁니다.</strong></p>"""),
        ],
        "TEAM": [
            ("팀 기능 개요", "Users", """
<h1>팀 · 캘린더</h1>
<p>팀은 권한 경계가 아니라 <strong>일정을 함께 보는 사람 묶음</strong>입니다.
이슈 접근 권한은 프로젝트 멤버십이 정하고, 팀 역할과는 무관합니다.</p>
<h2>구성</h2><ul><li>팀 홈 — 캘린더 + 멤버 스택</li>
<li>팀 설정 — 일반(이름·아이콘·삭제) / 멤버(권한·직책)</li></ul>"""),
            ("팀 설정 통합 설계", "Settings", """
<h1>팀 설정 통합</h1>
<h2>문제</h2><p>팀 설정이 작은 모달 하나(이름·설명·색)뿐이고, 멤버 관리는 캘린더 아래,
삭제는 헤더 버튼에 흩어져 있었습니다. 프로젝트·문서 스페이스와 패턴도 달랐습니다.</p>
<h2>결정</h2><p><code>/teams/:id/settings</code> 아래 일반·멤버 2탭으로 모읍니다.
프로젝트가 4탭이라고 억지로 늘리지 않습니다 — 팀에는 워크플로·자동화가 없습니다.</p>
<h2>직책(title)</h2><p>권한(role)과 별개인 <strong>표시 전용</strong> 값입니다.
팀 단위라 이슈 담당자·멘션 같은 팀 밖 화면에는 쓸 수 없습니다.</p>"""),
            ("팀 캘린더 데이터 정책", "Calendar", """
<h1>팀 캘린더 데이터 정책</h1>
<p>정보가 새지 않도록 세 종류를 따로 가져옵니다.</p>
<ul><li><strong>이슈</strong> — 팀원 담당 이슈 중 <em>요청자도 그 프로젝트 멤버</em>인 것만</li>
<li><strong>개인 일정</strong> — 팀원이 팀 공유로 표시한 것만</li>
<li><strong>프로젝트 일정</strong> — 요청자도 멤버인 프로젝트의 것만</li></ul>
<p>즉 팀에 속했다는 이유만으로 남의 비공개 프로젝트 일정이 보이지 않습니다.</p>"""),
        ],
        "ADMIN": [
            ("관리자 콘솔 원칙", "Shield", """
<h1>관리자 콘솔 원칙</h1>
<p>전사 데이터를 다루므로 접근을 최소화합니다.</p>
<ul><li>이 프로젝트 멤버로만 제한 — 워크스페이스 관리자라고 자동 접근되지 않음</li>
<li>모든 조회·변경은 감사 로그에 남김</li><li>공개 데모에서는 콘솔 전체를 차단</li></ul>"""),
            ("감사 로그 스키마", "ScrollText", """
<h1>감사 로그 스키마</h1>
<table><tr><th>필드</th><th>설명</th></tr>
<tr><td>actor</td><td>행위자</td></tr><tr><td>action</td><td>create / update / delete</td></tr>
<tr><td>target</td><td>대상 모델과 id</td></tr><tr><td>diff</td><td>변경 전후</td></tr>
<tr><td>created_at</td><td>시각</td></tr></table>
<h2>성능</h2><p>10만 건부터 검색이 느려집니다. offset 페이지네이션이 원인이라
커서 방식으로 바꿉니다.</p>"""),
        ],
        "BILL": [
            ("요금제 검토 개요", "CreditCard", """
<h1>요금제 · 결제</h1>
<p>외부 공개 전 단계입니다. 담당자 외 열람을 금합니다.</p>
<h2>진행</h2><ol><li>요금 구간 초안</li><li>과금 방식 결정</li><li>PG 선정</li></ol>"""),
            ("경쟁 제품 가격 비교", "TrendingUp", """
<h1>경쟁 제품 가격 비교</h1>
<table><tr><th>제품</th><th>무료</th><th>유료 시작가</th><th>과금 단위</th></tr>
<tr><td>A</td><td>10명</td><td>$8/월</td><td>사용자</td></tr>
<tr><td>B</td><td>무제한(기능 제한)</td><td>$10/월</td><td>사용자</td></tr>
<tr><td>C</td><td>없음</td><td>$99/월</td><td>워크스페이스</td></tr></table>
<h2>메모</h2><p>사용자당 과금이 표준이지만, 소규모 팀에는 워크스페이스 정액이
더 잘 맞을 수 있습니다.</p>"""),
        ],
    }

    def _project_docs(self, project, spec):
        """프로젝트 스페이스는 post_save 시그널이 이미 만들어 뒀다 — 문서만 채운다."""
        space = DocumentSpace.objects.filter(project=project).first()
        if space is None:
            return
        home = None
        for i, (title, icon, html) in enumerate(self.DOC_SETS[spec["identifier"]]):
            doc = Document.objects.create(
                space=space, title=title,
                icon_prop={"type": "lucide", "name": icon, "color": "#5E6AD2"},
                content_html=html.strip(), created_by=spec["lead"], sort_order=(i + 1) * 100,
            )
            if i == 0:
                home = doc
        if home:
            space.home_document = home
            space.save(update_fields=["home_document"])

    def _wiki(self, ws: Workspace, u: dict, owner: User):
        """전사 위키 — 공용(shared) 스페이스."""
        space = DocumentSpace.objects.create(
            workspace=ws, name="전사 위키", identifier="WIKI",
            description="온보딩·규칙·용어집 등 모두가 보는 문서",
            space_type=DocumentSpace.SpaceType.SHARED,
            icon_prop={"type": "lucide", "name": "BookOpen", "color": "#F0AD4E"},
        )
        for member in [owner] + [u[k] for k, _, _ in PEOPLE]:
            DocumentSpaceMember.objects.create(
                space=space, member=member,
                role=(DocumentSpaceMember.Role.ADMIN if member == owner
                      else DocumentSpaceMember.Role.EDITOR),
            )
        labels = {
            name: DocumentLabel.objects.create(
                workspace=ws, name=name, color=color, created_by=owner,
            )
            for name, color in [("온보딩", "#26B55E"), ("규칙", "#5E6AD2"), ("용어", "#A3A3A3")]
        }
        pages = [
            ("신규 입사자 온보딩", "UserPlus", "온보딩", """
<h1>신규 입사자 온보딩</h1>
<h2>첫날</h2><ol><li>계정 발급 (메일 · 깃 · 워크스페이스 초대)</li>
<li>개발 환경 — <code>docker compose up -d</code> 하나면 끝납니다</li>
<li>팀 소개 미팅</li></ol>
<h2>첫 주</h2><ul><li>버디와 1:1</li><li>작은 이슈 하나 처리해 보기</li>
<li>배포 참관</li></ul>"""),
            ("개발 규칙", "GitBranch", "규칙", """
<h1>개발 규칙</h1>
<h2>브랜치</h2><p><code>feat/</code> <code>fix/</code> <code>chore/</code> <code>docs/</code>
접두사를 씁니다.</p>
<h2>커밋</h2><p>제목은 한 줄. 본문에는 <strong>왜</strong> 고쳤는지를 씁니다 —
무엇을 고쳤는지는 diff 가 말해 줍니다.</p>
<h2>리뷰</h2><p>승인 1개 이상이면 머지합니다. 24시간 내 리뷰가 원칙입니다.</p>"""),
            ("배포 절차", "Rocket", "규칙", """
<h1>배포 절차</h1>
<p>운영에는 <strong>소스 트리를 두지 않습니다.</strong> 커밋 SHA 로 태그한 이미지를 가리킬 뿐입니다.</p>
<ol><li>배포할 커밋에서 임시 worktree 를 만들어 빌드 — 개발 트리의 미커밋 변경이 섞이지 않게</li>
<li>운영 설정의 <code>TAG</code> 를 그 SHA 로 변경</li>
<li><code>docker compose up -d</code></li></ol>
<h2>롤백</h2><p><code>TAG</code> 를 이전 SHA 로 되돌리고 다시 올립니다. 재빌드는 필요 없습니다.</p>
<h2>주의</h2><p><code>COMPOSE_PROJECT_NAME</code> 은 절대 바꾸지 않습니다 —
볼륨 이름이 여기서 나오므로 바꾸면 DB 가 갈립니다.</p>"""),
            ("용어집", "BookOpen", "용어", """
<h1>용어집</h1>
<table><tr><th>용어</th><th>뜻</th></tr>
<tr><td>스프린트</td><td>2주 단위 작업 묶음</td></tr>
<tr><td>카테고리</td><td>프로젝트 안의 작업 그룹 — 이슈를 논리적으로 묶는다</td></tr>
<tr><td>필드</td><td>상태 없는 상위 분류 이슈 — 폴더처럼 쓴다</td></tr>
<tr><td>스페이스</td><td>문서를 담는 최상위 단위</td></tr>
<tr><td>직책</td><td>팀 안에서의 표시용 역할 — 권한과 무관</td></tr></table>"""),
        ]
        home = None
        for i, (title, icon, label, html) in enumerate(pages):
            doc = Document.objects.create(
                space=space, title=title,
                icon_prop={"type": "lucide", "name": icon, "color": "#F0AD4E"},
                content_html=html.strip(), created_by=owner, sort_order=(i + 1) * 100,
            )
            doc.labels.add(labels[label])
            if i == 0:
                home = doc
        space.home_document = home
        space.save(update_fields=["home_document"])
        self.stdout.write(f"문서 스페이스: {space.name} ({len(pages)}개 문서)")
