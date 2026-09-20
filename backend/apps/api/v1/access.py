"""누가 무엇을 볼 수 있나 — v1 뷰와 웹훅 발송이 같은 판정을 쓴다.

웹훅은 요청이 없는 곳(celery)에서 돌기 때문에 뷰의 믹스인을 부를 수 없다. 판정이 두 벌이면
"API 로는 안 보이는데 웹훅으로는 오는" 틈이 생기므로 한 곳에 둔다.
"""
from django.db.models import Q

from apps.documents.views import _get_accessible_spaces
from apps.projects.models import Project
from apps.projects.views import _project_readable_q


def readable_projects(user, workspace):
    return (
        Project.objects.filter(workspace=workspace, kind=Project.Kind.NORMAL)
        .filter(_project_readable_q(user))
        .distinct()
        .select_related("workspace")
    )


def readable_issue_projects(user, workspace):
    """이슈를 읽을 수 있는 프로젝트 — 일반 프로젝트 + 본인 "내 작업"(Personal).

    Personal 은 `readable_projects` 에서 빠진다(프로젝트 목록·지표를 잡다한 단발성 할 일로
    오염시키지 않기 위해). 하지만 그 안의 이슈는 주인 본인이 읽고 고칠 수 있어야 한다.
    """
    return (
        Project.objects.filter(workspace=workspace)
        .filter(
            Q(kind=Project.Kind.NORMAL) & _project_readable_q(user)
            | Q(kind=Project.Kind.PERSONAL, owner=user)
        )
        .distinct()
        .select_related("workspace")
    )


def accessible_spaces(user, workspace):
    return _get_accessible_spaces(user, workspace.slug)
