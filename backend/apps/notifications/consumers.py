"""
워크스페이스 WebSocket Consumer

연결 시 해당 워크스페이스 그룹에 참가하고,
서버에서 이벤트가 발생하면 클라이언트에 JSON 메시지를 전달합니다.

이벤트 타입:
  - issue.updated:      이슈 변경됨 (projectId, issueId 포함)
  - issue.created:      이슈 생성됨
  - issue.deleted:      이슈 삭제됨
  - notification.new:   새 알림 발생
  - presence.update:    워크스페이스에 접속 중인 사용자 목록 변경 (PASS10)
"""

import time
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django_redis import get_redis_connection
from apps.workspaces.models import WorkspaceMember
from apps.accounts.models import User

# Presence TTL — 이 시간 동안 heartbeat 없으면 offline 으로 간주.
# Frontend 는 30s 마다 heartbeat 보내야 함 (consumer 가 각 메시지마다 score refresh).
PRESENCE_TTL_SEC = 60


def _presence_key(workspace_slug, scope=None):
    """scope 가 None 이면 워크스페이스 전역, 아니면 'project:{id}' 같은 서브스코프."""
    if scope:
        return f"presence:{workspace_slug}:{scope}"
    return f"presence:{workspace_slug}"


def _presence_add(workspace_slug, user_id, scope=None):
    """사용자를 presence ZSET 에 추가 (score=만료 시각)."""
    conn = get_redis_connection("default")
    key = _presence_key(workspace_slug, scope)
    expires_at = time.time() + PRESENCE_TTL_SEC
    conn.zadd(key, {str(user_id): expires_at})
    conn.expire(key, PRESENCE_TTL_SEC * 2)  # ZSET 자체 garbage collection 안전망


def _presence_remove(workspace_slug, user_id, scope=None):
    conn = get_redis_connection("default")
    conn.zrem(_presence_key(workspace_slug, scope), str(user_id))


def _presence_list_ids(workspace_slug, scope=None):
    """현재 접속 중인 user_id 리스트. 만료된 항목은 ZSET 에서 즉시 제거."""
    conn = get_redis_connection("default")
    key = _presence_key(workspace_slug, scope)
    now = time.time()
    conn.zremrangebyscore(key, 0, now)
    raw = conn.zrange(key, 0, -1)
    return [m.decode() if isinstance(m, bytes) else m for m in raw]


@database_sync_to_async
def _presence_users(workspace_slug, scope=None):
    """presence 사용자 상세 — display_name + avatar 만 가볍게 반환."""
    ids = _presence_list_ids(workspace_slug, scope)
    if not ids:
        return []
    users = User.objects.filter(id__in=ids).only("id", "display_name", "avatar")
    return [
        {"id": str(u.id), "display_name": u.display_name, "avatar": u.avatar.url if u.avatar else None}
        for u in users
    ]


@database_sync_to_async
def is_workspace_member(user, workspace_slug):
    """사용자가 해당 워크스페이스의 멤버인지 확인"""
    if user.is_anonymous:
        return False
    return WorkspaceMember.objects.filter(
        workspace__slug=workspace_slug,
        member=user,
    ).exists()


@database_sync_to_async
def _user_secret_project_ids(user, workspace_slug):
    """사용자가 멤버로 속한 SECRET 프로젝트 id 목록."""
    from apps.projects.models import Project, ProjectMember
    return [
        str(pid) for pid in ProjectMember.objects.filter(
            member=user,
            project__workspace__slug=workspace_slug,
            project__network=Project.Network.SECRET,
        ).values_list("project_id", flat=True)
    ]


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

        # 멤버십이 connect 이후 변경되면 reconnect(=새로고침) 시 반영.
        secret_ids = await _user_secret_project_ids(user, self.workspace_slug)
        self.secret_project_groups = [
            f"workspace_{self.workspace_slug}_project_{pid}" for pid in secret_ids
        ]
        for group in self.secret_project_groups:
            await self.channel_layer.group_add(group, self.channel_name)

        await self.accept()

        # Presence: 본인 등록 + 워크스페이스 전체에 갱신된 목록 broadcast
        self.user_id = str(user.id)
        # current_scope: 사용자가 현재 보고 있는 서브 페이지 (예: 'project:<id>').
        # None 이면 전역 워크스페이스(=특정 페이지 안 봄). 프론트가 페이지 mount 시 scope 셋.
        self.current_scope = None
        await database_sync_to_async(_presence_add)(self.workspace_slug, self.user_id)
        await self._broadcast_presence(None)

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        for group in getattr(self, "secret_project_groups", []):
            await self.channel_layer.group_discard(group, self.channel_name)
        if hasattr(self, "user_id"):
            await database_sync_to_async(_presence_remove)(self.workspace_slug, self.user_id)
            await self._broadcast_presence(None)
            scope = getattr(self, "current_scope", None)
            if scope:
                await database_sync_to_async(_presence_remove)(self.workspace_slug, self.user_id, scope)
                await self._broadcast_presence(scope)

    async def receive_json(self, content, **kwargs):
        msg_type = content.get("type")
        if msg_type == "ping":
            await self.send_json({"type": "pong"})
            # ping 은 30s 주기 — presence heartbeat 도 동시에 갱신 (별도 메시지 줄이려고)
            if hasattr(self, "user_id"):
                await database_sync_to_async(_presence_add)(self.workspace_slug, self.user_id)
                if self.current_scope:
                    await database_sync_to_async(_presence_add)(
                        self.workspace_slug, self.user_id, self.current_scope,
                    )
        elif msg_type == "presence.heartbeat":
            if hasattr(self, "user_id"):
                await database_sync_to_async(_presence_add)(self.workspace_slug, self.user_id)
                if self.current_scope:
                    await database_sync_to_async(_presence_add)(
                        self.workspace_slug, self.user_id, self.current_scope,
                    )
        elif msg_type == "presence.scope":
            # 프론트가 페이지에 들어가거나 떠날 때 scope 변경 알림.
            # body: {"scope": "project:<id>"} 또는 {"scope": null} (clear).
            new_scope = content.get("scope") or None
            if not hasattr(self, "user_id"):
                return
            old_scope = self.current_scope
            if old_scope == new_scope:
                return
            if old_scope:
                await database_sync_to_async(_presence_remove)(
                    self.workspace_slug, self.user_id, old_scope,
                )
                await self._broadcast_presence(old_scope)
            self.current_scope = new_scope
            if new_scope:
                await database_sync_to_async(_presence_add)(
                    self.workspace_slug, self.user_id, new_scope,
                )
                await self._broadcast_presence(new_scope)

    async def _broadcast_presence(self, scope):
        """presence 목록을 워크스페이스 그룹에 broadcast.
        scope=None 이면 전역 (현재 프론트는 안 쓰지만 호환 유지).
        scope='project:<id>' 등이면 클라이언트가 자기 scope 와 매칭해서 표시.
        """
        users = await _presence_users(self.workspace_slug, scope)
        await self.channel_layer.group_send(
            self.group_name,
            {"type": "presence.update", "scope": scope, "users": users},
        )

    async def presence_update(self, event):
        """presence.update 이벤트 → 클라이언트에 전달"""
        await self.send_json(event)

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

    async def doc_thread_changed(self, event):
        """문서 댓글 스레드 생성/답글/resolve/삭제 → 클라이언트에 전달"""
        await self.send_json(event)
