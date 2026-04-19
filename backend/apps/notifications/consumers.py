"""
워크스페이스 WebSocket Consumer

연결 시 해당 워크스페이스 그룹에 참가하고,
서버에서 이벤트가 발생하면 클라이언트에 JSON 메시지를 전달합니다.

이벤트 타입:
  - issue.updated:      이슈 변경됨 (projectId, issueId 포함)
  - issue.created:      이슈 생성됨
  - issue.deleted:      이슈 삭제됨
  - notification.new:   새 알림 발생
"""

import json
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from apps.workspaces.models import WorkspaceMember


@database_sync_to_async
def is_workspace_member(user, workspace_slug):
    """사용자가 해당 워크스페이스의 멤버인지 확인"""
    if user.is_anonymous:
        return False
    return WorkspaceMember.objects.filter(
        workspace__slug=workspace_slug,
        member=user,
    ).exists()


class WorkspaceConsumer(AsyncJsonWebsocketConsumer):
    """워크스페이스별 실시간 이벤트 Consumer"""

    async def connect(self):
        self.workspace_slug = self.scope["url_route"]["kwargs"]["workspace_slug"]
        self.group_name = f"workspace_{self.workspace_slug}"
        user = self.scope.get("user")

        # 인증 + 멤버십 체크
        if not user or user.is_anonymous:
            await self.close()
            return

        if not await is_workspace_member(user, self.workspace_slug):
            await self.close()
            return

        # 워크스페이스 그룹에 참가
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # 클라이언트 → 서버 메시지는 현재 사용하지 않음 (ping/pong만)
        if content.get("type") == "ping":
            await self.send_json({"type": "pong"})

    # ── 이벤트 핸들러 (channel_layer.group_send로 호출됨) ──

    async def issue_updated(self, event):
        """이슈 변경 이벤트 → 클라이언트에 전달"""
        await self.send_json(event)

    async def issue_created(self, event):
        """이슈 생성 이벤트 → 클라이언트에 전달"""
        await self.send_json(event)

    async def issue_deleted(self, event):
        """이슈 삭제 이벤트 → 클라이언트에 전달"""
        await self.send_json(event)

    async def issue_archived(self, event):
        """이슈 보관/복원 이벤트 → 클라이언트에 전달"""
        await self.send_json(event)

    async def issue_commented(self, event):
        """댓글 작성 이벤트 → 클라이언트에 전달"""
        await self.send_json(event)

    async def issue_bulk_updated(self, event):
        """이슈 일괄 수정 이벤트 → 클라이언트에 전달"""
        await self.send_json(event)

    async def issue_bulk_deleted(self, event):
        """이슈 일괄 삭제 이벤트 → 클라이언트에 전달"""
        await self.send_json(event)

    async def event_updated(self, event):
        """프로젝트 이벤트 변경 → 클라이언트에 전달"""
        await self.send_json(event)

    async def event_created(self, event):
        """프로젝트 이벤트 생성 → 클라이언트에 전달"""
        await self.send_json(event)

    async def event_deleted(self, event):
        """프로젝트 이벤트 삭제 → 클라이언트에 전달"""
        await self.send_json(event)

    async def notification_new(self, event):
        """새 알림 이벤트 → 클라이언트에 전달"""
        await self.send_json(event)
