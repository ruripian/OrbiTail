# 팀 설정 통합 — 실사 · 사례 비교 · 설계

작성일: 2026-08-21 / 대상 브랜치: `main` (`4e1ed29`)

## 0. 요청

1. **팀 설정 기능이 너무 빈약함**
2. 캘린더 아래에 흩어져 있는 **멤버 관리를 설정 안으로 합침**
3. **삭제도 설정 안으로** 합침
4. **팀 아이콘 설정 / 사진 불러오기** 관리 기능
5. **팀에서의 역할** 지정 — *결정: 권한이 아니라 **표시용 직책**(2-3 확인)*

---

## 1. 현재 상태 (실사)

### 1-1. 도메인별 설정 화면 대조

| | 프로젝트 설정 | 문서 스페이스 설정 | **팀 설정** |
|---|---|---|---|
| 구조 | 4탭 레이아웃 | 4탭 레이아웃 | **모달 1개** (`EditTeamDialog`) |
| 진입 | `/projects/:id/settings` | `/space/:id/settings` | 라우트 없음 — 헤더 버튼 |
| 일반 | 이름·아이콘·식별자·설명·공개범위·보관·삭제 | 이름·아이콘·식별자·설명·공개범위·홈문서·보관·삭제 | **이름·설명·색 3개** |
| 아이콘 | `ProjectIconPicker` | `ProjectIconPicker` | **없음** (raw `<input type="color">`) |
| 멤버 | 전용 탭 + 세부 권한 | 전용 탭 | **캘린더 아래 인라인** |
| 역할 UI | shadcn `Select` | shadcn `Select` | **raw `<select>`** |
| 삭제 | `DangerZone` + 이름 입력 확인 | 전용 위험 구역 섹션 | **헤더 버튼 + `window.confirm`** |
| i18n | `t()` 전면 적용 | `t()` 적용 | **하드코딩 한국어** |
| 파일 | `pages/project/settings/` 9개 | `pages/documents/settings/` 5개 | `TeamDetailPage.tsx` 1개에 전부 |

팀만 다른 패턴을 쓰고 있습니다. 기능이 적은 것보다 **일관성이 깨진 것**이 더 큰 문제입니다.

### 1-2. 이미 구현돼 있으나 UI에 노출되지 않은 것

문서 스페이스 때와 같은 구조입니다 — 없는 게 아니라 **연결이 안 돼 있습니다.**

| 이미 있는 것 | 위치 | 팀 UI 노출 |
|---|---|---|
| `Team.icon_prop` (JSONField) | `workspaces/models.py:189` | ❌ |
| `icon_prop` 시리얼라이저 필드 | `workspaces/serializers.py:85` | ❌ |
| `icon_prop` create/update API | `frontend/src/api/teams.ts:21,24` | ❌ |
| `ProjectIconPicker` (lucide 48 + 색 10 + **이미지 업로드**) | `components/ui/project-icon-picker.tsx` | ❌ |
| `DangerZone` (confirmText 입력 확인) | `components/ui/danger-zone.tsx` | ❌ |
| `TeamMember.Role` MEMBER(15)/ADMIN(20) | `workspaces/models.py:219` | △ raw `<select>` |

**팀 아이콘은 백엔드 작업이 0입니다.** 모델·시리얼라이저·API 클라이언트가 전부 준비돼 있고,
목록/상세가 `team.name.charAt(0)`으로 첫 글자만 그리고 있을 뿐입니다
(`TeamListPage.tsx:73`, `TeamDetailPage.tsx:105`).

### 1-3. 권한 모델 — 이 부분은 이미 견고함

`workspaces/views.py:841` `_is_team_admin()`:

```
team admin (role >= 20)  OR  workspace admin  → 팀 편집 권한
```

백엔드가 이미 막고 있는 것:

- 멤버 추가 시 **워크스페이스 멤버 subset 검증** (외부 인원 차단, `views.py:956`)
- **마지막 admin 강등 차단** (`views.py:999`)
- 멤버 제거는 team admin **또는 본인 탈퇴**
- 팀 생성자는 자동 ADMIN (`views.py:888`)

즉 권한 로직은 손댈 필요가 없습니다. **UI만 그 로직을 제대로 드러내면 됩니다.**

### 1-4. 팀 상세 페이지의 구조적 문제

현재 `/teams/:teamId` 한 화면이 세 가지 역할을 겸하고 있습니다:

```
헤더 (max-w-wide)      팀 정보 + [팀 설정] [삭제]   ← 관리
캘린더 (전체폭)         TeamCalendarSection         ← 일상 사용
멤버 목록 (max-w-wide)  목록 + 추가/역할/제거        ← 관리
```

폭 제약이 `wide → full → wide`로 두 번 끊기고, 매일 보는 캘린더와 가끔 쓰는 관리 UI가
같은 스크롤에 섞여 있습니다. 관리 기능을 분리하면 이 문제도 같이 해소됩니다.

---

## 2. 사례 조사

### 2-1. 팀 내 역할 · 권한

| 제품 | 권한 단계 | 표시용 직책 | 비고 |
|---|---|---|---|
| GitHub Teams | maintainer / member | 없음 | 팀 아바타·설명·부모 팀(중첩) |
| Notion Teamspace | Owner / Member | 없음 | 아이콘, 공개 범위 4단계 |
| Slack User Group | 그룹 관리자 지정 | 없음 | 핸들(@team), 기본 채널 |
| Linear | **없음** (워크스페이스 role만) | 없음 | 팀 아이콘·식별자·색 |
| Jira / Atlassian Teams | 없음 | 없음 | 팀 아바타, 헤더 이미지 |

**결론: 권한 단계는 어디도 2단계를 넘지 않습니다.** OrbiTail의 MEMBER/ADMIN은 업계 표준과
정확히 일치하므로 **권한 모델은 그대로 둡니다.**

표시용 직책은 위 제품 중 어디에도 없습니다. 다만 이들은 대부분 팀을 "권한 경계"로 쓰는 반면
OrbiTail의 팀은 **캘린더를 공유하는 사람 묶음**에 가깝습니다. 팀 캘린더에서 "이 일정이 누구
것인지"를 볼 때 직책이 실제로 도움이 되므로, 이 제품에서는 정당화됩니다.

### 2-2. 아이콘 / 이미지

| 제품 | 방식 |
|---|---|
| GitHub | 이미지 업로드만 (기본값은 자동 생성 아바타) |
| Notion | 이모지 / 아이콘 세트 / 이미지 업로드 3탭 |
| Linear | 아이콘 세트 + 색 |
| Slack | 이미지 업로드 |

Notion의 3탭 방식이 가장 넓고, **OrbiTail의 `ProjectIconPicker`가 이미 같은 구조**입니다
(lucide 탭 / 이미지 탭). 새로 만들 필요 없이 그대로 재사용합니다.

---

## 3. 제안 설계

### 3-1. 라우트 · 화면 구조

프로젝트·문서 스페이스와 **동일한 패턴**을 따릅니다.

```
/:ws/teams/:teamId                팀 홈 — 캘린더 + 멤버 요약 (읽기 전용)
/:ws/teams/:teamId/settings
   ├─ general   일반 — 이름 · 아이콘 · 설명 · 위험 구역(삭제)
   └─ members   멤버 — 목록 · 추가 · 권한 · 직책 · 제거
```

탭은 **2개**입니다. 프로젝트가 4탭인 것을 따라 억지로 늘리면 빈 페이지가 생깁니다.
팀에는 워크플로/자동화에 해당하는 개념이 없습니다.

**팀 홈에서 사라지는 것**: `[팀 설정]` `[삭제]` 버튼 → `[설정]` 버튼 하나로 대체(admin에게만).
**팀 홈에 남는 것**: 캘린더, 그리고 멤버 목록의 **읽기 전용 요약**(아바타 스택 + 인원수,
클릭 시 설정 › 멤버로 이동). 팀원이 누구인지는 매일 보는 정보라 홈에서 완전히 빼면 불편합니다.

### 3-2. 일반 탭

```
┌─ 팀 정보 ────────────────────────────────────┐
│  [아이콘]   팀 이름 *  [ Nimbus Studio      ] │
│   (Picker)  설명       [                    ] │
│   lucide/이미지        [                    ] │
└───────────────────────────────────────────────┘

┌─ 위험 구역 ──────────────────────────────────┐
│  팀 삭제                                      │
│  팀과 팀 멤버십이 삭제됩니다. 이슈·일정·프로젝트│
│  는 삭제되지 않습니다. 되돌릴 수 없습니다.     │
│  [ 팀 이름 입력 ]              [ 팀 삭제 ]    │
└───────────────────────────────────────────────┘
```

- **아이콘**: `ProjectIconPicker` 재사용. `value={parseIconProp(team.icon_prop)}`,
  `onChange`로 `teamsApi.update({ icon_prop })`.
- **팀 색**: raw hex 입력을 **제거**합니다. 아이콘이 색을 갖고 있어 편집 지점을 둘로
  나눌 이유가 없습니다. 자세한 근거는 §7-2.
- **삭제 문구**: 팀 삭제는 `Team` + `TeamMember` cascade만 지웁니다. 이슈·프로젝트·일정은
  팀을 참조하지 않으므로 영향이 없습니다. 이 사실을 문구에 명시해야 과잉 공포를 막습니다.
- `DangerZone`에 `confirmText={team.name}` — 프로젝트 삭제와 동일한 강도.

### 3-3. 멤버 탭

```
멤버 (5)                                    [+ 멤버 추가]
──────────────────────────────────────────────────────────
(A) 김루리   ruri@…      프론트엔드 ✎   [관리자 ▾]   ⋯
(B) 박하늘   sky@…       PM         ✎   [멤버   ▾]   ⋯
(C) 이바다   sea@…       ＋직책 추가     [멤버   ▾]   ⋯

권한 안내
  관리자  팀 이름·아이콘 편집, 멤버 추가/제거, 팀 삭제
  멤버    팀 정보와 팀 캘린더 조회
```

- **권한**: raw `<select>` → shadcn `Select` (프로젝트 `MembersPage.tsx:200`과 동일).
- **직책**: 인라인 편집. 빈 값이면 `＋직책 추가` placeholder. 본인 직책은 본인도 수정 가능,
  타인 직책은 team admin만.
- **제거**: 현재 hover 시에만 나타나는 `X` 버튼 → `⋯` 드롭다운(`팀에서 제거` / `팀 탈퇴`).
  hover-only 액션은 터치 기기에서 접근 불가입니다.
- **권한 안내 블록**: 프로젝트 멤버 탭에 이미 있는 패턴. 2단계뿐이라 짧게 끝납니다.

### 3-4. 직책(title) 필드 — 유일한 스키마 변경

```python
# workspaces/models.py — TeamMember
title = models.CharField(max_length=50, blank=True, default="")
```

- **표시 전용**입니다. 권한에 어떤 영향도 주지 않습니다. 모델 docstring에 명시할 것 —
  `role`과 나란히 있으면 다음 사람이 권한으로 오해합니다.
- `max_length=50`: "프론트엔드 개발자" 정도가 들어가고 목록 레이아웃이 깨지지 않는 길이.
- 자유 텍스트로 시작합니다. 워크스페이스 차원의 직책 사전(enum)은 만들지 않습니다 —
  요청에 없고, 쓰이는 걸 본 뒤에 정해도 늦지 않습니다.
- 노출 위치: 멤버 탭, 팀 홈 멤버 요약 tooltip. **팀 캘린더 chip에는 넣지 않습니다**
  (chip이 이미 좁습니다).

---

## 4. 백엔드 변경

| 파일 | 변경 |
|---|---|
| `workspaces/models.py` | `TeamMember.title` 필드 추가 + docstring에 "표시 전용" 명시 |
| `workspaces/migrations/` | `AddField` 마이그레이션 1건 (기본값 `""` — 데이터 마이그레이션 불필요) |
| `workspaces/serializers.py` | `TeamMemberSerializer.fields`에 `"title"` 추가 |
| `workspaces/views.py` | `TeamMemberDetailView.patch` — `title` 수용. **권한 분기: `role`은 team admin만, `title`은 team admin 또는 본인** |

`_is_team_admin`, 마지막 admin 보호, ws 멤버 subset 검증은 **손대지 않습니다.**

> **`workspaces/seeding.py`는 이번 범위에서 뺐습니다.** 실사해 보니 `DemoSeeder`는
> **팀을 아예 만들지 않습니다**(`seeding.py`에 `Team` 문자열이 0건). 즉 공개 데모
> 방문자에게는 팀 기능 전체가 보이지 않습니다. "팀 멤버에 직책 부여"가 아니라
> "데모에 팀을 만든다"는 별개 작업이라 요청 범위 밖으로 두었습니다. → §9 참조.

## 5. 프론트엔드 변경

| 파일 | 변경 |
|---|---|
| `pages/team/TeamSettingsLayout.tsx` | **신규** — `ProjectSettingsLayout` 구조 복제, 2탭 |
| `pages/team/settings/TeamGeneralPage.tsx` | **신규** — 아이콘·이름·설명·색 + `DangerZone` |
| `pages/team/settings/TeamMembersPage.tsx` | **신규** — `TeamDetailPage`에서 멤버 섹션 이식 + 직책 |
| `pages/team/TeamDetailPage.tsx` | 멤버 섹션·`EditTeamDialog`·삭제 제거 → 캘린더 + 멤버 요약 + `[설정]`. 현재 ~400줄 → ~150줄 |
| `pages/team/TeamListPage.tsx` | 첫 글자 아바타 → `ProjectIcon`, 생성 다이얼로그에 아이콘 선택 |
| `pages/team/TeamAvatar.tsx` | **신규** — icon_prop 있으면 `ProjectIcon`, 없으면 첫 글자 아바타 |
| `api/teams.ts` | `members.update` 시그니처에 `title?: string` |
| `types/index.ts` | `TeamMember`에 `title: string` |
| `router/index.tsx` | `teams/:teamId/settings` 중첩 라우트 + `index → general` 리다이렉트 |
| `pages/team/TeamCalendarSection.tsx` | 하드코딩 문자열 4건 → `t()` |
| `locales/{ko,en}/common.json` | **`team.*` 키 신규** — 작업 전 팀 키가 **0개**였습니다 |

### i18n 관련 주의

`TeamListPage`와 `TeamDetailPage`는 `useTranslation`을 **아예 쓰지 않고** 한국어가 하드코딩돼
있습니다(`TeamCalendarSection`만 사용). `ko/common.json`에 `team` 문자열이 0건입니다.
README·위키는 ko/en 양쪽을 갖췄는데 팀 화면만 영어가 없습니다. 새 파일 3개는 처음부터
`t()`로 쓰고, 옮겨오는 문자열도 같이 키로 뽑습니다.

---

## 6. 하지 않을 것 (명시적 비목표)

- **팀 공개 범위** — `Team` 모델 주석에 "비공개 옵션 없음(이번 정책)"이 명시돼 있습니다.
  이미 내린 결정이므로 이번 작업에서 뒤집지 않습니다.
- **권한 단계 추가** — 2단계가 업계 표준이고 이미 그렇게 돼 있습니다(2-1).
- **팀 리더(`Team.lead`) FK** — 직책 필드가 "김루리 · 팀장"으로 같은 필요를 덮습니다.
  둘 다 넣으면 표현이 두 곳으로 갈라집니다.
- **중첩 팀(부모 팀)** — GitHub에만 있고 요청에 없습니다.
- **팀 핸들(@mention)** — 별개 기능. 멘션 시스템 전반과 함께 다뤄야 합니다.
- **직책 사전(enum)** — 3-4 참조. 자유 텍스트로 시작합니다.

## 7. 제약 · 주의

1. **데모에서 아이콘 이미지 업로드 불가 — 단, 프로필 사진도 마찬가지입니다.**
   `demo/middleware.py`의 `_blocked_reason`은 경로를 보지 않고 **multipart + 파일이면
   무조건 403**입니다. 예외 목록이 없어 `settings.ts:48`의 프로필 아바타 업로드도 같이
   막힙니다(데모에서 잠깐 바뀐 것처럼 보이는 건 `ProfilePage.tsx`의 `onMutate` 낙관적
   미리보기이고, 403이 오면 `onError`에서 롤백됩니다).
   → 따라서 **팀 아이콘만 따로 막지 않습니다.** 프로필과 동일하게 에러 토스트로 처리합니다.
   나중에 데모에서 업로드 UI를 감춘다면 프로필·프로젝트·스페이스·팀 네 곳을 한꺼번에
   다룰 일이지, 이 작업의 범위가 아닙니다.

2. **`color`는 팔레트화하지 않고 편집 UI에서 뺐습니다.**
   실사해 보니 `Team.color`는 캘린더 chip이 아니라 **첫 글자 아바타 배경에만** 쓰이고
   있었습니다(`TeamListPage.tsx:71`, `TeamDetailPage.tsx:103` 두 곳뿐). 아이콘이 자체 색을
   갖는데 팀 색 입력을 따로 두면 색 관리 지점이 둘로 갈라집니다.
   → 아이콘 피커의 색으로 일원화하고, `Team.color`는 **아이콘 미지정 팀의 첫 글자 아바타
   색**으로만 남깁니다(`TeamAvatar`). DB 필드와 기존 값은 건드리지 않아 마이그레이션이
   필요 없고, 기존 팀의 화면도 그대로입니다.

3. **`/teams/:teamId` 라우트가 이미 존재합니다.** 중첩 라우트를 추가할 때
   `teams/:teamId`가 `element`를 직접 갖는 현재 형태(`router/index.tsx:225`)를
   `children`을 갖는 형태로 바꿔야 합니다.

4. **팀 삭제 후 이동 경로.** 현재 `/teams`로 navigate합니다. 설정 페이지에서 삭제하면
   같은 경로로 보내되, 설정 레이아웃이 언마운트되는 순서를 확인해야 합니다
   (`team` 쿼리가 404가 되면서 레이아웃이 먼저 깨질 수 있습니다).

---

## 8. 작업 순서

| # | 작업 | 검증 |
|---|---|---|
| 1 | `TeamMember.title` 모델 + 마이그레이션 + 시리얼라이저 | `makemigrations --check`, 기존 팀 API 응답에 `title: ""` 포함 |
| 2 | `TeamMemberDetailView.patch` title 수용 + 권한 분기 | admin이 타인 직책 수정 OK / 멤버가 타인 직책 수정 403 / 멤버가 본인 직책 수정 OK / 멤버의 role 변경 403 |
| 3 | 라우트 + `TeamSettingsLayout` (빈 탭 2개) | `/teams/:id/settings` 진입, index → general 리다이렉트 |
| 4 | `TeamGeneralPage` — 아이콘·이름·설명·색 | 아이콘 변경 후 새로고침 유지, 사이드바·목록에 반영 |
| 5 | `TeamGeneralPage` — `DangerZone` 삭제 | 이름 오타 시 버튼 비활성, 삭제 후 `/teams` 이동 |
| 6 | `TeamMembersPage` — 멤버 이식 + 직책 + `Select` + `⋯` 메뉴 | 마지막 admin 강등 시 백엔드 400 메시지 노출 확인 |
| 7 | `TeamDetailPage` 정리 — 캘린더 + 요약 + `[설정]` | 캘린더 동작 회귀 없음, 폭 제약 한 번만 끊김 |
| 8 | `TeamListPage` · `Sidebar` 아이콘 반영 | 아이콘 없는 기존 팀은 기본값으로 정상 표시 |
| 9 | ko/en i18n 키 + `locales.test.ts` | 테스트 통과(키 누락 검출) |
| 10 | `DemoSeeder` 직책·아이콘 부여 | `seed_demo` 재실행 후 데모 화면 확인 |

1-2는 백엔드, 3-10은 프론트라 나눠서 진행할 수 있습니다.

---

## 9. 구현 결과 (2026-08-21 완료)

§8의 1-9번을 모두 구현했습니다. 10번(DemoSeeder)은 §4 각주의 이유로 제외했습니다.

### 설계에서 달라진 점

| 항목 | 스펙 | 실제 | 이유 |
|---|---|---|---|
| 팀 색 | 10색 팔레트로 교체 | **입력 제거**, fallback 색으로만 존치 | §7-2 |
| 데모 업로드 | 이미지 탭 분기 필요 | **분기 없음** | §7-1 — 프로필도 동일하게 막혀 있어 팀만 예외를 둘 이유가 없음 |
| 아바타 | `ProjectIcon` 일괄 적용 | `TeamAvatar` (icon_prop 있으면 아이콘, 없으면 첫 글자) | 미지정 팀이 전부 같은 Box 아이콘이 되는 것을 피함 |
| `Sidebar.tsx` | 팀 항목에 아이콘 | **변경 없음** | 사이드바에 팀 **개별 항목이 없음** — `/teams` 링크 하나뿐 |
| `TeamCalendarSection` | 범위 밖 | 하드코딩 4건 → `t()` | 팀 화면의 하드코딩을 전부 제거하기로 함 |

### 피드백 반영 (같은 날)

| 지적 | 조치 |
|---|---|
| 아이콘이 고르는 즉시 저장돼서 무엇이 저장됐는지 모호함 | 아이콘도 폼에 넣어 **[저장]으로 한 번에** 반영. 바뀐 게 없으면 저장 버튼을 잠가 상태를 눈으로 알 수 있게 함. **프로젝트 설정과는 의도적으로 다름**(거기는 즉시 저장) |
| 멤버가 캘린더(85vh) 아래라 스크롤해야 보임 | 하단 멤버 목록을 없애고 **헤더에 아바타 스택 + 인원수**(클릭 시 설정 › 멤버). 캘린더 상단 멤버 칩 바가 이미 아바타+이름을 보여줘 하단 목록은 중복이었음 |

> 아이콘의 **파일 업로드 자체**는 여전히 고르는 즉시 일어납니다 — URL 을 받아야
> `icon_prop` 에 담을 수 있기 때문입니다. 저장하지 않고 나가면 업로드된 파일만 남는데,
> 프로젝트/스페이스 아이콘도 동일한 동작입니다.

### 검증

- `tsc --noEmit` 0 오류 / `eslint src/pages/team` 0 오류 0 경고 / `vite build` 성공
- `vitest run` 89개 전부 통과 (ko↔en 키 대칭성 테스트 포함)
- `manage.py check` 이슈 없음, 마이그레이션 `0008_teammember_title` 적용 완료
- 백엔드 테스트 파일이 없어 `APIClient`로 권한 분기를 직접 검증 — 9건 전부 기대대로:

  | 경우 | 결과 |
  |---|---|
  | admin → 타인 title 수정 | 200 |
  | member → 본인 title 수정 | 200 |
  | member → 타인 title 수정 | 403 |
  | member → 타인 role 변경 | 403 |
  | admin → 타인 role 승격 | 200 |
  | 마지막 admin 강등 | 400 (차단) |
  | admin 2명일 때 강등 | 200 |
  | 빈 PATCH | 400 |
  | title 51자 | 400 |

### 남은 것

1. **브라우저 실제 화면 확인은 하지 않았습니다.** 개발 DB 계정의 비밀번호를 몰라
   로그인할 수 없었습니다. 타입·린트·빌드·테스트와 API 검증까지가 확인 범위입니다.
2. **데모에 팀이 없습니다**(§4 각주). 이번 작업의 결과물이 공개 데모에서는 보이지
   않습니다. `DemoSeeder`에 팀 2개와 멤버십·직책을 심을지는 별도 판단이 필요합니다.
