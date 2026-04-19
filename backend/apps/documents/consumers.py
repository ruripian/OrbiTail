"""
문서 실시간 동시 편집 WebSocket Consumer

Yjs 바이너리 프로토콜을 처리하여 동일 문서를 편집하는
여러 클라이언트 간에 CRDT 업데이트를 브로드캐스트합니다.

DB 저장은 마지막 업데이트 후 5초 debounce.
"""

import asyncio
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async


@database_sync_to_async
def check_document_access(user, doc_id):
    """문서 접근 권한 확인"""
    if user.is_anonymous:
        return False
    from .models import Document, DocumentSpace
    try:
        doc = Document.objects.select_related("space", "space__project").get(pk=doc_id, deleted_at__isnull=True)
    except Document.DoesNotExist:
        return False

    space = doc.space
    if space.space_type == "project" and space.project:
        from apps.projects.models import ProjectMember
        return ProjectMember.objects.filter(project=space.project, member=user).exists()
    elif space.space_type == "personal":
        return space.owner_id == user.id
    else:
        from apps.workspaces.models import WorkspaceMember
        return WorkspaceMember.objects.filter(workspace=space.workspace, member=user).exists()


@database_sync_to_async
def load_yjs_state(doc_id):
    """DB에서 Yjs 상태 로드"""
    from .models import Document
    try:
        doc = Document.objects.get(pk=doc_id)
        return bytes(doc.yjs_state) if doc.yjs_state else None
    except Document.DoesNotExist:
        return None


@database_sync_to_async
def save_yjs_state(doc_id, state_bytes, content_html=""):
    """Yjs 상태를 DB에 저장"""
    from .models import Document
    Document.objects.filter(pk=doc_id).update(
        yjs_state=state_bytes,
        content_html=content_html,
    )


class DocumentConsumer(AsyncWebsocketConsumer):
    """Yjs 동기화 WebSocket consumer.

    바이너리 메시지를 같은 문서 그룹에 브로드캐스트.
    DB 저장은 debounce (5초 후 마지막 상태만 저장).
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.doc_id = None
        self.group_name = None
        self.save_task = None

    async def connect(self):
        self.doc_id = self.scope["url_route"]["kwargs"]["doc_id"]
        self.group_name = f"doc_{self.doc_id}"
        user = self.scope.get("user")

        if not user or user.is_anonymous:
            await self.close()
            return

        if not await check_document_access(user, self.doc_id):
            await self.close()
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # 기존 Yjs 상태가 있으면 전송
        state = await load_yjs_state(self.doc_id)
        if state:
            await self.send(bytes_data=state)

    async def disconnect(self, code):
        if self.group_name:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        # 마지막 저장 실행
        if self.save_task:
            self.save_task.cancel()

    async def receive(self, bytes_data=None, text_data=None, **kwargs):
        if not bytes_data:
            return

        # 다른 클라이언트에 브로드캐스트
        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "yjs.update",
                "data": bytes_data,
                "sender": self.channel_name,
            },
        )

        # DB 저장 debounce (5초)
        if self.save_task:
            self.save_task.cancel()
        self.save_task = asyncio.ensure_future(self._debounce_save(bytes_data))

    async def yjs_update(self, event):
        """다른 클라이언트의 업데이트 수신 — 자신은 제외"""
        if event["sender"] != self.channel_name:
            await self.send(bytes_data=event["data"])

    async def _debounce_save(self, state_bytes):
        """5초 대기 후 DB 저장"""
        await asyncio.sleep(5)
        await save_yjs_state(self.doc_id, state_bytes)
