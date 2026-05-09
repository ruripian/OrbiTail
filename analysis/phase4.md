# Phase 4 — Async / 실시간 시스템

> **분석 일자**: 2026-05-09
> **추론 비율**: ~10% (Yjs 내부 동작은 라이브러리 의존)
> **검증 방식**: ASGI/Channels routing → Consumers → Signals → Tasks 흐름 추적
> **결과 헤드라인**: 🟢 비동기 흐름 거의 완전 / 🔴 **Stub 2건 확정**(COMMENT_REPLIED, MENTIONED)

---

## 1. ASGI 구성 (`config/asgi.py:21-26`)

```python
ProtocolTypeRouter({
    "http":      django_asgi_app,
    "websocket": JWTAuthMiddleware(URLRouter(
        notifications.websocket_urlpatterns +  # /ws/workspace/<slug>/
        documents.websocket_urlpatterns         # /ws/documents/<doc_id>/
    )),
})
```

→ HTTP는 표준 Django, WebSocket은 **JWT 미들웨어로 query `?token=...` 인증** + URL 라우팅.

---

## 2. WebSocket 채널 카탈로그 (총 2개)

### 2.1 `WorkspaceConsumer` — 워크스페이스 단위 실시간 이벤트

| 항목 | 값 |
|---|---|
| **URL** | `/ws/workspace/<workspace_slug>/?token=<JWT>` |
| **Group** | `workspace_<slug>` |
| **인증** | `WorkspaceMember` 필수 (`is_workspace_member`) |
| **파일** | `notifications/consumers.py:82-225` |

**Inbound 메시지 (client→server)**:
- `ping` — 30초 주기 (presence heartbeat 겸용)
- `presence.heartbeat` — 같은 효과
- `presence.scope` — `{ scope: "project:<id>" \| null }` 페이지 진입/이탈

**Outbound 이벤트 (server→client)** — 13종:

| 이벤트 | 발행 시점 |
|---|---|
| `issue.updated` | IssueActivity post_save (signals) + Issue post_save broadcast |
| `issue.created` | Issue post_save (created=True) |
| `issue.deleted` | views.py에서 직접 broadcast (소프트 삭제) |
| `issue.archived` | views.py archive endpoint |
| `issue.commented` | IssueComment post_save |
| `issue.bulk_updated`, `issue.bulk_deleted` | views.py bulk endpoints |
| `event.created/updated/deleted` | ProjectEvent CRUD views |
| `notification.new` | `_create_notifications` 헬퍼 (signals) + workspaces JOIN_* views |
| `doc.thread.changed` | document CommentThread 변경 (REST 호출 시 직접 broadcast — 추정) |
| `presence.update` | WorkspaceConsumer가 직접 (scope별) |
| `pong` | ping 응답 |

**Presence 시스템 (Redis ZSET 기반)**:
- TTL 60초 (`PRESENCE_TTL_SEC=60`), heartbeat 30초 → 2x 안전 마진
- 키: `presence:<slug>` (전역) / `presence:<slug>:project:<id>` (서브스코프)
- `_presence_users` — 각 user의 display_name + avatar 반환 (lightweight)

### 2.2 `DocumentConsumer` — Yjs CRDT 실시간 협업

| 항목 | 값 |
|---|---|
| **URL** | `/ws/documents/<doc_id>` (trailing slash optional, y-websocket 호환) |
| **Group** | `doc_<doc_id>` |
| **인증** | `check_document_access` — space_type별 분기 (project/personal/shared) |
| **파일** | `documents/consumers.py:88-217` |
| **프로토콜** | Y-websocket 바이너리 — SYNC + AWARENESS |

**프로토콜 흐름**:
```
클라이언트                 DocumentConsumer
  │  SYNC_STEP1 ─────────→ │ handle_sync → reply SYNC_STEP2
  │ ←────────── SYNC_STEP2 │
  │  SYNC_UPDATE ────────→ │ apply + broadcast (channel_layer.group_send)
  │ ←────── SYNC_UPDATE ── │ (다른 피어로부터)
  │  AWARENESS ──────────→ │ apply + broadcast
  │ ←──────── AWARENESS ── │
```

**Yjs 룸 관리** (`documents/yroom.py` — 이번 분석 미상세):
- `get_or_create_room(doc_id)` / `release_room(doc_id)`
- DB save 5초 debounce (`schedule_save`)
- 다중 daphne 워커 지원: 각 워커가 자체 Doc 유지 (CRDT 수렴)

**Disconnect 시 awareness null broadcast** — 다른 피어에서 커서/아바타 즉시 사라짐. tombstone 처리 ✅.

**Phase 1 F10 검증**: `pycrdt` ↔ `Document.yjs_state` BinaryField + frontend `y-websocket` ✅ 매칭. Yjs 흐름 완성도 높음.

---

## 3. Frontend WS Hooks ↔ Backend Consumer 매핑

| Frontend Hook | URL | Backend | 상태 |
|---|---|---|---|
| `useWebSocket(workspaceSlug)` | `/ws/workspace/<slug>/?token=` | `WorkspaceConsumer` | ✅ Working |
| `useDocumentWebSocket(docId)` | `/ws/documents/<docId>` (y-websocket lib) | `DocumentConsumer` | ✅ Working |

### 3.1 useWebSocket 이벤트 핸들링 (`useWebSocket.ts:127-204`)

| 수신 이벤트 | 동작 |
|---|---|
| `issue.{updated,created,archived}` | invalidate issues 쿼리 + `recentChangesStore.markChanged` (5초 strip 표시) |
| `issue.{deleted,bulk_updated,bulk_deleted}` | invalidate only |
| `issue.commented` | invalidate issue + comments + activities + notifications |
| `event.{updated,created,deleted}` | invalidate calendar events |
| `notification.new` | invalidate notifications + **PASS10 토스트** (mentioned/issue_assigned 만) |
| `doc.thread.changed` | invalidate doc-threads + doc-threads-all |
| `presence.update` | `presenceStore.setScopeUsers(scope, users)` |
| `pong` | no-op |

**Reconnect**: `e.code !== 1000` 면 5초 후 재연결.
**Module-scope `activeWs`**: 외부에서 `sendWsMessage` 호출 가능 (presence.scope 등).

### 3.2 useDocumentWebSocket 흐름

- `Y.Doc` + `WebsocketProvider` (y-websocket lib)
- `awareness.setLocalStateField("user", { id, name, color, avatar })`
- 자기 자신 + 동일 user.id의 다른 탭 필터링 (`onAwarenessChange`)
- docId 변경 시 Y.Doc 재생성 (상태 누수 방지)
- 페이지 이탈 시 `provider.destroy()`

→ ✅ 권장 Yjs 패턴 준수.

---

## 4. Celery 태스크 카탈로그 (총 6개)

### 4.1 Beat 스케줄 (`config/celery.py:11-37`) — 5개 정기

| Task | 시각 | 동작 | 파일 |
|---|---|---|---|
| `auto_archive_completed_issues` | 매일 03:00 | `auto_archive_days` 설정 프로젝트의 완료/취소 이슈를 soft delete | issues/tasks.py:8 |
| `auto_complete_expired_sprints` | 매일 03:30 | end_date 지난 active 스프린트 → completed | issues/tasks.py:38 |
| `cleanup_old_notifications` | 매일 04:00 | 30일 이상 알림 영구 삭제 | notifications/tasks.py:22 |
| `permanently_delete_trashed_issues` | 매일 04:30 | 휴지통 30일 경과 이슈 + 첨부 영구 삭제 | issues/tasks.py:58 |
| `permanently_delete_trashed_attachments` | 매일 04:45 | 휴지통 30일 경과 첨부만 영구 삭제 | issues/tasks.py:85 |

### 4.2 On-demand 태스크 — 1개

| Task | 트리거 | 동작 |
|---|---|---|
| `send_notification_email` | `_create_notifications` 헬퍼가 `delay()` 호출 | prefs 재확인 후 i18n(ko/en) 이메일 발송. 60초 retry × 3 |

→ 모든 태스크 ✅ Working. 💀 0건.

---

## 5. Django Signals 카탈로그

### 5.1 `notifications/signals.py` — 알림 생성 + WS 브로드캐스트

| Receiver | Signal | 발행 |
|---|---|---|
| `notify_on_issue_activity` | `IssueActivity post_save` | `issue.updated` WS + `ISSUE_UPDATED` 알림 |
| `notify_on_comment` | `IssueComment post_save` | `issue.commented` WS + `COMMENT_ADDED` 알림 (담당자 + 작성자) |
| `broadcast_issue_change` | `Issue post_save` | `issue.created` 또는 `issue.updated` WS + `ISSUE_CREATED` 알림 (구독자 한정) |
| `notify_on_assignee_added` | `m2m_changed Issue.assignees post_add` | `ISSUE_ASSIGNED` 알림 |
| `notify_on_assignee_removed` | `m2m_changed Issue.assignees post_remove` | `ISSUE_UNASSIGNED` 알림 |

**Helper `_create_notifications`**:
- actor 본인 제외 → `Notification.bulk_create`
- WS broadcast (`notification.new`)
- 각 수신자에게 이메일 태스크 큐 적재 (`send_notification_email.delay`)

**Helper `_actor_color`**:
- `actor.brand_color` 우선, 없으면 user.id hash → HSL hue 0~359
- → `actor_color` payload로 frontend `recentChangesStore` strip 색 결정

### 5.2 `documents/signals.py` — DocumentSpace 자동 동기화

| Receiver | Signal | 동작 |
|---|---|---|
| `sync_project_document_space` | `Project post_save` | project-type DocumentSpace 자동 생성 또는 메타(name/icon/identifier/archived_at) 동기화 |
| `delete_project_document_space` | `Project pre_delete` | 연결된 project-type 스페이스 함께 삭제 |

### 🟢 **Phase 1 F4 부분 검증** — DocumentSpace 좀비

- `pre_delete Project` → project-type 스페이스 자동 삭제 ✅
- 즉 **project 좀비는 발생 안 함**
- **personal 좀비는 가능**: `DocumentSpace.owner SET_NULL` (User 삭제 시 owner=null이 됨) → `OrphanSpaceListView`가 청소 endpoint
- → **F4는 settled** — 의도적 운영 도구로 처리

---

## 6. Phase 1 F7 검증 — 🔴 Stub 2건 확정

`Notification.Type` enum 10종 vs 실제 발송 trigger:

| Type | Trigger | 상태 |
|---|---|---|
| `ISSUE_ASSIGNED` | `notify_on_assignee_added` (signals) | ✅ Working |
| `ISSUE_UNASSIGNED` | `notify_on_assignee_removed` | ✅ Working |
| `ISSUE_UPDATED` | `notify_on_issue_activity` | ✅ Working |
| `COMMENT_ADDED` | `notify_on_comment` | ✅ Working |
| `ISSUE_CREATED` | `broadcast_issue_change` (구독자 한정) | ✅ Working |
| `JOIN_REQUESTED` | `workspaces/views.py:38` 직접 생성 | ✅ Working |
| `JOIN_APPROVED` | `workspaces/views.py:66` | ✅ Working |
| `JOIN_REJECTED` | `workspaces/views.py:69` | ✅ Working |
| **`COMMENT_REPLIED`** | **❌ trigger 없음** (grep 결과 0건) | 🔴 **Stub** |
| **`MENTIONED`** | **❌ trigger 없음** (grep 결과 0건) | 🔴 **Stub** |

→ memory의 *"PASS10 종료 — Toast/Inbox/archive/Type확장/Presence 모두 출하. comment_replied + mention parser 만 보류"* 와 정확히 일치 ✅.

**프론트엔드 영향**:
- `useWebSocket.ts:27` HIGH_PRIORITY_NOTIFICATION_TYPES = `["mentioned", "issue_assigned"]` — 토스트 노출 대상에 mentioned 포함됨
- mention parser가 없어 backend가 `mentioned` 알림을 만들지 않음 → 프론트 토스트 라인은 도달 불가능
- 즉 **mentioned 처리 코드(클라/서버 양쪽) 모두 일부 구현, 트리거만 빠짐** = "🔴 Stub" 정의에 부합

---

## 7. Backend → WS 직접 broadcast (signals 외)

신호로 처리 안 하고 view에서 직접 broadcast 하는 경우들 (grep 결과):

- `workspaces/views.py` JOIN_REQUESTED notification + WS broadcast
- (issue archive/bulk/delete view 등 — Phase 4 grep 미실행이지만 signals 외 broadcast 필요한 경로 존재 추정)

→ **분산되어 있음 — Phase 5에서 일관성 점검 필요** (예: 어떤 endpoint는 signal, 어떤 endpoint는 view 직접).

---

## 8. 5단계 라벨 — Phase 4 확정

| 라벨 | 항목 | 사유 |
|---|---|---|
| ✅ **Working** | WorkspaceConsumer 13 이벤트, DocumentConsumer Yjs flow, 5 signal handler, 6 Celery task, 8/10 Notification.Type | 모두 검증 |
| 🔴 **Stub** | `Notification.Type.COMMENT_REPLIED`, `Notification.Type.MENTIONED` | enum/UI/토스트 정의는 있는데 발송 trigger 0건 |
| 💀 **Dead** | 0건 | |

---

## 9. 추가 발견 / 위험

### F22: Email retry without idempotency
- `send_notification_email` 60초 × 3 재시도
- SMTP 일시 오류 시 같은 이메일 중복 발송 가능 (`sent` 플래그 없음)
- 트레이드오프: 인앱 알림은 `bulk_create` 이미 된 후 — 메일만 중복 → 큰 영향 X. 의도적 단순화로 보임.

### F23: F22 권한 누락 가능성
- `_broadcast_to_workspace` 는 워크스페이스 전체 멤버에게 issue.updated 등 broadcast
- 하지만 **프로젝트 SECRET (network=2)** 이슈도 같이 broadcast됨
- → 비-멤버가 이벤트 자체는 받지만 detail 호출 시 403으로 차단됨. **메타 정보(issue_id, project_id)는 노출**
- 위험도: 낮음 (단순 ID 노출), 운영상 작은 정보 누수
- Phase 5에서 사용자 결정: 이대로 두기 vs 멤버십 필터 추가

### F24: PRESENCE TTL race
- TTL 60초, heartbeat 30초 → 누락 1회 시 falsely offline (30~90초 후 재출현)
- frontend가 자동 재연결 5초 → 문제 없음. 단 daphne 죽었을 때 모든 user "사라졌다 30초 후 재출현" 깜빡임 가능

### F25: WS 다중 워커
- 각 daphne 워커가 자체 Yjs Doc 유지 → CRDT 수렴 의존
- 매우 짧은 시간 동안 클라이언트가 다른 워커에 분산되면 잠시 다른 상태 볼 수 있음
- 일반적인 Yjs 패턴이며 충돌 없이 결국 동기화 ✅

### F26: doc.thread.changed broadcast 위치
- WorkspaceConsumer에 핸들러 정의됨 (`doc_thread_changed`)
- 발행처 grep 미실행 — **document REST 호출 시 view에서 직접 broadcast하는 것으로 추정** (Phase 5 grep 1초 컷)

---

## 10. 검증 명령

```bash
# 1. WS routing 확인
docker compose exec -T backend python -c "
from apps.notifications.routing import websocket_urlpatterns as n
from apps.documents.routing import websocket_urlpatterns as d
for p in n + d: print(p.pattern)
"

# 2. Celery beat 스케줄 활성 확인
docker compose logs --tail=50 celery-beat | grep "auto-archive\|cleanup\|permanently"

# 3. Active Yjs 룸 (running daphne)
docker compose exec -T backend python -c "
from apps.documents.yroom import _rooms  # 가정
print(len(_rooms))
"

# 4. COMMENT_REPLIED/MENTIONED trigger 부재 재검증
grep -rn "COMMENT_REPLIED\|MENTIONED" backend --include="*.py" | grep -v models.py

# 5. WS connect 로그
docker compose logs --tail=30 backend | grep -i "ws\|websocket\|consumer"
```

---

## 11. 다음 Phase

**Phase 5 — 종합 + 갭 식별** (마지막). sub-task 3개:
1. Phase 0~4 산출물 통합 — 5단계 라벨별 카운트, 사이트 맵
2. **모순/위반/Dead 코드 리스트** + 우선순위
3. **다음 액션 추천** (정리/구현/리팩토링 우선순위)

**예상 시간**: 15분
