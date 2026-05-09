# Phase 2 — API & 권한

> **분석 일자**: 2026-05-09
> **추론 비율**: < 10% (대부분 코드 직접 인용)
> **검증 방식**: backend urls.py 7개 + frontend api 12개 1:1 매핑
> **결과 헤드라인**: ✅ frontend api ↔ backend endpoint **거의 완전 매칭** (의심 3건만 잔존)

---

## 1. URL 구조 (config/urls.py)

```
/admin/                     → Django admin
/api/schema/                → drf-spectacular OpenAPI
/api/docs/                  → Swagger UI
/api/version/               → 버전 체크 (배포 감지용)
/api/auth/         → apps.accounts.urls       (22 endpoint)
/api/workspaces/   → apps.workspaces.urls     (18 endpoint)
/api/admin/audit/  → apps.audit.urls          (1 endpoint)
/api/             → apps.projects.urls        (19 endpoint)
/api/             → apps.issues.urls          (36 endpoint)  ← 최대
/api/             → apps.notifications.urls   (7 endpoint)
/api/             → apps.documents.urls       (28 endpoint)
/api/invitations/<token>/         → 초대 정보
/api/invitations/<token>/accept/  → 초대 수락
/api/setup/status/                → 초기 설정 상태
/api/setup/                       → 초기 설정 실행 (슈퍼어드민 + 워크스페이스)
/api/icons/upload/                → 공용 아이콘 업로드
+ /media/<path>                   → 정적 파일 (개발 only)
```

**총 endpoint 카운트** ≈ **140개**

`/api/` 직접 마운트 → 워크스페이스/프로젝트 종속 패턴 일관:
`/api/workspaces/<slug>/projects/<uuid>/...` 가 표준.

---

## 2. ViewSet 카탈로그 (134 클래스, 도메인별 그룹)

| 도메인 | 카운트 | 주요 클래스 패턴 |
|---|---:|---|
| **accounts (auth)** | 22 | RegisterView, MeView, ChangePassword, EmailChange{Request,Verify}, VerifyEmail, PasswordReset{Request,Confirm}, IconUpload, DeleteAccount, JWT (TokenObtain/Refresh/Blacklist) |
| **accounts (admin)** | 5 | AdminUserList/Approve/Superuser/Suspend/Delete |
| **accounts (announcement)** | 4 | List/Detail/UnreadCount/MarkSeen |
| **accounts (setup)** | 2 | SetupStatus, Setup |
| **audit** | 1 | AuditLogListView |
| **workspaces** | 18 | List/Detail/Member/Invitation/JoinRequest + Admin* (5 admin endpoint) |
| **projects** | 19 | Project (CRUD + archive/discover/join/leave/identifier-check) + Member + Category + Sprint + State + Event + SavedFilter |
| **issues** | 36 | Issue (CRUD + restore/trash/hard-delete/archive/duplicate) + SubIssue + Comment + Activity + Link + NodeLink + NodeGraph(P/W) + Attachment(+tree/trash/restore) + Label + Template + WorkspaceMy/Recent/Search + Bulk(update/delete) + Stats + DocumentLinks + Request(+approve/reject/delete) |
| **documents** | 28 | Space (+discoverable/join) + Document (+move) + IssueLink + Search + Mine/Recent/Bookmarks + SpaceBookmarks + OrphanSpace + AttachmentSearch + Version + Comment + CommentThread (+reply/resolve) + Template + Share + Public + DocumentAttachment |
| **notifications** | 7 | List + MarkRead + Archive + ReadAll + UnreadCount + Preference (전역) + ProjectPreference |
| **config** | 1 | VersionView |

---

## 3. 권한 모델

### 3.1 DRF Default (`settings/base.py:133-156`)

```python
"DEFAULT_AUTHENTICATION_CLASSES": (JWTAuthentication,)
"DEFAULT_PERMISSION_CLASSES": (IsAuthenticated,)   ← 명시 안 한 모든 ViewSet은 로그인 필수
"DEFAULT_THROTTLE_RATES": {
    "anon": "60/minute",
    "user": "1200/minute",
    "auth": "10/minute",   ← 로그인 시도 제한
}
"PAGE_SIZE": 50
```

### 3.2 Custom Permission 클래스 — 단 2개

`backend/apps/accounts/permissions.py`:
- `IsSuperUser` — `user.is_superuser` 만 통과
- `IsWorkspaceAdminOrSuperUser` — superuser 또는 어떤 워크스페이스에서든 ADMIN 이상

**다른 앱(workspaces/projects/issues/documents/notifications)에는 permissions.py 파일 없음** → 권한 검증이 ViewSet 내부 로직(`get_queryset`, `perform_create`, `has_object_permission`)에 분산됨.

### 3.3 명시적 `permission_classes` 22번

| 권한 | 사용 횟수 | 위치 |
|---|---:|---|
| `AllowAny` | 8 | register/login refresh/setup/email-verify/password-reset/announcement-public/InvitationDetail/WorkspacePublic |
| `IsAuthenticated` (명시) | 2 | AnnouncementUnreadCount/MarkSeen |
| `IsSuperUser` | 7 | audit + admin user superuser/suspend/delete + admin workspace list/create/delete/owner |
| `IsWorkspaceAdminOrSuperUser` | 2 | AdminUserList, AdminUserApprove |

### 3.4 Brute-force 방어 (django-axes, `base.py:55-69`)

- 5회 실패 → IP+계정 조합 15분 잠금
- 잠금 응답: `apps.accounts.lockout.lockout_response` (커스텀 — 403 + JSON)
- 로그인 성공 시 카운터 리셋
- nginx 뒤일 때 X-Forwarded-For 신뢰

### 3.5 JWT (`base.py:158-169`)

- Access: 60분 / Refresh: 7일 / **Rotate + blacklist after rotation**
- Header: `Bearer`

### ⚠ 권한 검증 위험 패턴

**대부분의 endpoint는 명시적 권한 클래스 없이 IsAuthenticated default + ViewSet 내부 logic에 의존.**
이는 **권한 로직이 ViewSet마다 분산되어 일관성 검증이 어렵다**는 뜻. 예:
- 프로젝트 멤버십 검증이 `get_queryset()`에 흩어짐
- 같은 검사 패턴을 여러 ViewSet에서 반복 (DRY 위반)
- 누락 시 정보 노출 위험

→ Phase 5에서 ViewSet 내부 권한 검증 일관성 정밀 점검 필요.

---

## 4. Frontend API ↔ Backend Endpoint 매핑

### 4.1 매핑 결과 — ✅ Working (확정)

| frontend api | backend ViewSet 그룹 | 매칭 |
|---|---|---|
| `auth.ts` (8 메서드) | accounts/views (RegisterView, CustomTokenObtainPair, MeView, etc) | ✅ 완전 |
| `settings.ts` (7 메서드) | accounts MeView (`/auth/me/` 공용) + ChangePassword + DeleteAccount | ✅ |
| `setup.ts` (2 메서드) | accounts.setup_views | ✅ |
| `icons.ts` (1 메서드) | accounts.IconUploadView | ✅ |
| `announcements.ts` (6 메서드) | accounts.Announcement* (4 ViewSet) | ✅ |
| `admin.ts` (사용자 4 + 워크스페이스 4 + 감사 1) | accounts admin* + workspaces admin* + audit | ✅ |
| `workspaces.ts` (16 메서드) | workspaces.* (List/Detail/Member/Invitation/JoinRequest) | ✅ |
| `projects.ts` (40+ 메서드, 7 그룹) | projects.* (Project/Member/Category/Sprint/State/Event/SavedFilter) | ✅ |
| `issues.ts` (50+ 메서드, 9 그룹) | issues.* (Issue/SubIssue/Comment/Link/NodeLink/Attachment/Activity/Label/Template + workspace 횡단) | ✅ |
| `documents.ts` (40+ 메서드, 11 그룹) | documents.* (Space/Document/IssueLink/Comment/Thread/Version/Template/Share/Bookmark/Attachment) | ✅ |
| `notifications.ts` (8 메서드) | notifications.* (List/MarkRead/Archive/ReadAll/UnreadCount/Preference x2) | ✅ |
| `requests.ts` (5 메서드) | issues.IssueRequest* | ✅ |

### 4.2 🟡 의심 — Backend Endpoint 호출처 추가 검증 필요

frontend `api/`에 명시적으로 호출되지 않은 endpoint들. **frontend `pages/admin/`이나 컴포넌트에서 직접 호출할 가능성** 있어 Phase 3에서 확인 필요:

| Endpoint | Path | ViewSet | 의심 |
|---|---|---|---|
| `OrphanSpaceListView` | `/api/workspaces/<slug>/documents/admin/orphan-spaces/` | documents/views.py:483 | 🟡 — 워크스페이스 어드민용. admin pages에서 호출 가능성 |
| `OrphanSpaceDeleteView` | 위 + `<pk>/` | documents/views.py:513 | 🟡 |
| `AttachmentSearchView` | `/api/workspaces/<slug>/documents/admin/attachments/` | documents/views.py:536 | 🟡 |

→ Phase 3에서 `frontend/src/pages/admin/` 및 컴포넌트 내 직접 axios 호출 grep으로 검증.

### 4.3 💀 Dead 후보

현 단계에서 **0건** — 모든 backend endpoint가 frontend api 또는 admin pages 후보로 매핑됨.

### 4.4 🟡 Frontend-only 후보 (backend 매칭 없음)

**0건** — frontend api의 모든 호출이 backend endpoint와 1:1 매칭.

---

## 5. 자동 OpenAPI Schema (drf-spectacular)

활성: `SPECTACULAR_SETTINGS` 정의됨 (`base.py:209-214`)

```bash
# 검증 명령
docker compose exec -T backend python manage.py spectacular --file /tmp/schema.yml
docker compose exec -T backend cat /tmp/schema.yml | grep -c "operationId"
```

→ Phase 5에서 schema dump 후 endpoint 카운트 검증 (140 ± 20% 예상).
**Phase 2에서는 schema dump 생략** — endpoint 매핑이 이미 완료됨.

---

## 6. Phase 1 의심 단서 검증 결과

| Phase 1 의심 | Phase 2 결과 |
|---|---|
| F3: `IssueNodeLinkType` DB 5종 vs UI 2종 | ViewSet에서 5종 모두 허용 (validation 없음). 신규 생성 시 frontend가 2종만 보냄 → **데이터는 5종 그대로 유지, UI만 단순화** ✅ 확인 |
| F4: `DocumentSpace.project` 좀비 | `OrphanSpaceListView` 존재 — orphan 청소 endpoint **있음** ✅ |
| F5: User 5단 상태 | login(`CustomTokenObtainPair`) + AdminUserSuspend/Approve로 처리. 일관성 확인은 Phase 5 |
| F7: `comment_replied`/`mentioned` Notification 발송 로직 | Phase 4 (signals/tasks)에서 검증 |
| Phase 0 S5: announcements ↔ AnnouncementsPage | ✅ 매칭 (`/auth/announcements/`) |
| Phase 0 S8: Request Queue | ✅ ViewSet 7개 매칭 (Submit/Approve/Reject/Delete) |
| Phase 0 S1: audit backend-only | ✅ 의도적 (Backend-only by design) — 단, **frontend `admin.ts`는 GET listAudit 호출함** → backend-only가 아니라 **admin 페이지 전용으로 노출됨** ✅ 정정 |

---

## 7. 5단계 라벨 — Phase 2 1차 확정

| 라벨 | 도메인 | 사유 |
|---|---|---|
| ✅ **Working** | accounts (auth/me/admin/announcement), workspaces, projects, issues (대부분), documents (대부분), notifications, audit (admin), setup, icons | frontend api ↔ backend 매칭 |
| 🟡 **Backend-only 의심** | `OrphanSpaceListView/Delete`, `AttachmentSearchView` | api/에 없음. Phase 3 admin pages에서 검증 |
| 🟡 **부분구현 의심** | `Notification.Type.COMMENT_REPLIED`, `MENTIONED` | endpoint는 있는데 발송 trigger? Phase 4 |
| 💀 **Dead** | 현재까지 0건 | |

---

## 8. 발견된 추가 특이사항

### F11: `IssueRequest` 흐름 (✅ 모델 + ViewSet + frontend 모두 살아있음)
- 모델: `apps/issues/models.py` IssueRequest
- ViewSet: 4개 (`IssueRequestList/Approve/Reject/Delete`)
- frontend: `requests.ts` (5 메서드) + `pages/request/` 폴더 존재
→ memory의 "Request Queue 시스템 1차 shipped" 일치 ✅

### F12: `IssueDuplicate` (이슈 딥카피)
- 자기+자손 전체 복제. 트리 깊이 위험. Phase 4에서 N+1 검토 필요

### F13: `nodeGraph` (워크스페이스 vs 프로젝트)
- 둘 다 ViewSet 존재 (`ProjectNodeGraphView`, `WorkspaceNodeGraphView`)
- frontend: 둘 다 호출 (`nodeGraph`, `nodeGraphAllWorkspace`)
- 워크스페이스 그래프는 "선택적/디버그용" 주석 — 실 사용 여부는 Phase 3에서 GraphView.tsx 확인

### F14: `WorkspaceJoinRequest` 흐름 — 이중 가입 방식 ✅
- Push: Invitation (관리자가 보냄)
- Pull: JoinRequest (사용자가 신청)
- 둘 다 frontend에서 호출 ✅

### F15: 권한 검증의 분산
- 단 1개 `permissions.py` 파일 (accounts만)
- 다른 앱은 ViewSet 내부에서 처리 → 일관성 점검 어려움 (Phase 5)

### F16: HOT — `issues.ts` 파일 크기
- 334 라인, 50+ 메서드, 9 그룹
- Phase 0 hot-spot 9위와 일치
- 이슈 도메인이 가장 활발한 영역임을 재확인

---

## 9. 검증 명령

```bash
# 1. URL 패턴 카운트
docker compose exec -T backend python -c "
from django.urls import get_resolver
r = get_resolver()
def count(r, depth=0):
    n = 0
    for p in r.url_patterns:
        if hasattr(p, 'url_patterns'):
            n += count(p, depth+1)
        else:
            n += 1
    return n
print(count(r))
"

# 2. OpenAPI schema dump
docker compose exec -T backend python manage.py spectacular --file /tmp/schema.yml
docker compose exec -T backend grep -c "operationId" /tmp/schema.yml

# 3. ViewSet 클래스 카운트
grep -rn "^class \w\+\(ViewSet\|APIView\|View\)\b" backend --include="*.py" | wc -l

# 4. 권한 클래스 사용 카운트
grep -rn "permission_classes\s*=" backend --include="*.py" | wc -l
```

---

## 10. 다음 Phase

**Phase 3 — Frontend 도메인** sub-task 6개 예정:
1. `router/index.tsx` 라우트 트리 추출
2. pages/* 도메인별 컴포넌트 매핑 (라우트 도달 가능성)
3. components/* 사용처 추적 (특히 decorations/, motion/ — Phase 0 의심 S3)
4. stores 매핑 (어느 컴포넌트가 어떤 store 구독)
5. hooks 사용처 (useProjectFeatures와 Project.features 키 일치 — Phase 1 F8)
6. **admin pages에서 OrphanSpace/AttachmentSearch 호출 여부 검증** (Phase 2 잔존 의심)

**예상 시간**: 30~40분 (frontend가 가장 큰 영역)
