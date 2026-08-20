"""데모 모드 생성량 상한과 샌드박스 귀속 처리.

DEMO_MODE 가 꺼져 있으면 모든 시그널이 즉시 반환하므로 실사용 배포의
동작에는 영향이 없다.

신규 여부 판정에 instance.pk 를 쓰지 않는다. 이 프로젝트의 모델은
UUIDField(primary_key=True, default=uuid.uuid4) 라 저장 전에도 pk 가
채워져 있어서, 항상 "기존 객체" 로 오판하게 된다. _state.adding 을 쓴다.
"""
from django.conf import settings
from django.db.models.signals import post_save, pre_save
from rest_framework.exceptions import ValidationError


def _sandbox_of_user(user):
    if user is None or getattr(user, "pk", None) is None:
        return None
    return getattr(user, "demo_sandbox", None)


def _sandbox_of_workspace(workspace):
    if workspace is None:
        return None
    return workspace.demo_sandboxes.first()


def _too_many(kind: str, limit: int):
    return ValidationError({
        "detail": f"데모에서는 {kind}를 {limit}개까지만 만들 수 있습니다."
    })


# --- 상한 ---------------------------------------------------------------

def cap_workspaces(sender, instance, **kwargs):
    if not settings.DEMO_MODE or not instance._state.adding:
        return
    sandbox = _sandbox_of_user(instance.owner)
    if sandbox is None:
        return
    if sandbox.workspaces.count() >= settings.DEMO_MAX_WORKSPACES_PER_SANDBOX:
        raise _too_many("워크스페이스", settings.DEMO_MAX_WORKSPACES_PER_SANDBOX)


def cap_issues(sender, instance, **kwargs):
    if not settings.DEMO_MODE or not instance._state.adding or not instance.workspace_id:
        return
    sandbox = _sandbox_of_workspace(instance.workspace)
    if sandbox is None:
        return
    from apps.issues.models import Issue

    if Issue.objects.filter(workspace__demo_sandboxes=sandbox).count() >= settings.DEMO_MAX_ISSUES_PER_SANDBOX:
        raise _too_many("이슈", settings.DEMO_MAX_ISSUES_PER_SANDBOX)


def cap_documents(sender, instance, **kwargs):
    if not settings.DEMO_MODE or not instance._state.adding or not instance.space_id:
        return
    sandbox = _sandbox_of_workspace(instance.space.workspace)
    if sandbox is None:
        return
    from apps.documents.models import Document

    if Document.objects.filter(space__workspace__demo_sandboxes=sandbox).count() >= settings.DEMO_MAX_DOCUMENTS_PER_SANDBOX:
        raise _too_many("문서", settings.DEMO_MAX_DOCUMENTS_PER_SANDBOX)


# --- 귀속 ---------------------------------------------------------------

def attach_workspace_to_sandbox(sender, instance, created, **kwargs):
    """방문자가 데모 중에 새로 만든 워크스페이스도 샌드박스에 묶는다.

    묶지 않으면 만료 정리가 이 워크스페이스를 찾지 못해 영구히 남는다.
    (샌드박스 시드 중에는 아직 DemoSandbox 가 없으므로 여기서 걸리지 않고,
     create_sandbox 가 직접 workspaces.set() 으로 연결한다.)
    """
    if not settings.DEMO_MODE or not created:
        return
    sandbox = _sandbox_of_user(instance.owner)
    if sandbox is not None:
        sandbox.workspaces.add(instance)


def connect():
    pre_save.connect(cap_workspaces, sender="workspaces.Workspace", dispatch_uid="demo_cap_ws")
    pre_save.connect(cap_issues, sender="issues.Issue", dispatch_uid="demo_cap_issue")
    pre_save.connect(cap_documents, sender="documents.Document", dispatch_uid="demo_cap_doc")
    post_save.connect(attach_workspace_to_sandbox, sender="workspaces.Workspace", dispatch_uid="demo_attach_ws")
