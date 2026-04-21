from django.db.models.signals import post_save, pre_delete
from django.dispatch import receiver

from apps.projects.models import Project
from .models import DocumentSpace


def _ensure_space_for_project(project: Project) -> DocumentSpace:
    """프로젝트에 연결된 project-type 문서 스페이스를 보장 (없으면 생성). 메타 정보도 동기화."""
    space = DocumentSpace.objects.filter(project=project).first()
    if space is None:
        space = DocumentSpace.objects.create(
            workspace=project.workspace,
            project=project,
            name=project.name,
            icon="",
            icon_prop=project.icon_prop,
            identifier=project.identifier,
            space_type=DocumentSpace.SpaceType.PROJECT,
        )
    else:
        # 이름/아이콘/구분자/보관 상태 동기화
        changed_fields = []
        if space.name != project.name:
            space.name = project.name
            changed_fields.append("name")
        if space.icon_prop != project.icon_prop:
            space.icon_prop = project.icon_prop
            changed_fields.append("icon_prop")
        if space.identifier != project.identifier:
            space.identifier = project.identifier
            changed_fields.append("identifier")
        if space.archived_at != project.archived_at:
            space.archived_at = project.archived_at
            changed_fields.append("archived_at")
        if changed_fields:
            space.save(update_fields=changed_fields)
    return space


@receiver(post_save, sender=Project)
def sync_project_document_space(sender, instance, created, **kwargs):
    """프로젝트 생성/수정 시 연결된 문서 스페이스 생성·동기화.

    - 생성 시: 문서 스페이스 자동 생성
    - 수정 시: 이름/아이콘/구분자/보관 상태 동기화
    - 기존 프로젝트에 스페이스가 누락된 경우 자동 보정
    """
    _ensure_space_for_project(instance)


@receiver(pre_delete, sender=Project)
def delete_project_document_space(sender, instance, **kwargs):
    """프로젝트 삭제 시 연결된 project-type 스페이스도 함께 삭제.

    post_delete 는 Project OneToOne(SET_NULL) 연결이 null 로 바뀐 뒤에 호출되어
    project 로 필터링이 불가능하므로 pre_delete 사용.
    """
    DocumentSpace.objects.filter(
        project=instance,
        space_type=DocumentSpace.SpaceType.PROJECT,
    ).delete()
