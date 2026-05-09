# PASS8 — 접근성 (Accessibility Pass)

> **전제**: PASS5 완료 (컴포넌트 분리), PASS6 권장 (story로 a11y addon 검증 가능).
> **목표**: WCAG 2.1 AA 핵심 요건 충족 + 키보드/스크린리더 사용 가능.
> **회귀 위험**: 낮음 (대부분 추가 — ARIA 속성, focus ring).

---

## Step 1 — Audit (자동 + 수동)

### 자동

```bash
pnpm add -D @axe-core/react eslint-plugin-jsx-a11y
```

- `eslint-plugin-jsx-a11y` 룰 활성화 → 빌드 시 경고
- Storybook a11y addon 설치 → 각 story에 violation 표시
- `axe-core` Cypress/Playwright 통합은 PASS7 이후 E2E 시 도입

### 수동 (체크리스트)

핵심 5개 플로우를 **마우스 끄고** 키보드+스크린리더(Mac VoiceOver, Win NVDA)로 통과:

1. 로그인 → WorkspaceDashboard 진입
2. 새 이슈 생성 (단축키 포함)
3. 이슈 상태 변경 (StatePicker 키보드 nav)
4. 댓글 작성 + 멘션
5. 보드에서 이슈 컬럼 이동 (dnd 대체 키보드)

`PASS8_audit.md`에 발견된 issue 기록.

---

## Step 2 — Focus 관리

### Focus trap

다음 컴포넌트에 focus trap 필수:

- 모든 Dialog (Radix Dialog 쓰면 자동, 직접 만든 것만 점검)
- IssueCreateDialog, TemplateManageDialog, IssueDetail panel mode
- Combobox dropdown (Picker 11개)

`@radix-ui/react-focus-scope` 또는 `focus-trap-react` 활용.

### Focus visible

PASS2에서 글로벌 ring 추가했음 (`*:focus-visible`). 점검:

- 모든 인터랙티브 요소가 ring 받는지
- ring이 잘리지 않는지 (`overflow: hidden` 부모 주의)
- ring 색이 light/dark 모두 contrast 3:1 이상

### Focus 복원

다이얼로그 닫힐 때 트리거 버튼으로 focus 복귀:
- Radix Dialog는 자동
- 직접 만든 거면 `useRef` + `triggerRef.current?.focus()` in `onClose`

---

## Step 3 — ARIA 패턴 점검

### Combobox (Picker 11개)

표준 ARIA combobox pattern:

```tsx
<button
  role="combobox"
  aria-expanded={open}
  aria-controls="state-listbox"
  aria-haspopup="listbox"
  aria-label={t("issues.detail.meta.state")}
>
  {currentLabel}
</button>

<ul id="state-listbox" role="listbox">
  {options.map(o => (
    <li role="option" aria-selected={o.id === current} ...>
      {o.label}
    </li>
  ))}
</ul>
```

키보드:
- ↑↓ — 옵션 이동
- Enter — 선택
- Esc — 닫기
- Type-ahead — 첫 글자 검색

### Tab list (IssueDetailPage)

```tsx
<div role="tablist" aria-label={t("issues.detail.tabs.label")}>
  {tabs.map(t => (
    <button
      role="tab"
      aria-selected={activeTab === t.id}
      aria-controls={`panel-${t.id}`}
      id={`tab-${t.id}`}
      tabIndex={activeTab === t.id ? 0 : -1}
    >
      {t.label}
    </button>
  ))}
</div>

<div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
  ...
</div>
```

### Live region (토스트 / 실시간 변경)

```tsx
<div role="status" aria-live="polite" aria-atomic="true">
  {/* sonner toast */}
</div>
```

WS reconnect 같은 시스템 변경은 `role="alert" aria-live="assertive"`.

### 보드 dnd 키보드 대안

react-beautiful-dnd / @dnd-kit는 키보드 모드 내장. 점검:
- Space — 카드 잡기
- ↑↓ — 같은 컬럼 내 이동
- ←→ — 컬럼 간 이동
- Space — 놓기
- Esc — 취소

각 동작에 `aria-live` 안내 메시지 ("카드를 In Progress 컬럼으로 이동했습니다").

---

## Step 4 — 키보드 단축키

### 일람표 + Help dialog

`?` 키 누르면 단축키 dialog 열림:

```tsx
useHotkeys("shift+?", () => setHelpOpen(true));
```

dialog 내용 (예시):

| 카테고리 | 단축키 | 동작 |
|---|---|---|
| 글로벌 | `c` | 새 이슈 생성 |
| | `g` `i` | 이슈 페이지 |
| | `g` `b` | 보드 페이지 |
| | `/` | 검색 |
| | `?` | 이 도움말 |
| 이슈 디테일 | `s` | 상태 변경 |
| | `p` | 우선순위 변경 |
| | `a` | 담당자 변경 |
| | `e` | 편집 |
| | `Cmd/Ctrl + Enter` | 저장 |
| 리스트/보드 | `j` / `k` | 다음/이전 이슈 |
| | `Enter` | 열기 |
| | `x` | 선택 |

기존 단축키가 있으면 흩어진 정의를 `frontend/src/lib/hotkeys.ts`로 모아 단일 출처로.

### 검증

- 모든 단축키가 input/textarea focus 시 비활성 (`useHotkeys` 옵션)
- `Cmd+K` 같은 OS 충돌 단축키 없음
- 도움말 dialog 자체도 키보드로 닫힘

---

## Step 5 — 텍스트 / 색

### Contrast

PASS2에서 state 색은 손봤음. 추가 점검:

- placeholder 텍스트 (`text-muted-foreground/60` 같은 0.6 alpha) — light/dark에서 4.5:1 충족하는지
- disabled 상태 텍스트 — 3:1 (WCAG 1.4.11 비텍스트는 3:1)
- focus ring — 3:1 vs. 인접 색

도구: Stark / WebAIM contrast checker.

### Text scaling

브라우저 글자 크기 200%까지 깨지지 않게:
- 고정 px 너비 컴포넌트 점검
- truncate가 너무 빨리 발생 안 하는지

### 언어 지정

`<html lang={i18n.language}>` 동적 설정 — 스크린리더 발음 정확도.

---

## Step 6 — 폼 / 에러

### 라벨

모든 input에 visible label 또는 `aria-label`:

```tsx
<label htmlFor="title">{t("issues.create.title")}</label>
<input id="title" ... />
```

### 에러 연결

```tsx
<input
  id="title"
  aria-invalid={!!error}
  aria-describedby={error ? "title-error" : undefined}
/>
{error && <p id="title-error" role="alert">{error}</p>}
```

### 필수 표시

`aria-required="true"` + 시각적으로도 명확 (`*` 표시).

---

## Step 7 — 모션 감소

PASS2에서 `prefers-reduced-motion` 추가했지만, 신규 모션 점검:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- 자동재생 캐러셀 / 그래프 force simulation — 사용자가 일시정지 가능해야 함
- GraphView `animating` 토글이 이미 있음 → 기본값을 `prefers-reduced-motion`에 따라

---

## 체크리스트

- [ ] eslint-plugin-jsx-a11y, axe addon 도입
- [ ] 5개 플로우 키보드/SR 통과
- [ ] Focus trap (모든 dialog/dropdown)
- [ ] Focus visible 일관성
- [ ] Focus 복원 (모달 close 시)
- [ ] Combobox ARIA pattern (Picker 11개)
- [ ] Tab list ARIA pattern (IssueDetailPage)
- [ ] Live region (토스트, WS 상태)
- [ ] 보드 dnd 키보드 검증
- [ ] 단축키 일람표 + Help dialog (`?`)
- [ ] 단축키 단일 출처 (`lib/hotkeys.ts`)
- [ ] Contrast 점검 (placeholder / disabled / ring)
- [ ] 200% zoom 깨짐 없음
- [ ] `<html lang>` 동적 설정
- [ ] 모든 input 라벨 / 에러 ARIA 연결
- [ ] reduced motion 신규 애니메이션 점검

---

## 비목표

- ❌ WCAG AAA — 과도함
- ❌ 100% 자동 검사 통과 — 수동 검증이 더 중요
- ❌ 음성 입력 / 스위치 컨트롤 — 별도 PASS

---

## 작업 시간 추정

- Step 1 (audit): 0.5일
- Step 2 (focus): 1일
- Step 3 (ARIA): 1.5일
- Step 4 (단축키): 1일
- Step 5~7: 1일

총 4~5일.
