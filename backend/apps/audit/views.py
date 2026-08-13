from apps.admin_console.base import (
    AdminResourceListView,
    as_datetime,
    as_datetime_end,
)

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogListView(AdminResourceListView):
    """감사 로그 목록 — 슈퍼유저 전용.

    검색은 행위자/대상 라벨을 본다. 대상은 삭제 후에도 라벨 스냅샷이 남으므로
    "삭제된 그 워크스페이스" 를 이름으로 되찾을 수 있다.
    """
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.select_related("actor").all()

    search_fields = ["actor_label", "target_label"]
    filter_spec = {
        "action": "action",
        "target_type": "target_type",
        "actor": "actor_id",
        "created_after": ("created_at__gte", as_datetime),
        "created_before": ("created_at__lte", as_datetime_end),
    }
    ordering_allow = ["created_at", "action"]
