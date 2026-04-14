from rest_framework import generics

from apps.accounts.permissions import IsSuperUser
from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogListView(generics.ListAPIView):
    """감사 로그 목록 — 슈퍼유저 전용.

    쿼리 파라미터:
      - action: Action 코드 (예: superuser_grant)
      - target_type: user | workspace
      - actor: 사용자 UUID (특정 관리자가 한 행위만)
    """
    permission_classes = [IsSuperUser]
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor").all()
        action = self.request.query_params.get("action")
        target_type = self.request.query_params.get("target_type")
        actor = self.request.query_params.get("actor")
        if action:
            qs = qs.filter(action=action)
        if target_type:
            qs = qs.filter(target_type=target_type)
        if actor:
            qs = qs.filter(actor_id=actor)
        return qs
