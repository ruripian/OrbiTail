from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.projects.models import Project
from .models import DocumentSpace


@receiver(post_save, sender=Project)
def create_project_document_space(sender, instance, created, **kwargs):
    """프로젝트 생성 시 연결된 문서 스페이스 자동 생성"""
    if not created:
        return
    # 이미 있으면 생성하지 않음 (방어)
    if DocumentSpace.objects.filter(project=instance).exists():
        return
    DocumentSpace.objects.create(
        workspace=instance.workspace,
        project=instance,
        name=instance.name,
        icon="",
        space_type=DocumentSpace.SpaceType.PROJECT,
    )
