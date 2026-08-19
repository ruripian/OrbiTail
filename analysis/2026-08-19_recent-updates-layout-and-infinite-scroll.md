# 최근 업데이트 위젯 재배치 + 모두보기 무한 스크롤 — 분석

작성일: 2026-08-19 / 대상 브랜치: `feat/admin-console-overhaul`

## 0. 요청 정리

1. 홈(워크스페이스 대시보드)의 **"최근 업데이트" 위젯 위치를 아래로 내리기**
2. **"모두 보기"로 들어간 페이지**에서 화면 밖으로 밀려나는 항목을, 트위터처럼 **아래로 스크롤하면 이어서 로딩**되게 하기

---

## 1. 현황 실사 (읽은 코드 기준)

| 구성 요소 | 파일 | 현재 상태 |
|---|---|---|
| 홈 대시보드 | `frontend/src/pages/workspace/WorkspaceDashboard.tsx:434` | `xl:grid-cols-[minmax(0,1fr)_360px]` 2열 그리드. 좌=내 할 일, **우=최근 업데이트 `aside` (`xl:sticky xl:top-4`)** |
| 최근 업데이트 위젯 | 같은 파일 `454~474` | 쿼리 `recentByWorkspace(slug)` (파라미터 없음), 하단에 `모두 보기` → `/:ws/recent` |
| 모두보기 페이지 | `frontend/src/pages/workspace/RecentIssuesPage.tsx` | `limit=100` 단발 조회, 전부 한 번에 렌더 |
| API | `frontend/src/api/issues.ts:275` | `GET /workspaces/{slug}/issues/recent/?limit=N` → `r.data.results` 만 사용 (`next`/`count` 버림) |
| 백엔드 | `backend/apps/issues/views.py:250` | `assignees=본인`, 삭제/보관 제외, `-updated_at` 정렬 후 **`[:limit]` (기본 10, 최대 100) 하드컷** |
| 전역 페이지네이션 | `backend/config/settings/base.py:146` | `PageNumberPagination`, `PAGE_SIZE = 50` (이 뷰는 별도 지정 없음 → 전역값 적용) |
| 기존 무한 로딩 사례 | `frontend/src/components/admin/AdminResourceTable.tsx:70,226` | `useInfiniteQuery` + **"더 보기" 버튼** (자동 스크롤 로딩 아님) |

프로젝트 전체 grep 결과 **`IntersectionObserver` 사용처는 0건** — 자동 무한 스크롤은 아직 없는 기능입니다.

---

## 2. 현재 코드에서 발견한 결함 3건

### (결함 1) 모두보기 페이지에 스크롤 컨테이너가 없음 — 사용자가 말한 "화면 밖으로 나감"의 직접 원인
`AppLayout.tsx:105` 의 `<main className="flex-1 overflow-hidden">` 때문에 **스크롤 권한은 각 페이지가 직접 가져야** 합니다.
- 대시보드: `PageTransition className="... overflow-y-auto h-full"` (`WorkspaceDashboard.tsx:291`) → 정상
- 모두보기 페이지: `<PageTransition>` 에 className 없음 (`RecentIssuesPage.tsx:29`) → **넘치는 항목이 잘린 채 스크롤 불가**

즉 무한 스크롤을 붙이기 전에 **이 페이지는 애초에 스크롤이 안 되는 상태**입니다. 이것부터 고쳐야 합니다.

### (결함 2) `limit=100` 을 요청해도 실제로는 50건만 표시됨
뷰가 쿼리셋을 `[:100]` 으로 자르지만 그 위에 전역 `PageNumberPagination(PAGE_SIZE=50)` 이 다시 적용됩니다.
응답의 `results` 는 1페이지 50건뿐이고, 프론트는 `next` 를 쓰지 않으므로 **나머지 50건은 영원히 못 봅니다.**
(코드 경로 기준 판단입니다. 실제 응답으로도 확인 가능 — 검증 절차는 6장.)

### (결함 3) 100건 하드컷 자체
101번째 이후 이슈는 접근 수단이 없습니다. 이건 관리자 목록에서 이미 정리한 원칙
(메모: "관리자 목록은 규격으로 — 하드컷 금지, 총 건수 항상 노출")과 어긋납니다.

> 정리: 요청 2번은 "무한 스크롤 추가"이지만, 실제로는 **스크롤 자체가 막혀 있고 + 데이터도 50건에서 끊기는** 상태를 함께 풀어야 합니다.

---

## 3. 요청 1 — 홈 위젯을 "아래로" 내리기 (해석이 갈림 → 결정 필요)

현재는 넓은 화면(xl 이상)에서 우측 고정 컬럼입니다. "아래로 내린다"는 세 가지로 읽힙니다.

### 안 A. 2열 유지 + 우측 컬럼 안에서 아래로 내림
```
┌───────────────┬──────────┐
│ 내 할 일       │          │  ← 위쪽 여백
│               │ 최근 업데이트│
└───────────────┴──────────┘
```
- 변경: `aside` 를 감싸 `xl:mt-N` 또는 `xl:sticky xl:top-4` → `xl:self-end` / `top` 값 조정
- 장점: 최소 변경(1~2줄). 단점: 좁은 화면(xl 미만)에서는 어차피 이미 아래에 쌓이므로 체감 변화 없음

### 안 B. 2열 해제 → 내 할 일 아래 전체 폭 섹션으로 이동 (권장)
```
┌──────────────────────────┐
│ 내 할 일                   │
├──────────────────────────┤
│ 최근 업데이트 (전체 폭)      │
└──────────────────────────┘
```
- 변경: 그리드 제거, `aside` → 본문 흐름상 마지막 블록. 위젯 폭이 넓어져 제목 truncate 도 줄어듦
- 장점: "아래로 내린다"는 표현에 가장 부합, 모든 화면 폭에서 일관
- 단점: 우측 고정으로 항상 보이던 성질이 사라짐(스크롤해야 보임)

### 안 C. 좌우 컬럼 순서 교체 없이 sticky 만 해제
- `xl:sticky xl:top-4` 만 제거 → 스크롤하면 자연스럽게 위로 흘러 올라가고 아래에 남음
- 가장 작은 변경이지만 "초기 위치"는 그대로 상단이라 요청과 어긋날 소지

**권장: 안 B.** 다만 "우측에 항상 붙어 있길 원하지만 시작 높이만 낮추는 것"이 의도라면 안 A 입니다.

---

## 4. 요청 2 — 무한 스크롤 설계

### 4-1. 백엔드 (`WorkspaceRecentIssuesView`)
`limit` 슬라이스를 제거하고 **표준 페이지네이션으로 전환**합니다.

```python
class RecentIssuesPagination(PageNumberPagination):
    page_size = 20                 # 모두보기 1페이지 분량
    page_size_query_param = "page_size"   # 위젯은 page_size=10
    max_page_size = 100
```
- 뷰: `pagination_class = RecentIssuesPagination`, `get_queryset()` 에서 `[:limit]` 제거
- 결과: `count`(총 건수) · `next`(다음 페이지) 가 정상 의미를 가짐 → 결함 2·3 동시 해소
- **호환성**: `?limit` 은 이 뷰의 두 호출처(위젯/모두보기)에서만 쓰이므로 제거해도 외부 영향 없음.
  단, 이번 배포 시 **프론트/백엔드가 같이 나가야** 합니다(프론트만 먼저 나가면 `page_size` 무시 → 위젯이 50건 렌더).

#### 페이지네이션 클래스를 어디에 둘 것인가 (선택지)
- (i) `apps/issues/views.py` 안에 로컬 정의 — 가장 수술적, 이번 요구엔 충분
- (ii) `backend/config/pagination.py` 로 공용 `StandardPagination` 신설 후 이 뷰에 적용 — 이후 다른 목록도 재사용 가능.
  기존 `apps/admin_console/pagination.py:AdminPagination` 은 **건드리지 않음**(관리자 상한 200은 성격이 다름)

> 권장: (ii). 목록 API가 앞으로도 늘어날 것이고, "뷰마다 임의 하드컷"을 막는 근거가 한 곳에 생깁니다. 다만 규칙 9(단순함) 기준으로 (i)도 정당합니다.

### 4-2. 프론트 API 레이어
```ts
// 변경 전: results 만 반환 → 페이지네이션 불가
recentByWorkspace: (slug, params?: { limit?: number }) => ... .then(r => r.data.results)

// 변경 후: 응답 전체 반환 (count/next 필요)
recentByWorkspace: (slug, params?: { page?: number; page_size?: number }) =>
  api.get<PaginatedResponse<Issue>>(`/workspaces/${slug}/issues/recent/`, { params }).then(r => r.data)
```
호출처 2곳 동시 수정 필요:
- 위젯(`WorkspaceDashboard.tsx:232`): `page_size: 10` + `select: (d) => d.results` 로 기존 사용법 유지
- 모두보기(`RecentIssuesPage.tsx`): `useInfiniteQuery`

### 4-3. 무한 스크롤 훅 (재사용 자산)
`frontend/src/hooks/useInfiniteScroll.ts` 신설 — **sentinel ref 하나만 반환**하는 얇은 훅.

```ts
/** 목록 끝의 sentinel 이 뷰포트에 근접하면 onLoadMore 를 1회 호출한다. */
export function useInfiniteScroll(opts: {
  hasNextPage: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
  rootMargin?: string;   // 기본 "300px" — 바닥에 닿기 전에 미리 로드
}): React.RefObject<HTMLDivElement>
```
- 내부: `IntersectionObserver` 로 관찰. `root: null`(뷰포트)로 두면 **스크롤 컨테이너가 페이지 내부여도
  뷰포트 교차로 판정되므로 정상 동작**합니다(컨테이너가 뷰포트를 꽉 채우는 구조이므로).
- 재사용처(향후, 이번 범위 아님): `AdminResourceTable` 의 "더 보기" 버튼을 이 훅으로 교체하면
  관리자 목록도 동일한 트위터식 로딩이 됩니다. 이번엔 **건드리지 않고 선택지로만 남깁니다.**

### 4-4. 모두보기 페이지 재작성 골자
- `PageTransition` 에 `className="h-full overflow-y-auto"` 부여 → **결함 1 해소**
- `useInfiniteQuery` + `getNextPageParam: (last) => last.next ? Number(new URL(last.next).searchParams.get("page")) : undefined`
  (관리자 테이블과 **동일한 패턴** 재사용 — `AdminResourceTable.tsx:78`)
- 리스트 하단에 sentinel `<div ref={sentinelRef} />` + 로딩 중 스켈레톤 2~3행
- 헤더에 `표시 N / 전체 M` 건수 표기 (관리자 목록 규칙과 동일한 취지, "잘렸는지 모르는 상태" 방지)
- 끝에 도달하면 sentinel 만 사라짐 (별도 "끝입니다" 문구는 넣지 않음 — 온보딩성 UI 금지 기조와 일관)

---

## 5. 변경 파일 목록 (예상)

| 파일 | 변경 |
|---|---|
| `backend/config/pagination.py` | **신규**(선택지 ii 채택 시) — `StandardPagination` |
| `backend/apps/issues/views.py` | `WorkspaceRecentIssuesView`: `limit` 슬라이스 제거 + `pagination_class` 지정, docstring 갱신 |
| `frontend/src/api/issues.ts` | `recentByWorkspace` 시그니처/반환 변경 |
| `frontend/src/hooks/useInfiniteScroll.ts` | **신규** |
| `frontend/src/pages/workspace/RecentIssuesPage.tsx` | 스크롤 컨테이너 + 무한 스크롤 + 건수 표기 |
| `frontend/src/pages/workspace/WorkspaceDashboard.tsx` | 위젯 배치 변경(안 A/B/C 중 택1) + `page_size: 10`, `select` |
| `frontend/src/locales/ko/common.json` (+ en 있으면 동일) | 건수 문구 키 추가 (기존 `admin.pagination.showing` 재사용 가능 여부 확인 후 결정) |

백엔드는 뷰 로직만 바뀌므로 **마이그레이션 불필요**, 다만 `.py` 변경이라 **daphne 재시작 필요**(`/restart`).

---

## 6. 실행 계획과 검증 기준

1. 백엔드 페이지네이션 전환 → **검증**: `/issues/recent/?page_size=10` 이 10건 + `count` 총건수 반환,
   `?page=2` 가 11번째부터 반환. 담당 이슈가 100건 넘는 계정에서도 끝까지 페이징되는지 확인
2. API 레이어 + 위젯 수정 → **검증**: 홈 위젯이 이전과 동일하게 10건 표시(회귀 없음)
3. 위젯 배치 변경 → **검증**: 1920/QHD 및 좁은 폭에서 의도한 위치에 렌더, 내 할 일 카드 폭 깨짐 없음
4. `useInfiniteScroll` + 모두보기 페이지 → **검증**: (a) 스크롤이 실제로 동작 (b) 바닥 근처에서 자동으로 다음 페이지가 붙음
   (c) 마지막 페이지 이후 추가 요청이 발생하지 않음(네트워크 탭에서 중복/무한 호출 없음)
5. `npm run build` (tsc strict) 1회 통과 후 푸시 — 메모 규칙 "푸시 전 build 검증"

---

## 7. 결정 사항 (사용자 확정)

1. **홈 위젯 배치**: 안 B — 내 할 일 아래 전체 폭
2. **페이지네이션 클래스 위치**: 공용 `backend/config/pagination.py` 신설
3. **모두보기 1페이지 건수**: 20
4. `AdminResourceTable` 의 "더 보기" 버튼 전환: 이번 범위 밖(미변경)

---

## 8. 구현 결과 (2026-08-19)

### 실제 변경 파일
- `backend/config/pagination.py` **신규** — `StandardPagination` (page_size 20, `?page_size` 허용, 상한 100)
- `backend/apps/issues/views.py` — `WorkspaceRecentIssuesView` 의 `[:limit]` 하드컷 제거 + `pagination_class` 지정, import 1줄 추가
- `frontend/src/api/issues.ts` — `recentByWorkspace` 가 `PaginatedResponse` 전체 반환, 파라미터 `{ page, page_size }`
- `frontend/src/hooks/useInfiniteScroll.ts` **신규** — sentinel ref 반환 훅 (IntersectionObserver, rootMargin 기본 300px)
- `frontend/src/pages/workspace/RecentIssuesPage.tsx` — `useInfiniteQuery` + sentinel, `h-full overflow-y-auto` 부여, 헤더에 `N개 중 M개`
- `frontend/src/pages/workspace/WorkspaceDashboard.tsx` — 2열 그리드 해제(위젯을 본문 하단 전체 폭 `section` 으로), 위젯은 `page_size: 10` + `select`
- `frontend/src/locales/{ko,en}/common.json` — `dashboard.showingCount` 추가

### 검증 결과
- `python manage.py check` → 이상 없음
- 실데이터(담당 이슈 12건 계정)로 뷰 직접 호출:
  `page_size=2` → count 12 / results 2 / next 있음, `page=2` → results 2, `page_size=10` → results 10.
  **기존 결함 2(50건에서 끊김)와 결함 3(100건 하드컷) 해소 확인**
- 프론트 `npm run build` (컨테이너 내부, tsc strict) → 통과
- backend daphne 재시작 완료

### 남은 확인(브라우저에서)
- 모두보기 페이지에서 실제로 스크롤이 되고, 바닥 근처에서 다음 20건이 자동으로 붙는지
- 마지막 페이지 도달 후 추가 네트워크 요청이 없는지
- 홈에서 최근 업데이트가 내 할 일 아래 전체 폭으로 렌더되는지(좁은 폭/QHD 모두)
