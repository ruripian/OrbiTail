# 관리자 콘솔 A안 전면 개편 — 설계서

- 작성일: 2026-08-13
- 결정: **A안(전역 콘솔 분리 + 리소스 브라우저) 전체 채택**
- 확정된 답변: ③ 콘텐츠 탐색기로 승격 / ④ soft delete + 휴지통으로 전환
- 미결: ② (본 문서 1장에서 설명 + 추천 제시)

---

## 1. "2번"이 무슨 이야기였는지 — 권한 누출 설명

### 1-1. 지금 코드가 하는 일

`backend/apps/accounts/permissions.py:12`

```python
class IsWorkspaceAdminOrSuperUser(permissions.BasePermission):
    def has_permission(self, request, view):
        if user.is_superuser:
            return True
        return WorkspaceMember.objects.filter(
            member=user, role__gte=WorkspaceMember.Role.ADMIN,
        ).exists()          # ← workspace 조건이 없다
```

`.filter(member=user, role__gte=ADMIN)` 에 **어느 워크스페이스인지 조건이 없습니다.**
"아무 워크스페이스 하나에서라도 ADMIN이면 통과"입니다.

그리고 통과한 뒤 실행되는 것이 `backend/apps/accounts/views.py:581`

```python
qs = User.objects.all().order_by("-created_at")   # ← 시스템 전체 사용자
```

### 1-2. 결과적으로 벌어지는 일

김대리가 자기가 만든 개인 워크스페이스 `kim-test` 하나에서 ADMIN이라고 가정합니다.

| 김대리가 할 수 있는 일 | 근거 |
|---|---|
| 회사 전체 직원의 이메일·실명·가입일 목록 조회 | `accounts/views.py:577` + `:581` |
| 신규 가입자를 **전역으로** 승인 (로그인 가능하게 만듦) | `AdminUserApproveView` `accounts/views.py:605` |
| 다른 워크스페이스의 비공개 스페이스 첨부 열람 — 단, 자기가 ADMIN인 ws 안에서만 | `documents/views.py:473` |

즉 **자기 워크스페이스의 관리자일 뿐인 사람이 시스템 전체 사용자 명부를 보고 가입 승인까지 합니다.**
`AdminLayout.tsx:41` 이 ws 어드민에게 users 탭을 그대로 열어주므로 UI로도 바로 접근됩니다.

### 1-3. 그래서 물었던 것

두 가지 중 어느 쪽이 의도였는지가 궁금했습니다.

- **(a) 사고다** — ADMIN 권한은 워크스페이스 안에서만 유효해야 했다
- **(b) 의도다** — 워크스페이스 관리자에게 가입 승인 업무를 위임하고 싶었다

### 1-4. 추천 — A안을 하면 자동으로 해결됨 (추가 결정 불필요)

A안은 `/admin`을 **슈퍼유저 전용 전역 콘솔**로 분리합니다. 그러면 ws 어드민은 `/admin`에
아예 들어오지 못하고, 전역 사용자 명부 노출은 구조적으로 사라집니다.

ws 어드민이 실제로 필요한 "우리 워크스페이스 가입 신청 승인"은 **이미 별도로 존재합니다.**

- `WorkspaceJoinRequestAdminListView` — `backend/apps/workspaces/views.py:201`
- `frontend/src/pages/settings/WorkspaceJoinRequestsPage.tsx` (`/:ws/workspace-settings/join-requests`)

따라서 역할 분담은 이렇게 정리됩니다.

| 업무 | 담당 | 위치 |
|---|---|---|
| 시스템 가입 승인 (`is_approved`) | 슈퍼유저 | `/admin/users` |
| 워크스페이스 가입 신청 승인 | ws 어드민 | `/:ws/workspace-settings/join-requests` |

**트레이드오프 (알고 계셔야 할 점):** 시스템 가입 승인이 슈퍼유저에게 집중됩니다.
슈퍼유저가 1~2명이고 신규 가입이 잦으면 병목이 됩니다. 그 경우 `/admin/overview`의
승인 대기 카운트 + 알림으로 대응하고, 그래도 부담되면 이후에 "승인 권한만 위임" 플래그를
따로 만드는 게 맞습니다(지금은 만들지 않음 — 요청되지 않은 유연성).

---

## 2. 목표 구조

### 2-1. 라우팅 — 워크스페이스에서 완전 분리

```
현재:  /:workspaceSlug/admin/*       ← ws slug에 종속. 전역/ws 데이터 혼재
변경:  /admin/*                       ← 최상위. 슈퍼유저 전용
```

```
/admin
├── overview                시스템 개요 (신설)
├── users                   전역 사용자
├── workspaces              전역 워크스페이스 목록
│   └── :slug               워크스페이스 상세 (drill-down)
│         ├── members
│         ├── projects
│         ├── spaces        ← 탈퇴자 스페이스 정리 여기로 이동
│         └── content       ← 이 ws의 첨부/문서
├── content                 콘텐츠 탐색기 (전역, ws 필터)
├── trash                   휴지통 (신설, 4번)
├── audit                   감사 로그
└── system                  SMTP / celery / 버전 / 스토리지
```

**스코프 규칙 (이번 개편의 핵심 불변식):**
`/admin/*` 최상단 탭은 **항상 전역**이다. 워크스페이스 한정 도구는 반드시
`/admin/workspaces/:slug/*` 아래에만 존재한다. 이 규칙 하나로 현재의 스코프 혼선이 사라진다.

### 2-2. 기존 페이지 처리

| 현재 | 이후 |
|---|---|
| `/:ws/admin/users` | → `/admin/users` (301 redirect 유지) |
| `/:ws/admin/workspaces` | → `/admin/workspaces` |
| `/:ws/admin/superusers` | → **`/admin/users`에 흡수** (필터 칩 `역할=슈퍼유저`) |
| `/:ws/admin/audit` | → `/admin/audit` |
| `/:ws/admin/attachments` | → `/admin/content` (승격) |
| `/:ws/admin/orphan-spaces` | → `/admin/workspaces/:slug/spaces` |

`AdminSuperusersPage`를 별 탭으로 유지하지 않는 이유: 이미 users API의
`status=superusers` 필터를 그대로 쓰고 있고(`AdminSuperusersPage.tsx:31`),
승격 UI만 추가된 형태입니다. 리소스 테이블의 필터 + 벌크 액션으로 완전히 대체됩니다.
탭 6개 → 유지보수 대상 페이지 1개 감소.

---

## 3. 공통 규격 — 이번 개편의 실질 (재사용 설계)

UI를 다시 그리는 게 목적이 아닙니다. **"200개 하드컷" 같은 것이 다시 나올 수 없는 구조**를
만드는 게 목적입니다. 규격은 딱 2개입니다.

### 3-1. 백엔드 — `AdminResourceListView`

`backend/apps/admin_console/base.py` (신설)

```python
class AdminResourceListView(generics.ListAPIView):
    """관리자 콘솔 목록 API 공통 베이스.

    하위 클래스는 queryset / serializer / 아래 3개 스펙만 선언한다.
    페이지네이션은 베이스가 강제하므로 [:200] 같은 하드컷이 들어갈 자리가 없다.
    """
    permission_classes = [IsSuperUser]
    pagination_class   = AdminPagination      # page_size=50, max=200, ?page_size 허용

    search_fields = []      # 예: ["filename", "document__title"]
    filter_spec   = {}      # 예: {"ws": "document__space__workspace__slug",
                            #      "uploaded_after": ("created_at__gte", parse_dt)}
    ordering_allow = []     # 정렬 화이트리스트 — 임의 필드 정렬로 인한 풀스캔 방지
```

- 기존 `ListAPIView` 3개(users/workspaces/audit)는 이 베이스로 갈아타면 동작이 같습니다.
- `APIView` + 수동 dict 2개(attachments/orphan-spaces)는 이 베이스로 재작성 → **하드컷 소멸**.
- `?page_size` 를 열되 `max_page_size=200`으로 상한 — CSV 내보내기는 별도 스트리밍 엔드포인트로.

### 3-2. 프론트 — `AdminResourceTable`

`frontend/src/components/admin/AdminResourceTable.tsx` (신설)

각 탭이 선언하는 것은 컬럼 정의와 필터 정의뿐입니다.

```tsx
<AdminResourceTable
  queryKey="admin_content"
  fetcher={adminApi.content.list}
  columns={CONTENT_COLUMNS}      // 라벨 / 렌더러 / 정렬키 / 기본 표시여부
  filters={CONTENT_FILTERS}      // 칩 UI 스펙 (select / date-range / text)
  bulkActions={[softDeleteAction]}
  emptyLabel="..."
/>
```

테이블이 공통으로 제공: 서버 페이지네이션 · 서버 정렬 · 필터 칩 · 컬럼 표시 토글 ·
행 선택 + 벌크 액션 · **총 건수 표시** · CSV 내보내기.

**총 건수 표시가 중요한 이유:** 지금 첨부 검색은 결과가 잘렸는지 사용자가 알 수 없습니다.
`count`를 항상 노출하면 "223건 중 50건 표시" 로 보이므로 잘림이 은폐되지 않습니다.

**재사용 확장:** 이 테이블은 admin 전용으로 만들지만, 컬럼/필터를 선언으로 받는 구조라
추후 `workspace-settings` 쪽 멤버 목록에도 그대로 쓸 수 있습니다. 다만 **지금은 admin에서만
사용**하고, 두 번째 사용처가 실제로 생길 때 옮깁니다.

### 3-3. UserPicker 중복 제거

`frontend/src/pages/admin/UserPicker.tsx` 는 표준 `components/ui/user-picker.tsx` 와 중복입니다.
갈라진 이유는 admin이 **전역 사용자**를 검색해야 하기 때문으로 보입니다.
→ 표준 컴포넌트에 `source` prop(기본 = ws 멤버, `"global"` = admin API)을 추가하고
admin 전용 파일은 삭제합니다.

---

## 4. ③ 콘텐츠 탐색기 (첨부 검색 승격)

### 4-1. 조사 결과 — 대상 모델은 2개뿐

| 모델 | 위치 | 용도 |
|---|---|---|
| `DocumentAttachment` | `documents/models.py:219` | 문서 첨부 |
| `IssueAttachment` | `issues/models.py:241` | 이슈 첨부 **+ 댓글 첨부** |

**댓글 첨부용 별도 모델은 없습니다.** 이슈 댓글에 드롭/붙여넣은 이미지는 이미
`IssueAttachment.source = "from_comment"` 로 저장됩니다(`issues/models.py:245`).
따라서 "이슈·댓글 첨부까지 포함"은 **모델 신설 없이 IssueAttachment 추가 + source 배지 노출**로
끝납니다. 문서 댓글(`CommentThread`)에는 첨부 개념이 없습니다.

### 4-2. 걸림돌 — 두 모델의 필드명이 다름

| 의미 | DocumentAttachment | IssueAttachment |
|---|---|---|
| 크기 | `file_size` (BigInteger) | `size` (PositiveInteger) |
| MIME | `content_type` | `mime_type` |
| 파일명 | `filename` (max 500) | `filename` (max 255) |
| 소프트 삭제 | **없음** | `deleted_at` 있음 |
| 출처 | 없음 | `source` 있음 |

**대응 — 모델은 건드리지 않고 정규화 시리얼라이저로 흡수합니다.**

```python
# apps/admin_console/serializers.py
class AttachmentRowSerializer(serializers.Serializer):
    """두 첨부 모델을 콘솔 표시용 단일 형태로 정규화.
    모델 필드명을 통일하는 마이그레이션은 하지 않는다 — 앱 전체 코드가 영향받고,
    콘솔 표시 하나 때문에 감당할 위험이 아니다.
    """
    kind        = ...  # "document" | "issue"
    size        = ...  # file_size / size 중 존재하는 쪽
    mime        = ...
    source      = ...  # issue 만 값 있음
    parent      = ...  # 문서 제목 / 이슈 키+제목
    location    = ...  # 스페이스명 / 프로젝트명
```

**목록 결합 방식 (트레이드오프 명시):**

- 후보 1: 두 쿼리 각각 페이징 후 앱에서 병합 → 정렬/카운트가 부정확해짐. **탈락**
- 후보 2: DB `UNION ALL` + 공통 컬럼 alias → 정확. Django `QuerySet.union()` 으로 가능하나
  select_related 가 안 먹어 N+1 위험 → 필요한 필드만 `.values()` 로 뽑아 해결
- 후보 3: `kind` 필터를 **필수**로 두어 한 번에 한 모델만 조회 → 가장 단순

→ **후보 3으로 시작합니다.** 기본 탭이 `문서 첨부 | 이슈 첨부` 로 나뉘고, 각 탭은 단일 모델
쿼리입니다. "전체 통합 정렬"이 실제로 필요해지면 후보 2로 올립니다.
(후보 2를 처음부터 하면 코드는 2배, 얻는 것은 정렬 하나입니다.)

### 4-3. 필터 · 액션

| 필터 | 구현 |
|---|---|
| 파일명 | `filename__icontains` + **인덱스 추가** (아래 4-4) |
| 상위 제목 | `document__title__icontains` / `issue__title__icontains` |
| 워크스페이스 | slug 선택 |
| 업로더 | UserPicker |
| 기간 | `created_at` 범위 |
| 종류 | 이미지 / 문서 / 동영상 / 기타 (mime prefix) |
| 크기 | 최소 크기 (대용량 정리용) |
| 출처 | direct / from_comment (이슈 탭만) |

액션: 다운로드 · 상위 항목 열기 · **소프트 삭제(벌크 가능)** · 감사 로그 자동 기록.

### 4-4. 성능

- `filename__icontains` 는 인덱스를 못 타므로 두 테이블에 인덱스 추가:
  `Index(fields=["-created_at"])` (기본 목록용), `Index(fields=["document"])` 등
  실제 필터 조합 기준으로. `icontains` 자체는 PostgreSQL `pg_trgm` GIN 인덱스가 정석이지만
  **확장 설치가 필요하므로 별도 승인 대상**입니다. 우선 파일명 검색은 필터와 조합해
  후보군을 줄인 뒤 적용하는 방식으로 갑니다.
- `select_related("document__space__workspace", "uploaded_by")` 로 N+1 제거
  (현재 `documents/views.py:545` 는 workspace 를 select_related 하지 않아 `space_name` 접근 시 추가 쿼리).

### 4-5. 권한 (현재 결함 수정)

지금은 ws 어드민이면 **비공개 스페이스 첨부까지 전부** 열람 가능합니다(`documents/views.py:540`).
콘솔이 슈퍼유저 전용이 되면 이 경로는 정리되지만, 슈퍼유저조차도:

- 목록에 **비공개 배지**를 표시한다 (무엇을 보고 있는지 인지)
- 파일 다운로드는 감사 로그에 기록한다 (`content_download` 액션 신설)

"슈퍼유저는 다 볼 수 있다"와 "본 사실이 남는다"는 다릅니다. 후자가 있어야 관리 도구입니다.

---

## 5. ④ soft delete + 휴지통

### 5-1. 좋은 소식 — 패턴이 이미 있음

`DeleteAccountView` (`accounts/views.py:326`) 가 **이미 소프트 삭제로 구현되어 있습니다.**

```python
user.deleted_at = now
user.is_active  = False
user.email      = f"deleted_{ts}_{user.email}"[:254]   # 재가입 허용 위한 마스킹
```

반면 어드민 삭제 `AdminUserDeleteView` (`accounts/views.py:753`) 는 `user.delete()` — **하드**입니다.
같은 시스템에서 본인 탈퇴는 안전하고 관리자 삭제는 CASCADE로 이슈까지 날리는 상태입니다.

→ **새 패턴을 만들지 않고 `DeleteAccountView` 의 로직을 공용 함수로 추출해 재사용합니다.**

```python
# apps/accounts/services.py (신설)
def soft_delete_user(user, *, actor=None) -> None:
    """계정 소프트 삭제 — 본인 탈퇴와 관리자 삭제가 같은 경로를 쓴다.
    이메일 마스킹은 동일 이메일 재가입을 허용하기 위함.
    """
```

### 5-2. 소프트 삭제 필드 현황

| 모델 | `deleted_at` | 4번 대응 |
|---|---|---|
| `User` | ✅ 있음 | 어드민 경로만 soft 로 교체 |
| `Issue` | ✅ 있음 (`issues/models.py:97`) | 그대로 |
| `IssueAttachment` | ✅ 있음 (`issues/models.py:268`) | 그대로 |
| `Document` | ✅ 있음 (`documents/models.py:134`) | 그대로 |
| `Workspace` | ❌ **없음** | 마이그레이션 필요 |
| `Project` | ❌ 없음 | archive 로 대체 가능 — 확인 필요 |
| `DocumentAttachment` | ❌ **없음** | 마이그레이션 필요 (③에서 삭제 액션 추가하므로) |
| `DocumentSpace` | ❌ 없음 | 고아 스페이스 정리는 하드 유지 (아래) |

**필요한 마이그레이션 2건:** `Workspace.deleted_at`, `DocumentAttachment.deleted_at`.

**의도적으로 하드 삭제를 유지하는 것:**
탈퇴자 개인 스페이스 영구 삭제(`documents/views.py:513`)는 목적 자체가 "완전 제거"입니다.
이건 휴지통에 넣는 게 무의미하므로 하드 유지 + **타이핑 확인**으로 보호합니다.

### 5-3. 휴지통 (`/admin/trash`)

```
┌ 종류 필터: 사용자 | 워크스페이스 | 이슈 | 문서 | 첨부 ┐
│ 삭제된 항목 · 삭제 시각 · 삭제한 사람 · 남은 보관일   │
│ [복원]  [영구 삭제(타이핑 확인)]                      │
└ 보관 30일 경과 항목은 회색 처리                       ┘
```

- 조회는 각 모델의 `deleted_at__isnull=False` 를 종류별로 (③과 같은 `kind` 필터 방식)
- 자동 영구 삭제는 **이번 범위에서 만들지 않습니다.** celery beat 잡을 추가하면 데이터가
  조용히 사라지는 경로가 하나 늘어납니다. 우선 수동 영구 삭제만 두고, 실제로 쌓여서
  불편해지면 그때 자동화합니다.
- 삭제한 사람을 표시하려면 `deleted_by` 가 필요하지만 어느 모델에도 없습니다.
  → **감사 로그에서 역참조합니다**(`AuditLog.target_id` 로 조회). 새 필드를 만들지 않는 이유는
  메모리에 남긴 원칙 그대로 "파생 가능한 값은 DB 필드로 만들지 않음" 입니다.

### 5-4. 위험 — CASCADE 재검토

`user.delete()` → soft 로 바꾸면 **기존에 CASCADE로 지워지던 데이터가 남습니다.** 이는 의도한
개선이지만, 남은 데이터가 UI에 어떻게 보이는지 확인이 필요합니다.

- 삭제된 사용자가 담당자인 이슈 → 담당자 표시가 어떻게 되는가
- 삭제된 사용자의 워크스페이스 멤버십 → 멤버 목록에 남는가

`DeleteAccountView` 경로로 이미 같은 상태가 존재하므로(본인 탈퇴자), **동작 확인은
새 시나리오가 아니라 기존 시나리오 점검**입니다. Phase 4 검증 항목에 넣습니다.

---

## 6. 감사 로그 확장

### 6-1. 현재 한계

- 9개 액션만 (`audit/models.py:13`), `target_type` 은 user|workspace 2종
- **IP / User-Agent 없음** → 감사 요건 미달
- 백엔드는 `actor`/`target_type` 필터 지원하는데 UI는 `action` 만 노출(`AdminAuditLogPage.tsx:78`)

### 6-2. 변경

**모델 (`audit/models.py`):**
```python
ip_address = models.GenericIPAddressField(null=True, blank=True)
user_agent = models.CharField(max_length=500, blank=True, default="")
```
`log_admin_action()` 에 `request` 를 옵셔널로 받아 채웁니다(기존 호출부는 그대로 동작).

**액션 추가:**
`content_download`, `content_delete`, `trash_restore`, `trash_purge`,
`ws_member_role_change`, `login_failed`

`login_failed` 는 이미 `accounts/views.py:229` 에서 `response.status_code != 200` 를
감지하고 있으므로 그 자리에 훅을 걸면 됩니다.

**`target_type` 확장:** `attachment`, `document`, `issue`, `project` 추가.

**UI:** actor(UserPicker) · 기간 · target_type · 자유 검색 필터를 `AdminResourceTable` 로 노출.
현재 카드 리스트는 필터가 늘어나면 감당이 안 됩니다.

---

## 7. Phase 계획

각 Phase는 독립 배포 가능하고, 검증 기준이 통과 조건입니다.

### Phase 0 — 권한/스코프 차단 (가장 먼저, 단독 배포)
1. `/admin` 진입을 슈퍼유저 전용으로 (`AdminLayout.tsx:34`)
2. `AdminUserListView` 등 전역 API 권한을 `IsSuperUser` 로 (`accounts/views.py:577`, `:605`)
3. ws 어드민을 `/:ws/workspace-settings` 로 리다이렉트

**검증:** ws 어드민 계정으로 `/admin/users` 접근 → 403 + 리다이렉트. 슈퍼유저는 정상.
**검증:** ws 어드민이 `workspace-settings/join-requests` 에서 자기 ws 승인은 계속 가능.

### Phase 1 — 공통 규격 구축
1. `AdminResourceListView` + `AdminPagination` (백엔드)
2. `AdminResourceTable` (프론트)
3. 기존 `users` 탭을 이 규격으로 이전 (파일럿)

**검증:** users 탭의 필터/무한스크롤/카운트가 이전과 동일하게 동작.
**검증:** `?page_size=500` 요청 시 200으로 상한 처리.

### Phase 2 — 콘텐츠 탐색기 (③)
1. `admin_console` 앱 + `AttachmentRowSerializer`
2. 문서/이슈 첨부 탭, 필터 8종, 소프트 삭제 액션
3. 인덱스 마이그레이션, `DocumentAttachment.deleted_at` 추가

**검증:** 첨부 300건 시딩 → 검색어로 **201번째 이후 파일이 조회됨** (현재 결함의 직접 반증)
**검증:** 총 건수가 "N건 중 50건" 형태로 표시됨
**검증:** 이슈 댓글에 붙인 이미지가 `출처: 댓글` 배지로 조회됨

### Phase 3 — 콘솔 이관 + overview
1. 라우팅 `/admin/*` 최상위로, 기존 경로 redirect
2. `overview` (사용자 수/승인대기/스토리지/최근 가입)
3. 워크스페이스 drill-down, 고아 스페이스 이동
4. superusers 탭을 users 필터로 흡수, `pages/admin/UserPicker.tsx` 삭제

**검증:** 워크스페이스 0개인 슈퍼유저 계정으로 `/admin` 진입 가능
(현재 구조는 ws slug가 필요해서 불가능 — 이게 A안의 실질 이득 중 하나)
**검증:** 옛 URL 북마크가 새 위치로 이동

### Phase 4 — 휴지통 + 감사 로그 (④, 6장)
1. `soft_delete_user()` 추출, `AdminUserDeleteView` 를 soft 로 교체
2. `Workspace.deleted_at` 마이그레이션 + soft delete
3. `/admin/trash` 신설, 복원/영구삭제
4. 감사 로그 IP/UA + 액션 확장 + 필터 UI

**검증:** 사용자 삭제 후 그가 만든 이슈가 **살아있음**, 휴지통에서 복원되면 로그인 가능
**검증:** 삭제된 사용자가 담당자인 이슈의 담당자 표시가 깨지지 않음 (5-4)
**검증:** 영구 삭제는 이메일 타이핑 확인 없이는 실행 불가

---

## 8. 이번 범위에서 **하지 않는** 것 (의도적 제외)

미래지향 설계와 과잉 구현은 다릅니다. 아래는 명시적으로 제외합니다.

- `system` 탭의 celery/SMTP 실시간 모니터링 → Phase 3에 자리만 두고 내용은 나중에
- 휴지통 자동 영구삭제 celery 잡 (5-3)
- `pg_trgm` GIN 인덱스 (확장 설치 = 별도 승인)
- 첨부 통합 UNION 정렬 (4-2 후보 2)
- 승인 권한 위임 플래그 (1-4)
- 감사 로그 CSV 이외의 외부 전송(SIEM 등)
- 모델 필드명 통일 마이그레이션 (4-2)

---

## 9. 승인 필요 사항

| 항목 | 내용 |
|---|---|
| 마이그레이션 | `Workspace.deleted_at`, `DocumentAttachment.deleted_at`, `AuditLog.ip_address/user_agent`, 첨부 인덱스 — 총 4건 |
| 신규 Django 앱 | `apps/admin_console` (베이스 뷰 + 정규화 시리얼라이저) |
| 새 라이브러리 | **없음** — django-filter 도입 없이 `filter_spec` 자체 구현 |
| 컨테이너 | Docker 사용 중. 마이그레이션은 `/migrate`, 백엔드 코드 변경은 `/restart` |
