# Phase 3 — Frontend 도메인

> **분석 일자**: 2026-05-09
> **추론 비율**: < 5%
> **검증 방식**: router 진입점 추적 + grep 사용처 매핑
> **결과 헤드라인**: ✅ 거의 모두 Working / 💀 **Dead 3건 발견** / Phase 2 의심 3건 모두 해소

---

## 1. 라우트 트리 (router/index.tsx 단일 파일, 262 라인)

### 1.1 최상위 구조

```
ChromeAttributeWrapper (data-chrome 속성 부여 — branded/minimal/document)
└── Routes:
    ├─ /auth/* (5)         — login/register/verify-email/forgot-password/reset-password
    ├─ /invite/:token      — InviteAcceptPage (인증 무관)
    ├─ /s/:token          — PublicDocumentPage (공개 공유, lazy)
    ├─ /create-workspace  — CreateWorkspacePage
    ├─ /                  — WorkspaceSelectPage (인증 후 첫 진입)
    ├─ /:workspaceSlug    — AppLayout (워크스페이스 컨테이너)
    │   ├─ index → WorkspaceDashboard
    │   ├─ inbox / announcements
    │   ├─ projects/{create,discover,archived}
    │   ├─ projects/:projectId/{issues,board,categories,sprints,sprints/:sprintId/issues,categories/:categoryId/issues,request,archive,trash}
    │   ├─ projects/:projectId/settings/{general,members,workflow,automation} + 5 legacy redirects
    │   ├─ settings/{profile,preferences,security}
    │   ├─ workspace-settings/{members,join-requests}
    │   └─ admin/{users,orphan-spaces,attachments,workspaces,superusers,audit}
    └─ /:workspaceSlug/documents — DocumentLayout (문서 전용 레이아웃)
        └─ index, space/:spaceId(/explorer|/settings|/:docId)
```

### 1.2 라우트 외 진입점

- **`main.tsx:35-62`** `AppBootstrap` — 부팅 시 `setupApi.getStatus()` 호출 → 미초기화면 `SetupPage` 직접 렌더 (라우터 우회). ✅ 의도적 패턴.

### 1.3 인증 가드

- `RequireAuth` 컴포넌트 (router:86-91) — `accessToken` 없으면 `/auth/login` 리다이렉트
- 적용 라우트: `/`, `/create-workspace`, `/:workspaceSlug/*`, `/:workspaceSlug/documents/*`
- 비인증 라우트: `/auth/*`, `/invite/:token`, `/s/:token`

### 1.4 Lazy loading

문서 페이지 5개만 lazy: `DocumentsHomePage`, `DocumentSpacePage`, `DocumentExplorerPage`, `DocumentSpaceSettingsPage`, `PublicDocumentPage`. 나머지는 eager.

### 1.5 Chrome 메타 (`RouteHandle.chrome`)

- `branded` — Login/Dashboard/empty state (그래픽 풀 표현)
- `minimal` — Issue/Board/Settings (시각 부담 적게)
- `document` — Document 류 (점격자 흐리게)

`useMatches()`로 가장 깊은 chrome 값을 `<body data-chrome>`에 부여 → CSS 분기.

---

## 2. Pages 도달 가능성 — 거의 모두 ✅

### 2.1 라우트 등록된 진입점 (✅ Working 확정)

| 도메인 | 페이지 수 | 비고 |
|---|---:|---|
| `auth/` | 5 | login/register/verify/forgot/reset |
| `admin/` | 6 | layout + users/workspaces/orphan-spaces/attachments/superusers/audit + UserPicker(컴포넌트) |
| `documents/` | 4 + 1 | DocumentsHome/Space/Explorer/SpaceSettings (lazy) + PublicDocumentPage |
| `invite/` | 1 | InviteAcceptPage |
| `project/` | 12 | ProjectIssuePage(view 5종 분기 호스트) + Categories/Sprints/Archive/Trash + ArchivedProjects/Discover/CreateProject + IssueDetail{Page,Panel} + issue-detail/tabs/* |
| `project/settings/` | 4 + 4 | general/members/workflow/automation (활성) + states/labels/auto-archive/notifications (legacy redirect 대상이지만 `WorkflowPage`/`AutomationPage`가 sub-component로 import해서 재사용 ✅) |
| `project/views/` | 9 | Table/Board/Calendar/Timeline/Graph/Sprint/Reports/Analytics/Trash/Archive — ProjectIssuePage가 view 파라미터로 분기 |
| `public/` | 1 | PublicDocumentPage (`/s/:token`) |
| `request/` | 1 | RequestSubmitPage (`/projects/:id/request`) |
| `settings/` | 5 | SettingsLayout/WorkspaceSettingsLayout + Profile/Preferences/Security + WorkspaceMembers/JoinRequests |
| `setup/` | 1 | SetupPage (라우터 외 — main.tsx 분기) |
| `workspace/` | 3 | CreateWorkspace/WorkspaceDashboard/Inbox |
| 단일 페이지 | 2 | AnnouncementsPage, WorkspaceSelectPage |

### 2.2 💀 Dead 확정 (3건)

| 파일 | 검증 결과 |
|---|---|
| `pages/project/BoardPage.tsx` | grep: 자기 자신만 매치 — 어디서도 import 안 됨. router는 `/board` → `ProjectIssuePage`로 통합됨 (router:170 주석: "기존 /board 경로 호환") |
| `pages/project/IssueListPage.tsx` | grep: 자기 자신만 매치 — 사용처 0건 |
| `components/decorations/GeoDecoration.tsx` | grep: 자기 자신만 매치 — `decorations/` 폴더 전체가 dead |

→ **권장**: Phase 5 종합 시 사용자에게 삭제 컨펌 후 제거.

### 2.3 sub-component로 재사용 (legacy redirect 라우트)

- `StatesPage.tsx` ← `WorkflowPage.tsx`에서 import (workflow 탭 내부 콘텐츠)
- `LabelsPage.tsx` ← `WorkflowPage.tsx`
- `AutoArchivePage.tsx` ← `AutomationPage.tsx`
- `NotificationsPage.tsx` ← `AutomationPage.tsx`

→ ✅ Working (라우트가 직접 도달은 못 하지만 통합 페이지의 일부)

---

## 3. Components 사용처

### 3.1 검증된 그룹

| 그룹 | 진입 대표 파일 | 사용처 | 라벨 |
|---|---|---|---|
| `auth/` | AuthCard | LoginPage, RegisterPage, SetupPage 등 | ✅ |
| `charts/` | StatsCharts, SprintBurndown | AnalyticsView, SprintView | ✅ |
| `decorations/` | **GeoDecoration** | **0건** | 💀 Dead |
| `documents/` | DocumentEditor 등 | DocumentSpacePage 외 | ✅ |
| `editor/` | RichTextEditor | IssueDetailPage, RequestSubmitPage | ✅ |
| `events/` | EventDialog | CalendarView | ✅ |
| `issues/` | GlobalIssueDialog, IssueCreateDialog | AppLayout, DocumentLayout | ✅ |
| `layout/` | AppLayout, DocumentLayout, TopBar, Sidebar 등 | router | ✅ (가장 많이 import됨) |
| `motion/` | motion/index.tsx | grep 이번 라운드에 직접 미확인 — Phase 5 정밀 검증 필요 | 🔶 |
| `search/` | CommandSearchDialog | TopBar | ✅ |
| `ui/` | Button/Input/Select/... (Radix 기반) | 거의 모든 페이지 | ✅ |
| `views/` | (router:`pages/project/views/`로 매핑) | — | (pages 그룹) |

→ **components/motion/** 만 정밀 검증 안 됨. 빠른 grep으로 1초 컷 가능. Phase 5에서 처리.

---

## 4. Stores 매핑 (6개) — 모두 활발 ✅

`grep "use(Auth|Workspace|Undo|Presence|RecentChanges|IssueDialog)Store"` → **134건 / 51 파일**

| Store | 매치 카운트 (자기 정의 포함) | 추정 활성도 |
|---|---:|---|
| `authStore` | 워크스페이스/admin/settings/document/login 등 광범위 | ✅ Working |
| `workspaceStore` | layout/sidebar/header 등 | ✅ Working |
| `presenceStore` | useDocumentWebSocket, PresenceStack, DocumentEditor | ✅ Working |
| `undoStore` | AppLayout, DocumentLayout 핫키 핸들러 | ✅ Working |
| `recentChangesStore` | (메모리에 "Inbox/Toast" 출하) | ✅ Working |
| `issueDialogStore` | **신규**(86a6022) — DocumentEditor + AppLayout/DocumentLayout + GlobalIssueDialog | ✅ Working |

→ 6 store 모두 살아있음. 💀 0건.

---

## 5. Hooks 사용처 (13개)

`grep '^import .* "@/hooks/use\w+"'` → **32건 / 17 파일**

| Hook | 사용처 (대표) |
|---|---|
| `useAuthStore` 외 store 훅 | (별도 — Stores 절) |
| `useAppVersionCheck` | main.tsx (배포 감지 토스트) |
| `useDocumentWebSocket` | DocumentEditor |
| `useIssueMutations` | BoardView/CalendarView/TableView/TimelineView/IssueDetail |
| `useLocalState` | (다양) |
| `useMediaQuery` (`useIsDesktop`) | AppLayout/DocumentLayout |
| `useParentChain` | issue 트리 탐색 |
| `usePresenceScope` | document/issue presence |
| `useProjectFeatures` | view 분기 (예: BoardView) — **Project.features 키 일치 검증됨** ✓ |
| `useProjectPerms` | settings/issue 권한 분기 |
| `useSavedFilters` | 필터 프리셋 |
| `useViewSettings` | 사용자별 view 설정 |
| `useWebSocket` | AppLayout (워크스페이스 WS) |
| `useWorkspaceColors` | priority_colors → CSS 변수 |

→ 모든 hook 사용처 존재. 💀 0건.

### 🟢 Phase 1 F8 (`Project.features` 키 일치) — 검증 완료

- **Backend** (`projects/models.py:46` 주석): `board, backlog, calendar, timeline, graph, sprints, analytics, request`
- **Frontend** (`types/index.ts:137-144`): `board, calendar, timeline, graph, sprints, analytics, request` (**backlog 누락**)
- 누락은 **의도적** — 같은 파일 line 135-136 주석:
  > "backlog" 키는 더 이상 뷰가 아니지만 기존 프로젝트의 features JSON 호환 위해 타입에 남겨도 무해
- memory의 "백로그 뷰 + 사이드바 보기 토글 제거" 커밋(`47963e8`)과 일치 ✅

→ **정합성 ✅ Working with intentional drift**. backend는 호환 위해 키 남김, frontend 타입은 새 정책.

---

## 6. Phase 2 잔존 의심 — 모두 해소

| Phase 2 의심 | Phase 3 검증 결과 |
|---|---|
| `OrphanSpaceListView` 호출처 불명 | `pages/admin/AdminOrphanSpacesPage.tsx` 라우트 등록 (`/admin/orphan-spaces`) ✅ |
| `OrphanSpaceDeleteView` | 위 페이지 내부에서 호출 ✅ |
| `AttachmentSearchView` | `pages/admin/AdminAttachmentsPage.tsx` 라우트 등록 (`/admin/attachments`) ✅ |

→ **Phase 2의 🟡 후보 3건 모두 ✅ Working으로 승격**.

---

## 7. 5단계 라벨 — Phase 3 1차 확정

| 라벨 | 카운트 | 항목 |
|---|---:|---|
| ✅ **Working** | ~145 페이지/컴포넌트/스토어/훅 | 거의 전부 |
| 🟡 **Backend-only** | 0 | 모두 프론트 매칭 |
| 🟡 **Frontend-only** | 0 | 모두 백엔드 매칭 |
| 🔶 **검증 미완** | 1 | `components/motion/index.tsx` (Phase 5에서 1초 grep) |
| 💀 **Dead 확정** | **3** | `BoardPage`, `IssueListPage`, `decorations/GeoDecoration` |

---

## 8. 발견된 추가 특이사항

### F17: Issue Detail 3-way 진입
- `IssueDetailPage` (라우트 직접: 미사용 — wrapper들 통해)
- `IssueDetailPanel` (URL `?issue=uuid` 쿼리 → ProjectIssuePage가 사이드 패널로 띄움)
- `GlobalIssueDialog` (`issueDialogStore` → 86a6022 신규)

→ 같은 컴포넌트(`IssueDetailPage`)가 ws/pid override props로 3가지 모드 지원. **Working** ✅

### F18: ProjectIssuePage가 view 호스트
- `?view=table|board|calendar|timeline|graph|sprint|reports|analytics|trash|archive` 파라미터로 컴포넌트 전환
- `useProjectFeatures().isEnabled(key)` 로 토글된 view는 숨김
- core view (`table`/`archive`/`trash`)는 항상 활성

### F19: 6개월 후 제거 예정 legacy redirect (router:233)
> /* legacy redirects — 외부 링크/북마크 보존 (6개월 후 PASS5 에서 제거) */
- `states/labels/templates/auto-archive/notifications` → 통합 페이지로 redirect

→ Phase 5 권장: **6개월 카운트다운 — 언제까지가 정확한 일정인지 사용자 확인 필요**.

### F20: Document 5종 페이지가 모두 lazy
번들 사이즈 최적화 ✅. 다만 "최초 진입 시 로딩 스피너" 사용자 경험 비용. 트레이드오프 의도적.

### F21: Setup Bootstrap 패턴 (router 외)
- `main.tsx:35-62` `AppBootstrap` — 라우터 진입 전에 `/api/setup/status/` 호출 → 미설정 시 SetupPage 직접 렌더
- 정상 흐름이지만 라우트 트리에 안 잡혀서 인벤토리 자동 검출 어려움

---

## 9. 검증 명령

```bash
# 1. 라우트 등록된 페이지 카운트
grep -c "<Page\|element: <" frontend/src/router/index.tsx

# 2. Dead 페이지 후보 재검증 (자기 자신만 매치 = dead)
grep -rn "BoardPage\|IssueListPage\|GeoDecoration" frontend/src

# 3. ProjectFeatureKey 일치 검증
grep -A 8 "ProjectFeatureKey" frontend/src/types/index.ts
grep "features = JSON" backend/apps/projects/models.py

# 4. Store 사용 카운트
grep -rn "use\(Auth\|Workspace\|Undo\|Presence\|RecentChanges\|IssueDialog\)Store" frontend/src | wc -l
```

---

## 10. 다음 Phase

**Phase 4 — Async/실시간** sub-task 5개 예정:
1. `consumers.py` (WebSocket) — 채널 카탈로그
2. `routing.py` (channels) + frontend `useWebSocket`/`useDocumentWebSocket` 매핑
3. `tasks.py` (Celery) — 비동기 태스크 카탈로그
4. Yjs 실시간 편집 — `pycrdt-websocket` ↔ `y-websocket` 연결 흐름
5. **Phase 1 F7 검증**: `Notification.Type.COMMENT_REPLIED`, `MENTIONED` 발송 trigger (signals/tasks)

**예상 시간**: 20분
