"""
문서 실시간 동시 편집 WebSocket Consumer

y-websocket 바이너리 프로토콜을 파싱해 서버 측 Y.Doc/Awareness와 동기화한 뒤
같은 문서를 보고 있는 모든 피어에게 릴레이한다.

프로토콜 개요:
  outer: [YMessageType (1 byte)][inner payload]
    - YMessageType.SYNC(0): inner[0] = YSyncMessageType (STEP1/STEP2/UPDATE)
    - YMessageType.AWARENESS(1): inner 전체가 awareness update

참고:
  - 서버 Doc에 적용 + DB debounce save (5초) — 룸 관리는 yroom.py 담당.
  - 다중 daphne 워커 지원: channel_layer 브로드캐스트로 피어 전달.
    각 워커가 자체 Doc을 유지하지만 CRDT 수렴 특성상 자연히 일관됨.
"""

from __future__ import annotations

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from pycrdt import Decoder, YMessageType, YSyncMessageType, read_message
from pycrdt._sync import create_awareness_message

from .yroom import get_or_create_room, release_room


def _parse_first_client_id(inner_awareness_bytes: bytes):
    """AWARENESS inner payload에서 첫 번째 clientID 파싱.
    y-websocket 클라이언트는 자신의 awareness만 보내므로 이것이 이 커넥션의 client id.
    포맷: [msg_length_varint][num_clients_varint][clientID_varint][clock_varint][state_json_length_varint][state_json]..."""
    try:
        payload = read_message(inner_awareness_bytes)
        dec = Decoder(payload)
        num = dec.read_var_uint()
        if num >= 1:
            return dec.read_var_uint()
    except Exception:
        pass
    return None


WS_CODE_UNAUTHORIZED = 4001
WS_CODE_FORBIDDEN = 4003
WS_CODE_NOT_FOUND = 4004


# ──────────────────────────────────────────────────────────────
# 접근 권한 — 문서 앱의 space_type별로 멤버십 검사
# ──────────────────────────────────────────────────────────────

def document_role(user, doc_id: str):
    """이 사용자가 문서에서 갖는 스페이스 등급 (없으면 None). 동기 함수 — HTTP 뷰가 그대로 부른다.

    전에는 공용 스페이스를 "워크스페이스 멤버면 통과"로 봐서 비공개 공용 스페이스가 뚫렸고, 등급도
    보지 않아 읽기 전용 사용자가 편집을 흘려 넣을 수 있었다. 문서 앱의 _space_role 하나로 판정한다.
    """
    if user is None or user.is_anonymous:
        return None
    from .models import Document
    from .views import _space_role

    doc = Document.objects.select_related("space", "space__workspace", "space__project").filter(
        pk=doc_id, deleted_at__isnull=True,
    ).first()
    if doc is None:
        return None
    return _space_role(user, doc.space)


def check_document_access(user, doc_id: str) -> bool:
    return document_role(user, doc_id) is not None


async_document_role = database_sync_to_async(document_role)


# ──────────────────────────────────────────────────────────────
# Consumer
# ──────────────────────────────────────────────────────────────

class DocumentConsumer(AsyncWebsocketConsumer):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.doc_id: str | None = None
        self.group_name: str | None = None
        self.room = None
        self.can_edit = False
        self._client_id: int | None = None  # Awareness client id 추적

    # -- lifecycle ----------------------------------------------------

    async def connect(self):
        self.doc_id = self.scope["url_route"]["kwargs"]["doc_id"]
        user = self.scope.get("user")

        if not user or user.is_anonymous:
            await self.close(code=WS_CODE_UNAUTHORIZED)
            return

        role = await async_document_role(user, self.doc_id)
        if role is None:
            await self.close(code=WS_CODE_FORBIDDEN)
            return
        from .models import DocumentSpaceMember
        self.can_edit = role >= DocumentSpaceMember.Role.EDITOR

        self.group_name = f"doc_{self.doc_id}"
        self.room = await get_or_create_room(self.doc_id)

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # 기존 접속자의 awareness 상태를 새로 들어온 클라이언트에게 전달 —
        # 이 초기 전송 없으면 신규 참여자는 기존 피어를 인지 못 함(아바타/커서 안 보임).
        # tombstone(끊긴 피어 잔해)는 전달하지 않음 — user 필드가 살아 있는 것만.
        try:
            live_ids = []
            for cid, state in self.room.awareness.states.items():
                if state and isinstance(state, dict) and state.get("user"):
                    live_ids.append(cid)
            if live_ids:
                aw_payload = self.room.awareness.encode_awareness_update(live_ids)
                await self.send(bytes_data=create_awareness_message(aw_payload))
        except Exception:
            pass

    async def disconnect(self, code):
        # 퇴장 알림 — 다른 피어에서 커서/아바타 즉시 사라지도록 null awareness 브로드캐스트.
        # (group_discard 이전에 수행해야 메시지가 전파됨.)
        if self.room and self._client_id is not None and self.group_name:
            try:
                self.room.remove_awareness_client(self._client_id)
                aw_payload = self.room.awareness.encode_awareness_update([self._client_id])
                msg = create_awareness_message(aw_payload)
                await self.channel_layer.group_send(self.group_name, {
                    "type": "yjs.relay",
                    "data": msg,
                    "sender": self.channel_name,
                })
            except Exception:
                pass
        if self.group_name:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        if self.room:
            await release_room(self.doc_id)

    # -- messages -----------------------------------------------------

    async def receive(self, bytes_data=None, text_data=None, **_):
        if bytes_data:
            await self._handle_binary(bytes_data)
        # text_data는 현재 미사용 (향후 클라이언트→서버 JSON 이벤트용 예약)

    async def _handle_binary(self, data: bytes) -> None:
        if not data or self.room is None:
            return

        msg_type = data[0]
        inner = data[1:]

        if msg_type == YMessageType.SYNC.value:
            await self._handle_sync(inner, data)
        elif msg_type == YMessageType.AWARENESS.value:
            await self._handle_awareness(inner, data)
        # 알 수 없는 타입은 무시

    async def _handle_sync(self, inner: bytes, original: bytes) -> None:
        if not inner:
            return

        # 실제 편집(SYNC_UPDATE)일 때만 다른 피어에 릴레이 + 저장 예약.
        # SYNC_STEP1/STEP2는 핸드셰이크라 브로드캐스트 불필요.
        subtype = inner[0]
        # 편집 권한이 없으면 편집을 받지도, 퍼뜨리지도, 저장하지도 않는다
        if subtype in (YSyncMessageType.SYNC_STEP2.value, YSyncMessageType.SYNC_UPDATE.value) and not self.can_edit:
            return
        reply = self.room.handle_sync(inner)
        if reply:
            await self.send(bytes_data=reply)
        if subtype == YSyncMessageType.SYNC_UPDATE.value:
            await self.channel_layer.group_send(self.group_name, {
                "type": "yjs.relay",
                "data": original,
                "sender": self.channel_name,
            })
            await self.room.schedule_save()

    async def _handle_awareness(self, inner: bytes, original: bytes) -> None:
        try:
            self.room.apply_awareness_update(inner, origin=self.channel_name)
        except Exception:
            # 악의적/불완전 awareness update는 조용히 무시
            pass

        # 이 커넥션의 client_id를 첫 awareness에서 기록 — disconnect 시 정리용
        if self._client_id is None:
            cid = _parse_first_client_id(inner)
            if cid is not None:
                self._client_id = cid

        # 항상 다른 피어에게 릴레이
        await self.channel_layer.group_send(self.group_name, {
            "type": "yjs.relay",
            "data": original,
            "sender": self.channel_name,
        })

    # -- channel layer handler ----------------------------------------

    async def yjs_relay(self, event):
        """그룹 브로드캐스트 수신 — 자신이 보낸 메시지는 제외."""
        if event["sender"] == self.channel_name:
            return
        await self.send(bytes_data=event["data"])
