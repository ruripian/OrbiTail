# 활동 로그 갱신 기준 + 스프린트 분리 제안

작성일: 2026-08-19 / 대상 브랜치: `feat/admin-console-overhaul`

---

# 1. 활동 로그 — 언제 기록되는가

## 1-1. 모델

`backend/apps/issues/models.py:384 IssueActivity`

| 필드 | 내용 |
|---|---|
| `issue` | 대상 이슈 (CASCADE) |
| `actor` | 실행자 (SET_NULL — 탈퇴해도 로그는 남음) |
| `verb` | `"created"` / `"updated"` |
| `field` | 바뀐 필드명 |
| `old_value` / `new_value` | 값 (문자열) |
| `created_at` | 기록 시각 |

## 1-2. 기록되는 지점은 **단 두 곳**

전체 백엔드에서 `IssueActivity` 를 만드는 코드는 2곳뿐이다.

### (A) 단건 수정 — `views.py:185 IssueDetailView.perform_update`
저장 전후 값을 비교해 **달라진 필드만** 기록한다.

```python
old_values = {"title": …, "priority": …, "state": state.name}
updated = serializer.save()
new_values = {…}
activities = [IssueActivity(...) for field, old in old_values.items() if old != new_values[field]]
```

**→ 추적 대상은 `title` · `priority` · `state` 세 개뿐이다.**

### (B) 일괄 수정 — `views.py:1069 IssueBulkUpdateView`
벌크 툴바로 여러 이슈를 한 번에 바꿀 때. `updates` 로 들어온 **모든 필드** + `assignees` + `label` 을 기록한다.
단 **`old_value` 를 남기지 않는다**(변경 전 값을 모으지 않음) — 로그에 "무엇에서" 가 빠진다.

## 1-3. 기록되지 **않는** 것 (실사 결과)

| 동작 | 로그 |
|---|---|
| 이슈 **생성** | ❌ — `verb="created"` 를 만드는 코드가 어디에도 없다 |
| 이슈 삭제 / 보관 | ❌ |
| 담당자 변경 (단건) | ❌ (벌크로 바꿀 때만 기록) |
| 라벨 변경 (단건) | ❌ (벌크만) |
| 마감일 · 시작일 변경 | ❌ |
| 설명(본문) 수정 | ❌ |
| 부모/하위 관계 변경 | ❌ |
| 스프린트 배정 변경 | ❌ (같은 함수 안에서 처리하면서도 로그는 안 남김) |
| 댓글 작성 | ❌ (댓글은 별도 모델이라 활동 탭에 안 섞임) |
| 첨부 추가/삭제 | ❌ |

> 정리하면 활동 로그는 **"제목·우선순위·상태 세 필드의 단건 변경"** 과 **"벌크 수정"** 만 남깁니다.
> `verb` 에 `"created"` 가 정의돼 있는데 실제로 쓰이지 않아, 모델 주석("Audit log")이 실제 범위보다 넓게 읽힙니다.

## 1-4. 프론트

- 조회: `IssueDetailPage.tsx:124` → `["activities", issueId]`
- 표시: `issue-detail/tabs/ActivityTab.tsx`
- **갱신 시점**: 이슈 수정 시 `useIssueRefresh.refreshIssue()` 가 `["activities", issueId]` 를 invalidate 한다
  (`hooks/useIssueMutations.ts:39`, `IssueDetailPage.tsx:164`). **정정** — 초판에서 "invalidate 하지 않는다"고 적었으나 사실과 다르다.

## 1-5. 개선 후보 (제안, 미착수)

1. **이슈 생성 로그** — `verb="created"` 를 실제로 남긴다. 타임라인의 시작점이 생긴다
2. **추적 필드 확대** — 담당자·마감일·부모·스프린트를 단건 경로에도 추가
3. **벌크에도 old_value** — 지금은 "무엇에서 무엇으로"의 절반만 남는다
4. **수정 후 `["activities"]` invalidate** — 방금 한 변경이 즉시 보이게
5. (선택) 필드별 추적 목록을 상수로 뽑아 단건/벌크가 같은 정의를 공유

---

# 2. 스프린트 분리 — 지라를 참고한 제안

## 2-1. 현황

| 화면 | 파일 | 역할 |
|---|---|---|
| 리포트 | `views/ReportsView.tsx` (65줄) | **탭 2개**: "현재 스프린트"(SprintView) + "히스토리"(AnalyticsView) |
| 스프린트 뷰 | `views/SprintView.tsx` (461줄) | 좌측 스프린트 목록(상태별) + 우측 번다운·이슈 목록. 생성/삭제 포함 |
| 스프린트 페이지 | `pages/project/SprintsPage.tsx` (191줄) | `/projects/:id/sprints` — 스프린트 **CRUD 폼**(이름/설명/상태/기간) |

**문제**: 스프린트를 다루는 화면이 **둘로 갈라져 있다**(SprintView / SprintsPage). 게다가 하나는 "리포트" 안에 들어 있어서,
리포트가 "보고서"인지 "작업 도구"인지 성격이 섞였다.

`Sprint` 모델은 이미 `draft / active / completed / cancelled` 상태를 갖고 있다.

## 2-2. 지라의 구조

지라는 스프린트를 **세 화면으로 나눈다.**

| 지라 화면 | 하는 일 |
|---|---|
| **Backlog** | 백로그 + 계획 중 스프린트들. 이슈를 드래그로 스프린트에 담고 **"스프린트 시작"** |
| **Board** | **활성 스프린트 하나**의 칸반. 매일 보는 작업 화면 |
| **Reports** | 번다운 · 속도(Velocity) · 누적 흐름. **읽기 전용 보고서** |

핵심 원칙은 **"계획(Backlog) / 실행(Board) / 회고(Reports)"의 분리**이고,
스프린트 시작·완료 같은 **상태 전이는 계획 화면에 둔다**는 점입니다.

## 2-3. 제안 — OrbiTail 에 맞춘 3단 분리

### 리포트 (요청대로 히스토리만)
- `ReportsView` 의 탭 구성을 없애고 **`AnalyticsView` 만** 남긴다
- 스프린트 번다운은 여기서 빼되, **완료된 스프린트의 결과 요약**은 히스토리 성격이므로 남길 수 있다
  (선택 — 2-4의 결정 사항)

### 스프린트 화면 (신설 · 통합)
지금 갈라진 `SprintView` + `SprintsPage` 를 **하나로 합친다.** 경로는 기존 `/projects/:id/sprints` 재사용.

```
스프린트
├─ 활성 스프린트          현재 진행 중 하나 — 기간·진척·남은 일수, [스프린트 완료]
├─ 예정 스프린트          draft 목록 — 이슈 담기, [스프린트 시작]
└─ 지난 스프린트          completed/cancelled — 접어두고 펼쳐 보기
```
- **상태 전이 버튼을 여기에 둔다**: `draft → active`(시작), `active → completed`(완료)
- **완료 시 미완료 이슈 처리**를 물어본다 — 지라의 핵심 동작. "다음 스프린트로 / 백로그로"
  (현재 OrbiTail 에는 이 흐름이 아예 없다)
- 이슈를 스프린트에 담는 것은 이미 되는 동작(`Issue.sprint`)이라, 드래그 배정만 얹으면 된다

### 보드/테이블 (실행)
- 지금처럼 두되, **"활성 스프린트만 보기" 필터**를 추가하면 지라의 Board 에 해당하는 화면이 된다
- 이건 별건이라 이번 범위에서 뺄 수 있다

## 2-4. 결정이 필요한 것

1. **완료 스프린트 요약을 리포트에 남길지** — 남기면 "히스토리"의 의미가 더 살고, 빼면 리포트가 순수 통계가 된다
2. **스프린트 화면 진입점** — 프로젝트 뷰 탭에 둘지(지금 리포트 자리) / 좌측 사이드바 항목으로 뺄지
3. **완료 시 미완료 이슈 처리**를 이번에 넣을지 — 지라의 핵심이지만 백엔드 동작(일괄 재배정)이 필요
4. **`SprintsPage` 의 CRUD 폼**을 새 화면에 흡수하고 옛 페이지는 지울지

## 2-5. 작업량 추정

| 항목 | 비용 |
|---|---|
| 리포트에서 스프린트 탭 제거 | 소 (ReportsView 65줄 → AnalyticsView 직접 노출) |
| SprintView + SprintsPage 통합 | 중 (두 화면 합치고 라우트 정리) |
| 시작/완료 상태 전이 + 확인 흐름 | 중 |
| 완료 시 미완료 이슈 재배정 | 중 (백엔드 엔드포인트 필요) |
| 보드 "활성 스프린트만" 필터 | 소 |


---

# 3. 구현 결과 (2026-08-19)

## 3-1. 관계 강조 제거
`TableView.tsx` 에서 약 4,600자 제거 — 컨텍스트/localStorage 키/노드그래프 쿼리/2-hop BFS/토글 버튼/행 dim·ring 스타일.
제거로 고아가 된 `Share2` import, `useSearchParams`, `focusIssueId` 도 함께 정리. 다른 화면 영향 없음.

## 3-2. 활동 로그 확장
`apps/issues/views.py` 에 추적 정의를 한 곳으로 모았다.

```python
TRACKED_FIELDS = {title, priority, state, assignees, label, sprint, parent, start_date, due_date}
_issue_field_snapshot(issue)   # 값을 전부 "사람이 읽는 문자열"로
_log_activities(issue, actor, before, after)   # 달라진 필드만 기록
```

| 항목 | 전 | 후 |
|---|---|---|
| 추적 필드 | title·priority·state (3) | **9개** (담당자·라벨·스프린트·상위·날짜 포함) |
| 이슈 생성 | 기록 없음 | `verb="created"` 기록 |
| 벌크 수정 | `new_value` 만 | **`old_value` 포함**, 실제 달라진 필드만 |
| 단건/벌크 일관성 | 각자 다른 로직 | 같은 스냅샷 함수 공유 |

검증: 생성 시 `('created', None)`, 수정 시 `priority: medium→urgent` / `assignees: None→sooho` / `due_date: None→2026-08-22`.

## 3-3. 스프린트 분리
**백엔드** (`apps/projects/views.py`)
- `SprintStartView` — draft→active. **활성 스프린트는 하나만** 허용(둘이면 번다운이 의미를 잃는다)
- `SprintCompleteView` — active→completed + **미완료 이슈를 다음 스프린트나 백로그로 이관**.
  그대로 두면 완료된 스프린트에 매달린 채 기본 목록에서 사라진다(`IssueListCreateView` 가 completed 스프린트를 제외하므로)

검증: 시작 200 / 중복 시작 400 / 완료 시 미완료 1건 S2 이관 / 완료된 스프린트 재완료 400.

**프론트**
- `ReportsView`(탭 래퍼) **삭제** → 리포트는 `AnalyticsView` 만 (순수 통계)
- 프로젝트 뷰에 **스프린트 탭 신설** — `SprintView` 에 시작/완료 버튼과 완료 다이얼로그(이관 대상 선택) 추가
- `SprintsPage` **삭제**, 옛 경로 `/projects/:id/sprints` 는 `?view=sprints` 로 리다이렉트(북마크 보존)
- 옛 `?view=sprints → reports` 리다이렉트 제거(이제 실재하는 뷰라 가로채면 안 됨)

## 3-4. 남은 것
- 보드/테이블의 "활성 스프린트만 보기" 필터 — 지라 Board 에 해당. 별건으로 분리
- 스프린트 설명·기간 수정 UI — 옛 `SprintsPage` 에 있던 편집 폼은 흡수하지 않았다(생성만 가능).
  필요하면 스프린트 탭에 편집 다이얼로그를 추가해야 한다
