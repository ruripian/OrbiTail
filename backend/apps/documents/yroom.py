"""
YRoom — 문서별 Y.Doc + Awareness 상태 관리자.

추후 Hocuspocus 등 외부 서비스로 교체할 때 이 파일의 퍼블릭 API(get_or_create_room,
release_room, YRoom.handle_sync, apply_awareness_update, schedule_save)만 유지하면
DocumentConsumer 변경 없이 갈아끼울 수 있도록 분리.

설계 메모:
  - 워커(daphne 프로세스)마다 자체 Doc/Awareness 보유. 다중 워커 간 동기화는
    channel_layer(Redis) 브로드캐스트 + CRDT 수렴으로 자연히 이뤄짐.
  - DB 저장은 5초 idle debounce. 마지막 접속 해제 시 즉시 저장 후 메모리 eviction.
  - `yjs_state = NULL`인 신규 문서는 첫 연결 클라이언트에게 시드 권한 플래그를
    반환해 서버 단일 source-of-truth를 유지한다 (Consumer에서 JSON 메시지로 전달).
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

from channels.db import database_sync_to_async
from pycrdt import Awareness, Doc, handle_sync_message, read_message


# ──────────────────────────────────────────────────────────────
# 전역 룸 레지스트리 — 워커 프로세스 당 하나
# ──────────────────────────────────────────────────────────────

_rooms: Dict[str, "YRoom"] = {}
_rooms_lock = asyncio.Lock()


# ──────────────────────────────────────────────────────────────
# DB I/O — sync ORM, database_sync_to_async로 감싸서 호출
# ──────────────────────────────────────────────────────────────

def _load_state(doc_id: str) -> Optional[bytes]:
    from .models import Document
    try:
        row = Document.objects.only("yjs_state").get(pk=doc_id)
    except Document.DoesNotExist:
        return None
    return bytes(row.yjs_state) if row.yjs_state else None


def _save_state(doc_id: str, state: bytes) -> None:
    """부분 업데이트(yjs_state만). content_html은 별도 REST 경로에서 관리."""
    from .models import Document
    Document.objects.filter(pk=doc_id).update(yjs_state=state)


def _has_state(doc_id: str) -> bool:
    from .models import Document
    return Document.objects.filter(pk=doc_id).exclude(yjs_state__isnull=True).exists()


# ──────────────────────────────────────────────────────────────
# YRoom
# ──────────────────────────────────────────────────────────────

class YRoom:
    """단일 문서의 서버 측 CRDT 상태."""

    SAVE_DEBOUNCE_SEC = 5.0

    def __init__(self, doc_id: str):
        self.doc_id = doc_id
        self.doc = Doc()
        self.awareness = Awareness(self.doc)
        self.connections = 0
        self.had_state_on_load = False
        self._save_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        # pycrdt Awareness의 주기적 outdated state 정리 태스크 시작 — 연결 끊긴
        # 피어의 tombstone이 일정 시간 후 states에서 제거되도록.
        try:
            self.awareness.start()
        except Exception:
            pass

    async def load_from_db(self) -> None:
        state = await database_sync_to_async(_load_state)(self.doc_id)
        if state:
            self.doc.apply_update(state)
            self.had_state_on_load = True

    # -- y-protocol 핸들러 ---------------------------------------------

    def handle_sync(self, inner_message: bytes) -> Optional[bytes]:
        """
        SYNC 메시지(outer YMessageType 바이트 제외한 나머지)를 처리.
        SYNC_STEP1을 받으면 full 상태의 SYNC_STEP2(outer 포함)을 반환.
        SYNC_STEP2/UPDATE는 Doc에 적용 후 None 반환.
        """
        return handle_sync_message(inner_message, self.doc)

    def apply_awareness_update(self, payload: bytes, origin: Any) -> None:
        """AWARENESS 메시지 페이로드(outer 바이트 제외)를 적용."""
        update = read_message(payload)
        self.awareness.apply_awareness_update(update, origin)

    def remove_awareness_client(self, client_id: int) -> None:
        """클라이언트 disconnect 시 자신의 상태 정리. 다른 피어가 받아 커서도 제거."""
        try:
            self.awareness.remove_awareness_states([client_id], origin=None)
        except Exception:
            # pycrdt 버전에 따라 API 상이할 수 있음 — 조용히 실패
            pass

    # -- 저장 디바운스 --------------------------------------------------

    async def schedule_save(self) -> None:
        if self._save_task and not self._save_task.done():
            self._save_task.cancel()
        self._save_task = asyncio.create_task(self._debounced_save())

    async def _debounced_save(self) -> None:
        try:
            await asyncio.sleep(self.SAVE_DEBOUNCE_SEC)
        except asyncio.CancelledError:
            return
        await self._save_now()

    async def _save_now(self) -> None:
        async with self._lock:
            try:
                state = self.doc.get_update()
            except Exception:
                return
            await database_sync_to_async(_save_state)(self.doc_id, state)

    async def flush(self) -> None:
        """대기 중인 디바운스를 지금 바로 저장."""
        if self._save_task and not self._save_task.done():
            self._save_task.cancel()
        await self._save_now()


# ──────────────────────────────────────────────────────────────
# 레지스트리 연산 — Consumer에서 사용
# ──────────────────────────────────────────────────────────────

async def get_or_create_room(doc_id: str) -> YRoom:
    async with _rooms_lock:
        room = _rooms.get(doc_id)
        if room is None:
            room = YRoom(doc_id)
            await room.load_from_db()
            _rooms[doc_id] = room
        room.connections += 1
        return room


async def release_room(doc_id: str) -> None:
    async with _rooms_lock:
        room = _rooms.get(doc_id)
        if room is None:
            return
        room.connections -= 1
        if room.connections > 0:
            return
        _rooms.pop(doc_id, None)
    # 락 해제 후 flush — DB I/O가 오래 걸려도 다른 룸 연산 블록하지 않게
    await room.flush()
    try:
        room.awareness.stop()
    except Exception:
        pass


async def room_has_state(doc_id: str) -> bool:
    """시드 권한 계산용 — 현재 워커 메모리가 아닌 DB 기준."""
    return await database_sync_to_async(_has_state)(doc_id)
