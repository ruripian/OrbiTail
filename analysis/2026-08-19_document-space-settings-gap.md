# 문서 스페이스 설정 — 이슈(프로젝트) 설정 대비 격차 분석 및 기능 제안

작성일: 2026-08-19 / 대상 브랜치: `feat/admin-console-overhaul`

## 0. 요청

1. 문서 탭 설정 페이지가 이슈(프로젝트) 설정에 비해 **너무 빈약함**
2. **이슈와 연결되어 있는지 / 연결할지**
3. **사람 관리 · 문서 관리자** 등이 있어야 함
4. Confluence 같은 제품과 비교해 **기능 추천 및 추가**

---

## 1. 현재 상태 (실사)

### 1-1. 두 설정 화면 대조

| | 프로젝트(이슈) 설정 | 문서 스페이스 설정 |
|---|---|---|
| 구조 | **4탭 레이아웃** (`ProjectSettingsLayout`) | **단일 페이지** (`DocumentSpaceSettingsPage`) |
| 탭/섹션 | general · members · workflow · automation | 일반 · 멤버 · 위험 영역 |
| 일반 | 이름/설명/아이콘/식별자/공개범위/보관 | **이름/설명만** |
| 사람 | 역할 + 세부 권한(`effective_perms`) | **역할 없는 단순 명단** |
| 콘텐츠 도구 | 상태·라벨·템플릿 | **없음** |
| 자동화 | 자동 보관·알림 연동 | **없음** |
| 파일 | `pages/project/settings/` 9개 파일 | 단일 파일 322줄 |

### 1-2. 문서 도메인에 **이미 구현돼 있으나 설정 화면에 없는 것**

여기가 핵심입니다. 기능이 없는 게 아니라 **관리 진입점이 없습니다.**

| 이미 있는 것 | 위치 | 설정 화면 노출 |
|---|---|---|
| 스페이스 아이콘 (`icon`, `icon_prop`) | `models.py:43-44` | ❌ |
| 스페이스 식별자 (`identifier`) | `models.py:52` | ❌ |
| 공개/비공개 (`is_private`) | `models.py:63` | ❌ (탐색 노출·가입 가능 여부를 좌우하는데도) |
| 스페이스 보관 (`archived_at`) | `models.py:66` | ❌ (프로젝트 연동 자동 보관만) |
| 문서 버전 이력 (`DocumentVersion`) | `models.py`, `/versions/` API | ❌ |
| 댓글 스레드 (`CommentThread`) | `/threads/` API | ❌ |
| 문서 템플릿 (`DocumentTemplate`, built_in/workspace/user) | `/templates/` API | ❌ (**스페이스 scope 자체가 없음**) |
| 공개 공유 링크 (`share_token`, `share_expires_at`) | `models.py:119-120` | ❌ (문서별로만, 정책 관리 없음) |
| 첨부 (`DocumentAttachment`) | 관리자 콘솔에만 검색 존재 | ❌ |
| 휴지통 (`deleted_at`) | soft delete 구현됨 | ❌ (복구 UI 없음) |

### 1-3. 이슈 연동 — **이미 연결돼 있습니다**

- **스페이스 ↔ 프로젝트**: `DocumentSpace.project` **OneToOne** (`models.py:27`).
  `space_type="project"` 인 스페이스는 프로젝트와 1:1로 묶여 있고, 이름·아이콘·보관 상태가 동기화됩니다.
- **문서 ↔ 이슈**: `DocumentIssueLink` (`models.py:198`) + 양방향 API
  (`/docs/<id>/issues/`, 이슈 쪽 `IssueDocumentLinksView`). 2026-05-28 에 출하된 기능입니다.

즉 **연결 여부는 이미 해결**돼 있고, 빠진 것은 **설정 화면에서 그 연결을 보고/관리할 방법**입니다.
(연결된 프로젝트가 무엇인지, 링크된 이슈가 몇 건인지, 연결을 끊을지 등)

### 1-4. 권한 모델 — 가장 큰 구조적 격차

`views.py:60-104` 실사 결과:

```
_check_space_access(user, space)   # 읽기
_check_space_edit(user, space)     # 편집
```
- 공용(shared) 스페이스: **`space.members` 에 있으면 곧 편집 가능**. 읽기 전용 참여가 불가능합니다.
- 프로젝트 스페이스: 프로젝트 멤버는 `effective_perms.can_edit` 을 따르지만,
  **`space.members` 로 추가된 사람은 무조건 편집 가능**합니다.
- **"문서 관리자" 개념이 없습니다.** `owner` 는 개인 스페이스용이고,
  스페이스 설정을 바꿀 수 있는 사람 = 편집 가능한 사람 전부입니다.

→ 요청하신 "사람 관리 / 문서 관리자"는 **UI 문제가 아니라 모델이 없는 문제**입니다.

### 1-5. 그 밖에 발견한 것 (참고, 이번 작업과 무관)

- `DocumentSpaceSettingsPage.tsx:324` 에 `export const __used_pm = (_: ProjectMember) => null;`
  — 미사용 import 경고를 피하려고 만든 더미 export 입니다. 정리 대상이지만 **요청 범위 밖이라 두었습니다.**

---

## 2. Confluence 와 비교

Confluence 의 Space settings 구성과 OrbiTail 현황을 대조했습니다.

| Confluence | OrbiTail 현황 | 판단 |
|---|---|---|
| Space details (name/key/description/logo) | 이름·설명만 | 필드는 있음, UI 없음 |
| **Permissions** (개인·그룹별 view/add/delete/admin) | 역할 없음 | **모델 신설 필요** |
| Restrictions (문서 단위 접근 제한) | 없음 | 신설 |
| **Templates** (스페이스 템플릿) | workspace/user scope 만 | scope 추가 |
| **Trash** (휴지통 복구) | soft delete 만 | UI 신설 |
| **Archive space** | 필드 있음 | UI 없음 |
| Export space (PDF/HTML) | 문서 단위 인쇄만 | 신설 |
| **Labels** (라벨로 문서 분류) | **문서 라벨 자체가 없음** (이슈는 `Label` 있음) | 신설 |
| Watchers / 알림 구독 | 없음 | 신설 |
| Analytics (조회수·인기 문서) | 조회 기록 모델 없음 | 신설 |
| Look and feel (테마) | 앱 전역 테마만 | 불필요 판단 |
| Homepage 지정 | 없음 | 소규모 신설 |

---

## 3. 제안 — 3단계 우선순위

### Tier 1. "이미 있는 것을 꺼내 쓰기" (모델 변경 없음, UI 위주)

프로젝트 설정과 **대칭되는 4탭 구조**로 재편합니다.

```
문서 스페이스 설정
├─ 일반      이름·설명·아이콘·식별자·공개범위(is_private)·연결된 프로젝트 표시·스페이스 보관·삭제
├─ 멤버      현행 통합 목록 (+ Tier 2 에서 역할 추가)
├─ 콘텐츠    휴지통(복구/영구삭제) · 첨부 목록 · 템플릿
└─ 연동      연결된 프로젝트 · 문서↔이슈 링크 현황 · 공개 링크 정책
```

- 비용: 프론트 위주. **`ProjectSettingsLayout` 과 같은 패턴을 재사용**하므로 구조는 검증된 것을 그대로 씀
- 효과: 요청하신 "빈약함"의 대부분이 여기서 해소됩니다

### Tier 2. 권한 모델 (요청하신 "사람 관리 / 문서 관리자"의 실체)

`DocumentSpace.members` (역할 없는 M2M) → **`DocumentSpaceMember` 중간 모델**로 승격.

```python
class DocumentSpaceMember(models.Model):
    space  = FK(DocumentSpace, related_name="space_members")
    member = FK(User)
    role   = IntegerField(choices=Role)   # VIEWER(5) / EDITOR(15) / ADMIN(20)
```
- `_check_space_access` / `_check_space_edit` 이 role 을 참조하도록 변경
- **ADMIN = 문서 관리자** — 스페이스 설정 변경·멤버 관리·삭제 권한
- 프로젝트 스페이스는 기존처럼 `ProjectMember.effective_perms` 를 우선하고, 추가 멤버만 role 적용
- 마이그레이션: 기존 `members` 전원을 EDITOR 로 이관 (지금 동작과 동일 → 무중단)
- **워크스페이스 멤버 역할(`role__gte=ADMIN`)과 같은 정수 등급 체계를 쓰면** 기존 권한 코드와 형태가 맞습니다

> 이건 백엔드 모델 + 마이그레이션 + 권한 함수 + 프론트가 함께 움직이는 작업입니다. Tier 1 과 분리해야 합니다.

### Tier 3. Confluence 대비 추가 기능 (선택)

우선순위 순으로 추천합니다.

1. **문서 라벨** — Confluence 의 핵심 분류 수단. 이슈 `Label` 모델이 이미 있어 형태를 그대로 따를 수 있음
2. **휴지통** — Tier 1 에 포함 가능 (모델 이미 있음)
3. **스페이스 템플릿** — `DocumentTemplate.Scope` 에 `SPACE` 추가 (1줄 + 필터)
4. **스페이스 홈 문서 지정** — `DocumentSpace.home_document` FK 하나
5. **구독/알림** — 스페이스 watch. 알림 인프라가 이미 있음
6. **문서 단위 접근 제한** — 권한 모델(Tier 2) 이후에만 의미 있음
7. **스페이스 내보내기** — 문서 인쇄 로직은 있으나 일괄 처리는 별건
8. **조회 분석** — 조회 기록 모델 신설 필요. 비용 대비 효용 낮다고 봅니다

---

## 4. 권장 실행 순서

1. **Tier 1** (4탭 재편 + 이미 있는 필드 노출 + 휴지통) → 검증: 각 탭에서 저장·복구가 실제 반영
2. **Tier 2** (권한 모델) → 검증: VIEWER 가 편집 불가, ADMIN 만 설정 변경 가능, 기존 멤버 무중단 이관
3. **Tier 3** 중 라벨 · 스페이스 템플릿 · 홈 문서 → 각각 독립 검증

Tier 1 만으로도 "이슈 설정 대비 빈약함"은 해소됩니다. Tier 2 는 요청하신 "문서 관리자"를 위해 필요합니다.

---

## 5. 결정 사항 (사용자 확정)

1. **범위**: Tier 1 + Tier 2
2. **권한 등급**: VIEWER(5) / EDITOR(15) / ADMIN(20) 3단
3. **프로젝트 스페이스 멤버**: 현행 유지 — 프로젝트 멤버는 프로젝트 권한 상속, 스페이스 추가 인원만 역할 적용
4. Tier 3 는 이번 범위에서 제외

---

## 6. 구현 결과 (2026-08-19)

### 백엔드
| 변경 | 내용 |
|---|---|
| `models.py` | `DocumentSpaceMember` 신설(space/member/role/created_at, unique). `DocumentSpace.members` 를 through 로 전환 |
| `migrations/0019_space_member_roles.py` | CreateModel → **데이터 이관(RunPython)** → `SeparateDatabaseAndState` → 옛 테이블 DROP |
| `views.py` | `_space_role()` 단일 판정 함수 신설. `_check_space_access`(VIEWER+) / `_check_space_edit`(EDITOR+) / `_check_space_admin`(ADMIN) 이 전부 이 함수를 씀 |
| `views.py` | `SpaceMemberListCreateView` / `SpaceMemberDetailView` (추가·역할변경·제거, **마지막 관리자 보호**) |
| `views.py` | `DocumentTrashView` (목록·복구·영구삭제). 복구 시 부모가 삭제 상태면 루트로 올림 |
| `views.py` | 스페이스 수정/삭제를 ADMIN 으로 제한, 생성자는 ADMIN 으로 등록 |
| `serializers.py` | `DocumentSpaceMemberSerializer`, `space_members` 필드, `archived_at` 쓰기 허용 |

**마이그레이션 주의**: Django 는 M2M 에 `through=` 를 붙이는 변경을 스키마 연산으로 처리하지 못한다
(`ValueError: you cannot alter to or from M2M fields, or add or remove through=`).
그래서 데이터를 먼저 옮기고 `SeparateDatabaseAndState` 로 state 만 맞춘 뒤 옛 테이블을 DROP 했다.

### 프론트
- `pages/documents/settings/` 신설 — 레이아웃 + 4탭 (일반 / 멤버 / 콘텐츠 / 연동).
  `ProjectSettingsLayout` 과 같은 구조이고, 스페이스 데이터와 내 등급은 레이아웃에서 한 번만 조회해 Outlet context 로 내려준다
- **일반**: 아이콘(`ProjectIconPicker` 재사용) · 이름 · 식별자 · 설명 · 공개 범위 · 보관/해제 · 삭제
- **멤버**: 역할 드롭다운, 프로젝트 상속 멤버는 출처 배지로 구분, 추가는 `UserPicker` 표준 사용
- **콘텐츠**: 휴지통(선택 복구 / 영구 삭제 / 비우기) + 워크스페이스 템플릿 목록
- **연동**: 연결된 프로젝트 + 문서↔이슈 링크 현황 집계
- 기존 `DocumentSpaceSettingsPage.tsx`(322줄 단일 페이지)는 삭제 — 잔여 참조 0건

### 검증
- 마이그레이션 적용: 기존 멤버십 2건 → 전원 EDITOR 로 이관 확인, `makemigrations --check` 변경 없음
- 권한: ADMIN=20(edit/admin 통과), VIEWER=5(edit·admin 모두 차단), VIEWER 의 설정 변경 시도 → **403**
- 기존 동작 유지: 공개 shared 스페이스에서 워크스페이스 멤버는 여전히 EDITOR(15)·편집 가능
  (검증용 임시 데이터는 트랜잭션 롤백으로 남기지 않음)
- 멤버 API / 휴지통 API 200 응답, `manage.py check` 이상 없음, 프론트 `npm run build` 통과

### 남은 것 (이번 범위 밖)
- Tier 3: 문서 라벨 · 스페이스 템플릿 scope · 홈 문서 지정 · 구독 알림 · 내보내기 · 조회 분석
- 브라우저 확인: 4탭 이동, 역할 변경 반영, 휴지통 복구 후 트리 표시
