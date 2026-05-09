# PASS10 — 알림 / Activity / 실시간 (Concrete)

> **전제**: PASS5~9 완료.
> **목표**: 워크스페이스 차원의 활동 가시성 + Inbox + WebSocket pulse 시각화.
> **회귀 위험**: 중간 (백엔드 알림 트리거 정의 필요, 라우팅 추가).

---

## 현재 상태 (이미 있는 것)

- `notificationsApi` (list / unreadCount / markAsRead / markAllAsRead / preferences) ✅
- `useWebSocket` hook + `notification.new` 이벤트 invalidate ✅
- `TopBar` 우측 알림 dropdown (read/markAll, 20개 제한) ✅
- `NotificationsPage` (워크스페이스/프로젝트 단위 preferences) ✅
- `NotificationType` 4종: `issue_assigned | issue_updated | comment_added | mentioned` ✅
- `recentChangesStore` (다른 사용자 변경 5초 strip — PASS3에서 도입) ✅

**없는 것**:
- 알림 전용 풀 페이지 (Inbox)
- 알림 그룹화 / 필터 (today / week / archive)
- 단순 invalidate가 아닌 toast pop-up
- 보드/리스트의 다중 사용자 presence
- 같은 이슈 동시 편집 시 충돌 감지

---

## Step 1 — Inbox 페이지

### 라우팅

```
/:workspaceSlug/inbox
```

`router/index.tsx`에 라우트 추가, sidebar에 Inbox 항목 추가 (TopBar 종 아이콘 위치는 유지하되 "Open Inbox" 링크가 dropdown 하단에).

### 작업

**신규 파일**: `frontend/src/pages/workspace/InboxPage.tsx`

UI 구조:
```
┌─────────────────────────────────────────┐
│ Inbox                  [All] [Unread] ▼ │
│ ─────────────────────────────────────── │
│ Today                                   │
│ ◉ @username mentioned you in #ISSUE-12  │
│   "...could you check the auth flow?"   │
│   2 minutes ago · Project A             │
│ ◉ ...                                   │
│ ─────────────────────────────────────── │
│ This week                               │
│ ○ Issue #34 was assigned to you         │
│ ─────────────────────────────────────── │
│ Earlier                                 │
│ ○ ... [Mark all as read]                │
└─────────────────────────────────────────┘
```

각 알림 row:
- 좌측: read/unread dot + 아이콘 (NotificationType별)
- 본문: 제목 + 1줄 미리보기
- 우측: timestamp + project name + actions (read toggle, archive)
- 클릭: 해당 이슈/댓글 deep link로 이동 (`/{ws}/projects/{p}/issues/{i}#comment-{c}`)

### 그룹화 로직

```ts
function groupByDate(notifications: Notification[]) {
  const today = startOfDay(new Date());
  const weekAgo = subDays(today, 7);
  return {
    today: notifications.filter(n => isAfter(n.created_at, today)),
    week: notifications.filter(n => isAfter(n.created_at, weekAgo) && isBefore(n.created_at, today)),
    earlier: notifications.filter(n => isBefore(n.created_at, weekAgo)),
  };
}
```

### Filter

상단 토글: All / Unread / Mentions only / Assigned to me

```ts
type Filter = "all" | "unread" | "mentions" | "assigned";
```

URL 쿼리 동기화: `?filter=unread`.

### Archive

`Notification` 타입에 `archived_at` 추가 (백엔드 변경). UI에서 archive 버튼 → 목록에서 사라짐, "Archived" 탭에서 확인 가능.

---

## Step 2 — 알림 트리거 정의 + 백엔드 협업

### 트리거 매트릭스 (정의 후 백엔드 티켓)

| Type | 발동 조건 | 우선순위 |
|---|---|---|
| `mentioned` | 댓글/이슈 description에서 @username | 높음 (즉시) |
| `assignee_added` | 본인이 assignee로 추가됨 | 높음 |
| `assignee_removed` | 본인이 assignee에서 제거됨 | 중간 |
| `due_soon` | 본인 담당 이슈의 due_date가 24시간 이내 | 중간 (스케줄러) |
| `state_changed` | 본인 담당 이슈의 state 변경 | 중간 |
| `comment_replied` | 본인 댓글에 답글 | 높음 |
| `subscribed_issue_updated` | watching한 이슈에 변경 (assignee 외) | 낮음 |

위 7개에 대해 사용자별 on/off 설정 (PreferencesPage에 이미 있는 구조 확장).

### 프론트 작업

`api/notifications.ts`의 `NotificationType` 확장:
```ts
export type NotificationType =
  | "mentioned"
  | "issue_assigned"
  | "issue_unassigned"
  | "issue_updated"
  | "comment_added"
  | "comment_replied"
  | "due_soon";
```

`NotificationIcon` 컴포넌트도 case 추가.

---

## Step 3 — Toast Pop-up (실시간 피드)

### 현재

WebSocket `notification.new` → invalidate만 → 사용자가 종 아이콘 dropdown 열어야 봄.

### 작업

`useWebSocket.ts`의 `notification.new` 핸들러:

```ts
case "notification.new": {
  const { notification } = msg.payload;
  qc.invalidateQueries({ queryKey: ["notifications", workspaceSlug] });
  qc.invalidateQueries({ queryKey: ["notifications-unread", workspaceSlug] });

  // ★ 추가: 우선순위 높은 type만 toast
  const HIGH = ["mentioned", "issue_assigned", "comment_replied"];
  if (HIGH.includes(notification.type)) {
    toast(notification.title, {
      description: notification.preview,
      action: { label: t("notifications.view"), onClick: () => navigate(notification.deep_link) },
      duration: 6000,
    });
  }
  break;
}
```

사용자 옵션: PreferencesPage에 "Show toast for high-priority notifications" 토글 (기본 ON).

---

## Step 4 — Presence (Figma 패턴 일부)

### 보드/리스트에서 다른 사용자 위치 표시

같은 워크스페이스의 같은 페이지를 보고 있는 사용자 아바타를 TopBar 우측에 stack:

```
[👤 Alice viewing] [👤 Bob editing #42]
```

### 백엔드 협업

- 새 WS 이벤트 `presence.join` / `presence.leave` / `presence.focus` 정의
- 페이지 진입 시 `presence.join({page: "/board/projectId"})`
- 5초마다 heartbeat
- 30초 무응답 시 leave

### 프론트

**신규 hook**: `frontend/src/hooks/usePresence.ts`

```ts
export function usePresence(pageKey: string): User[] {
  const [users, setUsers] = useState<User[]>([]);
  // ws.send presence.join, listen presence.update, ws.send presence.leave on unmount
  return users;
}
```

**신규 컴포넌트**: `frontend/src/components/layout/PresenceStack.tsx`

`AppLayout` 또는 `TopBar`에 통합. 최대 5명 표시 + "+N more".

---

## Step 5 — WS Pulse 확장 (PASS3 후속)

PASS3에서 `recentChangesStore` 5초 strip을 도입. 이번 PASS에서:

- 같은 이슈에 다른 사용자가 동시 편집 시 inline 경고:
  ```
  ⚠ Bob is editing this issue right now
  ```
  IssueDetailPage 헤더 상단 strip.

- 보드에서 다른 사용자가 dnd 한 카드는 200ms ripple 추가 (현재 5초 strip만 있음).

```css
@keyframes pulse-ripple {
  from { box-shadow: 0 0 0 0 var(--user-color); }
  to   { box-shadow: 0 0 0 12px transparent; }
}
[data-recently-moved] {
  animation: pulse-ripple 600ms var(--ease-orbit);
}
```

---

## Step 6 — Email / Slack 통합 (선택, 별도 PR)

워크스페이스 admin이 통합 활성화 시 알림 mirror:

- Email: 백엔드 작업 100%, 프론트는 PreferencesPage에 "Forward to email" 토글만
- Slack: OAuth 연동 페이지 + 채널 선택 UI

이 단계는 사용자 시그널 보고 결정.

---

## 체크리스트

- [ ] InboxPage 라우트 + 사이드바 nav
- [ ] 그룹화 (today / week / earlier)
- [ ] Filter (all / unread / mentions / assigned)
- [ ] Archive 액션 (백엔드 archived_at 필드 협업)
- [ ] NotificationType 7종 확장 + 백엔드 티켓
- [ ] NotificationIcon case 추가
- [ ] Toast pop-up (high-priority만, 사용자 옵션)
- [ ] Presence hook + PresenceStack
- [ ] 동시 편집 inline 경고
- [ ] 보드 dnd ripple 애니메이션
- [ ] PreferencesPage에 "Forward to email" 토글
- [ ] i18n 키 ko/en (~30개)

---

## 비목표

- ❌ Mobile push notification — 별도 트랙
- ❌ Slack 통합 — 시그널 후 결정
- ❌ Activity feed 페이지 (워크스페이스 전체) — 별도 트랙

---

## 작업 시간 추정

5~7일 (백엔드 협업 시간 별도).
