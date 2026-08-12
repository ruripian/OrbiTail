"""프로젝트 도메인 서비스 — 모델 외 부수 로직.

핵심:
  - get_or_create_personal_project: 워크스페이스+사용자별 숨김 Personal 프로젝트 lazy 생성.
    단발성 이슈(마이 페이지의 "+ 이슈") 컨테이너로 쓰이며 사이드바/검색 등에서 차단됨.

설계 원칙:
  - lazy 생성: 사용자가 처음 단발성 이슈를 만들 때만 생성 — 로그인/멤버십 이벤트와 디커플링.
  - unique constraint (workspace, kind=personal, owner) 가 동시 생성 race 차단.
  - 자동 ProjectMember 등록(ADMIN role) — 기존 이슈 권한 가드(can_edit/can_delete) 그대로 통과.
  - 기본 State 5개 자동 셋업 — 일반 프로젝트와 동일 UX(상태 변경/Board 뷰는 안 쓰지만 미래 확장 대비).
"""
from django.db import transaction
from .constants import DEFAULT_STATES
from .models import Project, ProjectMember, State


def get_or_create_personal_project(workspace, user) -> Project:
    """워크스페이스+사용자별 Personal 프로젝트 반환 — 없으면 생성.

    - identifier: MINE-{user_id 앞 6자 hex}  — 사용자별 unique 보장 (workspace 안 유일성)
    - lazy 생성: 첫 단발성 이슈 작성 시점에만 호출.
    - 동시 호출은 unique constraint 가 1개만 통과시킴.
    """
    # 빠른 조회 — 이미 있으면 트랜잭션 진입 없이 반환
    existing = Project.objects.filter(
        workspace=workspace,
        kind=Project.Kind.PERSONAL,
        owner=user,
    ).first()
    if existing:
        return existing

    user_suffix = str(user.id).replace("-", "")[:6].upper()
    identifier = f"MINE-{user_suffix}"[:12]  # max_length=12 안전

    with transaction.atomic():
        # 동시성 race 대비 — 다른 트랜잭션이 먼저 만들었으면 그것 사용
        project, created = Project.objects.get_or_create(
            workspace=workspace,
            kind=Project.Kind.PERSONAL,
            owner=user,
            defaults={
                "name": "내 작업",
                "identifier": identifier,
                "description": "단발성 이슈 컨테이너 — 본인만 접근",
                "created_by": user,
                "lead": user,
                # 사이드바·검색 등은 kind 로 차단하므로 network 는 SECRET 유지(기본값)
            },
        )
        if created:
            # 본인 자동 ADMIN — 기존 이슈 권한 가드 통과
            ProjectMember.objects.create(
                project=project,
                member=user,
                role=ProjectMember.Role.ADMIN,
            )
            # 기본 상태 5개 — 팔레트는 공용 상수, 기본 상태만 Personal 정책(Todo)
            State.objects.bulk_create([
                State(
                    project=project,
                    name=s["name"],
                    group=s["group"],
                    color=s["color"],
                    sequence=i * 100,
                    default=(s["group"] == "unstarted"),
                )
                for i, s in enumerate(DEFAULT_STATES, start=1)
            ])
    return project
