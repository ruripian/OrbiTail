# 문서 본문 폭 + 전반적 해상도 대응 — 분석

작성일: 2026-08-19 / 대상 브랜치: `feat/admin-console-overhaul`

## 0. 요청

- 문서 화면의 **좌우 폭이 너무 좁다** — 특히 고해상도 모니터에서 더 심함
- 특정 화면만이 아니라 **여러 해상도에 전반적으로 대응**되면 좋겠다

---

## 1. 지금 앱이 해상도에 대응하는 방식 (실사)

### 1-1. 전역 타이포는 이미 뷰포트 비례다
`frontend/src/index.css:183`
```css
html { font-size: clamp(14px, 0.875vw, 19px); }
/* density 토글: compact 12~14px / comfortable 14~17px / spacious 16~20px  (index.css:190~192) */
```
→ `max-w-3xl`(48rem) 같은 **rem 기반 폭은 화면이 커지면 같이 커진다.**

| 뷰포트 | html font-size | `max-w-3xl` 실제 폭 |
|---|---|---|
| 1280 | 14px (하한) | 672px |
| 1920 | 16.8px | 806px |
| 2560 (QHD) | **19px (상한 도달)** | 912px |
| 3840 (4K) | 19px (그대로) | 912px |

**상한 19px 은 뷰포트 약 2171px 에서 걸립니다.** 그 이후로는 화면을 아무리 키워도
글자도 폭도 전혀 커지지 않고 **좌우 여백만 늘어납니다.** 이게 "고해상도에서 더 좁아 보이는" 이유 중 하나입니다.

### 1-2. 문서 본문은 그 혜택조차 못 받는다 (핵심 원인)
`frontend/src/pages/documents/DocumentSpacePage.tsx:596`
```tsx
<div className={cn("mx-auto w-full py-6 px-4 sm:px-6", fullWidth ? "max-w-none" : "max-w-[860px]")}>
```
- **`860px` 픽셀 고정** — 뷰포트가 1280이든 3840이든 항상 860px
- 대안은 `max-w-none`(제한 없음)뿐 → **"860px 아니면 화면 꽉 참"의 2단 극단**
- 게다가 문서 본문 글자 크기는 사용자가 px 로 조절합니다(`--doc-fs-body`, 14~24px).
  글자를 키워도 폭은 860px 고정이라 **줄당 글자 수가 줄어 더 답답해집니다.**

같은 성격의 px 고정이 문서 계열 전반에 흩어져 있습니다:
| 위치 | 값 |
|---|---|
| `DocumentSpacePage.tsx:596` | `860px` (편집/읽기 본문) |
| `DocumentSpacePage.tsx:918` | `960px` |
| `pages/public/PublicDocumentPage.tsx:45` | `860px` |
| `pages/request/RequestSubmitPage.tsx:199` | `880px` |
| `pages/team/TeamListPage.tsx:34` | `920px` |
| `pages/team/TeamDetailPage.tsx:90,142` | `1600px` |
| `pages/project/IssueDetailPanel.tsx:67` | `1760px` |

### 1-3. 폭 값이 페이지마다 제각각
전체 코드에서 컨테이너 폭으로 쓰이는 값이 **rem 클래스 7종(2xl~6xl) + px 하드코딩 7종**입니다.
공통 규칙이 없어서, "전반적으로 대응"하려면 **먼저 폭을 토큰으로 묶는 작업이 선행**돼야 합니다.

> 참고: `tailwind.config.ts` 에 `screens` 커스터마이즈가 없어 브레이크포인트는 Tailwind 기본
> (최대 `2xl` = 1536px). **QHD/4K 전용 분기는 존재하지 않습니다.**

---

## 2. 개선 설계

### 2-1. 폭 토큰 도입 (기반 작업)
`index.css` 에 CSS 변수로 폭 단계를 정의하고, `tailwind.config.ts` 의 `maxWidth` 로 노출합니다.

```css
:root {
  /* 읽기 본문 — 문서/공개문서/요청서 */
  --w-reading: clamp(720px, 60vw, 1180px);
  /* 폼·설정·목록 */
  --w-regular: clamp(640px, 50vw, 1000px);
  /* 대시보드·보드·팀 상세 */
  --w-wide:    clamp(960px, 90vw, 1800px);
}
```
```ts
maxWidth: { reading: "var(--w-reading)", regular: "var(--w-regular)", wide: "var(--w-wide)" }
```
사용은 `max-w-reading` / `max-w-regular` / `max-w-wide` 한 클래스로 끝납니다.
**앞으로 새 화면은 px 를 쓰지 않고 이 셋 중 하나를 고르면 됩니다** — 이게 "전반 대응"의 재사용 지점입니다.

효과(문서 본문 기준):
| 뷰포트 | 지금 | `--w-reading` 적용 후 |
|---|---|---|
| 1280 | 860 | 768 (좁은 화면에서 여백 확보) |
| 1920 | 860 | 1152 |
| 2560 | 860 | **1180 (상한)** |
| 3840 | 860 | 1180 |

### 2-2. 문서 본문 폭 — 기준을 무엇으로 잡을지 (선택지)

- **(가) vw clamp** — 위 `--w-reading`. 화면 크기에 비례. 구현 단순, 전 페이지 공통 토큰과 일관
- **(나) ch 단위** — `min(92ch, 82vw)`. **본문 글자 크기에 비례**하므로 글자를 키우면 폭도 같이 커져
  줄당 글자 수(가독성의 실제 기준)가 일정하게 유지됨. 문서에 폰트 조절 기능이 있는 이 앱에 가장 정확
- **(다) 3단 프리셋** — 이미 있는 "넓게 보기" 토글(`DocumentSpacePage.tsx:476`)을
  좁게 / 보통 / 넓게 3단으로 확장 (현재는 860px ↔ 무제한 2단)

> 권장: **(나) + (다) 조합.** 기본 폭은 ch 기반으로 두어 어떤 해상도·글자 크기에서도 적정 줄 길이를 유지하고,
> 기존 토글은 3단으로 넓혀 사용자가 그 자리에서 더 넓게/좁게 선택. (가)만 해도 요청은 해소되지만,
> 글자 크기를 키웠을 때 답답해지는 문제는 남습니다.

### 2-3. 전역 타이포 상한 (선택 · 영향 큼)
`clamp(14px, 0.875vw, 19px)` 의 **상한 19px → 21~22px** 로 올리면 2171px 이상 화면에서도 계속 커집니다.
- 장점: 4K 에서 UI 전체가 실제로 커짐(폭·글자·간격 동시)
- 단점: **모든 화면에 영향**. 사이드바/툴바/테이블 등 촘촘한 UI가 커지면서 기존 레이아웃이 흔들릴 수 있음
- density 토글(compact/comfortable/spacious)이 이미 있으므로, 이걸 건드리지 않고 **폭 토큰만으로도 요청의 대부분은 해소**됩니다

> 권장: 이번엔 **손대지 않음**. 폭 토큰 적용 후 실제로 봤을 때 여전히 작으면 그때 별도로.

---

## 3. 적용 범위 (단계별)

| 단계 | 대상 | 변경 |
|---|---|---|
| 1 | 문서 편집/읽기(`DocumentSpacePage` 596·918), 공개 문서, 요청 제출 | `max-w-[860px]` 등 → `max-w-reading`(또는 ch 기반) |
| 2 | 목록·설정 계열 (`RecentIssuesPage`, `InboxPage`, `SettingsLayout`, `WorkspaceSettingsLayout`, `TeamListPage`, `CreateProjectPage`, `DocumentSpaceSettingsPage`) | `max-w-3xl/2xl`, px → `max-w-regular` |
| 3 | 넓은 화면 (`TeamDetailPage` 1600px, `DiscoverProjectsPage`, `AdminConsoleLayout`, `IssueDetailPanel` 1760px) | → `max-w-wide` |

단계 2·3은 **시각 변화가 페이지마다 생기므로** 한 번에 다 하기보다 1단계 확인 후 진행하는 편이 안전합니다.
관리자 콘솔(`AdminConsoleLayout`)은 최근 개편한 화면이라 폭을 바꾸면 방금 맞춘 균형이 흔들릴 수 있어 **별도 확인 대상**입니다.

---

## 4. 검증 기준

1. 폭 토큰 추가 후 `max-w-reading` 이 실제로 클래스로 생성되는지 (Tailwind JIT — 임의 값 아닌 theme 확장이라 안전)
2. 문서 화면을 1280 / 1920 / 2560 / 3840 폭에서 확인 — 좌우 여백이 과하지 않고, 좁은 화면에서 잘리지 않음
3. 문서 글자 크기를 14 ↔ 24px 로 바꿔도 줄당 글자 수가 크게 변하지 않음 (ch 안 채택 시 이 항목 제외)
4. "넓게 보기" 토글이 기존처럼 동작 (3단 확장 시 각 단계가 실제로 반영)
5. 인쇄/PDF (`data-print-width`) 출력이 깨지지 않는지 — 인쇄는 화면 폭과 무관해야 함
6. `npm run build` 통과

---

## 5. 결정 사항 (사용자 확정)

1. **적용 범위**: 1+2+3단계 전부
2. **문서 폭**: 넓은 쪽 — 1920→약 1400px / 2560→1750px 상한
3. **글자 크기 연동**: 결합함 (글자를 키우면 폭도 같이 넓어짐)
4. **전역 타이포 상한(19px)**: 이번엔 유지

> 보충: 질문 단계에서 "ch 기반이면 해상도에 따라 같아지는가"는 **아니오**입니다.
> ch/em 은 **글자 크기**에 비례할 뿐, 문서 본문 글자는 px 고정이라 해상도가 올라가도 폭은 그대로입니다.
> 해상도 대응은 vw 가 담당합니다. 그래서 **양쪽을 결합**했습니다.

---

## 6. 구현 결과 (2026-08-19)

### 폭 토큰 (`frontend/src/index.css` `:root`)
```css
--w-doc:     clamp(calc(var(--doc-fs-body, 18px) * 42), 73vw, calc(var(--doc-fs-body, 18px) * 97));
--w-regular: clamp(600px, 56vw, 1240px);
--w-wide:    clamp(960px, 92vw, 2000px);
```
`tailwind.config.ts` 의 `maxWidth` 로 노출 → **`max-w-doc` / `max-w-regular` / `max-w-wide`** 클래스로 사용.
한글은 1자 ≈ 1em 이므로 `--w-doc` 의 42/97 은 곧 **"한 줄 최소 42자, 최대 97자"** 입니다.

문서 본문 실제 폭(본문 18px 기준):
| 뷰포트 | 변경 전 | 변경 후 | 한 줄 한글 |
|---|---|---|---|
| 1280 | 860 | 934 | 약 48자 |
| 1920 | 860 | 1402 | 약 73자 |
| 2560 | 860 | **1746 (상한)** | 약 93자 |
| 3840 | 860 | 1746 | 약 93자 |

본문 글자를 24px 로 키우면 상한도 2328px 로 함께 올라가 **줄당 글자 수(93자)가 유지**됩니다.

### 적용 파일
- **doc**: `DocumentSpacePage`(본문 596), `PublicDocumentPage`
- **regular**: `DocumentSpacePage`(스페이스 홈 918), `RequestSubmitPage`, `RecentIssuesPage`, `InboxPage`,
  `SettingsLayout`, `WorkspaceSettingsLayout`, `TeamListPage`, `CreateProjectPage`, `DocumentSpaceSettingsPage`,
  `ArchivedProjectsPage`, 프로젝트 설정 3종(Automation/Workflow/Notifications), 관리자 3종(Users/Workspaces/Superusers)
- **wide**: `DocumentsHomePage`, `AdminConsoleLayout`, `DiscoverProjectsPage`, `TeamDetailPage`(2곳), `IssueDetailPanel`

`DocumentSpacePage` 는 `--doc-fs-*` 선언 위치를 `doc-frame` → **바깥 컨테이너로 이동**했습니다.
CSS 변수는 상속되므로 본문 렌더는 동일하고, 폭 토큰이 본문 글자 크기를 참조할 수 있게 됩니다.

**손대지 않은 것**: 다이얼로그 폭(`max-w-3xl` 등 — 팝업은 성격이 다름), 워크스페이스 홈(원래 전체 폭),
전역 타이포 `clamp(14px, 0.875vw, 19px)`.

### 검증
- `npm run build` (컨테이너, tsc strict) 통과
- 빌드 산출 CSS 에 `max-w-doc{max-width:var(--w-doc)}` 등 3종 클래스와 `--w-doc` 변수 생성 확인
- 인쇄: `@media print` 의 `[class*="max-w-"] { max-width: none !important }` 가 새 클래스도 함께 무력화 → 출력 영향 없음

---

## 7. 사용자 보고 결함 2건 수정 (같은 날)

### (결함 A) 글자 크기를 바꿔도 폭이 안 따라옴
- **원인**: `--w-doc` 을 `:root` 에 선언했는데, CSS custom property 의 `var()` 는 **선언된 요소에서 치환**된다.
  `:root` 에는 `--doc-fs-body` 가 없으므로 폴백 18px 로 계산이 굳고, 자식이 글자 크기를 바꿔도
  이미 계산된 값이 상속될 뿐이었다.
- **수정**: `:root --w-doc` 제거 → `index.css` 의 **`.doc-width` 클래스**로 이동.
  이 클래스가 붙은 요소가 `--doc-fs-body` 를 함께 선언하므로 같은 요소에서 치환되어 연동된다.
  `tailwind.config.ts` 의 `maxWidth.doc` 도 제거(regular/wide 는 vw·px 뿐이라 그대로 유지).
  인쇄 무력화 규칙에 `[class*="max-w-"]` 만 있었으므로 `.doc-width` 를 함께 추가했다.

### (결함 B) 한 줄을 다 채우면 줄바꿈이 이상함
- **원인**: `.doc-editor` 에 줄바꿈 규칙이 없어 브라우저 기본값이 적용됐다.
  한글은 기본적으로 **음절 단위**로 끊기므로 "안녕하 / 세요" 처럼 어절 중간이 잘린다.
  폭이 넓어지면서 한 줄에 글자가 많아져 더 눈에 띄게 됐다.
- **수정**: `.doc-editor` 에
  ```css
  word-break: keep-all;      /* 어절을 지킴 */
  overflow-wrap: anywhere;   /* 한 줄보다 긴 URL·영문 토큰만 강제 분리 */
  ```
  `keep-all` 만 쓰면 긴 URL 이 본문 밖으로 삐져나가므로 둘을 같이 써야 한다.

검증: 재빌드 통과 + 산출 CSS 에 `.doc-width{max-width:clamp(calc(var(--doc-fs-body, 18px) * 42),73vw,…)}`,
`word-break:keep-all;overflow-wrap:anywhere`, 인쇄용 `.doc-width{max-width:none!important}` 생성 확인.

### 브라우저에서 확인할 것
- 문서 화면을 1920 / 2560 에서 보고 폭이 과하지 않은지 (과하면 `--w-doc` 의 `73vw` 또는 `97` 만 조정)
- "넓게 보기" 토글은 기존대로 2단(기본 ↔ 화면 꽉 참) 유지 — 3단 확장은 하지 않음
- 설정 화면 폼이 넓어진 것이 어색하지 않은지 (`--w-regular` 상한 1240px 조정 가능)
