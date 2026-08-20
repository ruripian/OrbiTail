"""방문자별 데모 샌드박스의 생성과 삭제.

샌드박스 하나는 전용 유저 6명(방문자 본인 + 동료 더미 5명)과 그들이 소유한
워크스페이스 2개로 이루어진다. 유저 이메일 도메인이 샌드박스마다 고유해서,
정리할 때 그 도메인으로 소속 계정을 전부 골라낼 수 있다.

워크스페이스 내용은 apps.workspaces.seeding.DemoSeeder 가 만든다.
seed_demo 관리 커맨드와 같은 생성기이므로 데모 화면과 위키 스크린샷이
어긋나지 않는다.
"""
import secrets
import uuid

from django.contrib.auth import get_user_model
from django.db import transaction

from apps.workspaces.models import WorkspaceMember
from apps.workspaces.seeding import DemoSeeder

from .models import DemoSandbox

User = get_user_model()

EMAIL_DOMAIN_SUFFIX = "demo.invalid"

# 첫 번째가 방문자 본인이며 워크스페이스 소유자가 된다.
# 나머지는 담당자·리뷰어로 등장하는 더미 계정이다.
SANDBOX_USERS = [
    ("you",    "You",         WorkspaceMember.Role.OWNER),
    ("sarah",  "Sarah Lee",   WorkspaceMember.Role.ADMIN),
    ("jake",   "Jake Park",   WorkspaceMember.Role.MEMBER),
    ("yuna",   "Yuna Choi",   WorkspaceMember.Role.MEMBER),
    ("minjae", "Minjae Jung", WorkspaceMember.Role.MEMBER),
    ("sophie", "Sophie Han",  WorkspaceMember.Role.MEMBER),
]

# (표시 이름, 슬러그 접두사, 포함할 프로젝트)
SANDBOX_WORKSPACES = [
    ("Nimbus Studio", "nimbus", ("aurora", "meteor", "archive")),
    ("Orbit Labs",    "orbit",  ("meteor",)),
]


@transaction.atomic
def create_sandbox(client_hash: str = "") -> DemoSandbox:
    """샌드박스를 하나 만들고 방문자 계정이 연결된 DemoSandbox 를 돌려준다."""
    short = uuid.uuid4().hex[:12]
    domain = f"{short}.{EMAIL_DOMAIN_SUFFIX}"
    users_spec = [(f"{local}@{domain}", name, role) for local, name, role in SANDBOX_USERS]

    # 로그인 경로로는 쓰이지 않는다. 계정에 사용 가능한 비밀번호가 남지 않도록
    # 매번 버리는 임의값을 넣는다.
    password = secrets.token_urlsafe(32)

    visitor = None
    workspaces = []
    for name, slug_prefix, projects in SANDBOX_WORKSPACES:
        workspace, users = DemoSeeder(
            workspace_name=name,
            workspace_slug=f"{slug_prefix}-{short}",
            users=users_spec,
            password=password,
            projects=projects,
            # 공지는 전역 모델이라 샌드박스마다 만들면 다른 방문자에게도 보인다.
            # 데모용 공지는 배포 시 seed_demo_announcements 로 한 번만 심는다.
            with_announcements=False,
        ).run()
        workspaces.append(workspace)
        visitor = users[0]

    sandbox = DemoSandbox.objects.create(
        user=visitor,
        email_domain=domain,
        client_hash=client_hash,
    )
    sandbox.workspaces.set(workspaces)
    return sandbox


@transaction.atomic
def delete_sandbox(sandbox: DemoSandbox) -> None:
    """샌드박스가 만든 것을 남김없이 지운다.

    순서가 중요하다. Workspace.owner 는 SET_NULL 이라 유저를 먼저 지우면
    워크스페이스가 주인 없이 남는다. 워크스페이스부터 지운 뒤 계정을 지운다.
    DemoSandbox.user 가 CASCADE 이므로 계정 삭제로 샌드박스 레코드도 사라진다.
    """
    domain = sandbox.email_domain
    for workspace in sandbox.workspaces.all():
        workspace.delete()
    User.objects.filter(email__endswith=f"@{domain}").delete()
