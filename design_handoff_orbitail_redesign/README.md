# Handoff: OrbiTail Redesign

## 🚀 빠른 시작 (개발 AI에게 작업 맡길 때)

**[`HANDOFF_PROMPT.md`](./HANDOFF_PROMPT.md)** 의 프롬프트 블록을 통째로 복사 → Claude Code (또는 다른 개발 AI) 에게 붙여넣기.

전체 그림은 **[`ROADMAP.md`](./ROADMAP.md)** 에 있습니다.

## 📋 PASS 문서 인덱스

| PASS | 문서 | 상태 |
|---|---|---|
| 1 | `OrbiTail Design Audit.html` (visual audit) | ✅ |
| 2 | `PASS2.md` — Visual quick wins (token / focus / glass / EmptyState) | ✅ 머지 |
| 3 | `PASS3.md` — Sprint 2 lane / 모션 정리 | ✅ 머지 |
| 4 | `PASS4.md` — IA / Templates contextual / URL view 정리 | ✅ 머지 |
| **5** | **`PASS5.md` — 컴포넌트 추출 (4 sub-PR)** | 🟡 진행 |
| 6 | `PASS6_testing.md` — Storybook + 단위 테스트 | ⏳ |
| 7 | `PASS7_performance.md` — 가상화 / query 정책 / lazy | ⏳ |
| 8 | `PASS8_a11y.md` — focus / ARIA / 단축키 | ⏳ |
| 9 | `PASS9_onboarding.md` — Welcome flow / Coachmark / Getting Started | ⏳ |
| 10 | `PASS10_realtime.md` — Inbox / Presence / WS Pulse | ⏳ |

각 PASS는 자체적으로 PR 분할 / 게이트 / 체크리스트를 포함합니다. 사용자는 한 번에 한 PASS만 개발 AI에게 지시하고, 머지 후 다음 PASS로 넘어가세요.

---

## Overview (PASS1~4 컨텍스트)

OrbiTail의 전반적인 디자인·모션 시스템 점검 결과, 23개 개선 항목을 도출했습니다. 이 핸드오프 패키지는 그 개선안을 **실제 코드베이스(`orbitail/frontend`)에 단계적으로 적용**하기 위한 가이드입니다.

핵심은 세 축입니다:
1. **정체성** — Orbit 메타포를 장식이 아닌 시각 시스템으로 격상
2. **계층** — 우선순위/상태 색을 단일 hue 그라디언트 + 형태 시그널로 재설계 (WCAG 통과)
3. **모션** — 5종으로 분산된 duration을 3-tier 토큰으로 통일 + “관계를 보여주는 모션” 도입

---

## About the Design Files

이 번들에 포함된 `OrbiTail Design Audit.html`은 **디자인 레퍼런스/프로토타입**입니다. 그대로 옮겨 붙이지 마세요. 의도된 색·간격·모션·계층을 보여주는 명세이며, **실제 작업은 `orbitail/frontend` (React + Vite + Tailwind + shadcn + framer-motion + i18next) 환경에서, 기존 패턴·라이브러리를 따라 구현**해야 합니다.

대상 코드베이스는 이미 잘 토큰화되어 있으므로, 대부분의 변경은:
- `frontend/src/styles/tokens.css`
- `frontend/src/index.css` (CSS 변수 블록)
- `frontend/src/lib/motion-provider.tsx`
- `frontend/tailwind.config.ts`
- 그리고 컴포넌트 일부 (Sidebar, BoardPage, IssueListPage, button.tsx)

에 집중됩니다.

## Fidelity

**Mid-fidelity audit prototype.** 본 패키지의 HTML은 픽셀 단위 mock이 아니라 **개선 방향·토큰 값·모션 명세**를 시각화한 audit 보고서입니다. 실제 구현 시:
- **색·모션 토큰 값은 정확하게 사용** (아래 “Design Tokens” 섹션에 OKLCH 값 명시)
- **레이아웃과 컴포넌트 구조는 기존 코드의 shadcn 패턴을 유지**하면서, 활성 상태·border·우선순위 시각화 등 “패턴 단위”만 교체
- **새 모션(FLIP, shared element, WebSocket pulse)은 framer-motion의 기존 API로 구현**

---

## Implementation Phases

작업 순서대로 정리했습니다. 각 phase는 독립적으로 머지 가능합니다.

### Phase 1 — Quick Wins (이번 주, 4 items, ~1 day)

| # | 작업 | 파일 | 변경 내용 |
|---|---|---|---|
| 1.1 | `prefers-reduced-motion` 지원 | `src/index.css` | body::before perspective-wave 애니메이션을 `@media (prefers-reduced-motion: reduce)` 안에서 `animation: none`. MotionProvider 초기값도 `window.matchMedia('(prefers-reduced-motion: reduce)').matches` 검사 후 minimal로 시작. |
| 1.2 | `--border` 채도 낮추기 | `src/index.css` | 라이트 `--border: 220 8% 80%` (HSL) 또는 `oklch(0.85 0.012 260)`. 다크 `220 6% 24%`. 기존 primary 블루/골드 톤 제거. |
| 1.3 | focus-visible ring 분리 | `src/components/ui/button.tsx`, `index.css` | ring을 `2px solid var(--ring)` + `ring-offset-2`로 명시. `--ring` 값은 `--primary`와 별도로 두되 같은 hue, 다른 채도. |
| 1.4 | 모션 토큰화 | `src/lib/motion-provider.tsx`, `src/index.css` | CSS 변수 `--motion-fast: 120ms`, `--motion-base: 220ms`, `--motion-slow: 360ms`, `--ease-snap`, `--ease-smooth`, `--ease-orbit` 추가. MotionProvider의 spring/fade를 모두 이 변수로 매핑. |

### Phase 2 — System Fixes (이번 스프린트, 8 items)

#### 2.1 우선순위 색 재설계 (단일 hue + 형태 시그널)
`src/styles/tokens.css` + `src/constants/priority.ts`:

```css
:root {
  --priority-urgent:  oklch(0.50 0.22 25);
  --priority-high:    oklch(0.62 0.18 25);
  --priority-medium:  oklch(0.74 0.14 50);
  --priority-low:     oklch(0.82 0.08 90);
  --priority-none:    oklch(0.85 0.01 260);
}
```

`PRIORITY_LIST`에 `shape: 'diamond' | 'triangle' | 'circle' | 'ring' | 'dot'` 필드 추가. 우선순위 점 컴포넌트를 `<PriorityGlyph priority={p} />`로 분리하고 색+SVG 형태를 함께 렌더.

#### 2.2 state 토큰을 fill / text / border 3쌍으로 분해

```css
:root {
  --state-started-fill:   oklch(0.92 0.08 145);
  --state-started-text:   oklch(0.40 0.16 145);
  --state-started-border: oklch(0.55 0.16 145);
  /* started/completed/backlog/unstarted/cancelled 각각 3쌍 */
}
```

`tailwind.config.ts`의 `colors.state`도 `started: { fill, text, border }` 객체로 확장. 기존 단일 색을 사용하던 곳(BoardPage 컬럼 헤더 border, 라벨 칩 등)을 모두 적절한 변형으로 교체.

#### 2.3 라이트/다크 같은 hue로 통일
`src/index.css`의 `.dark` 블록에서 `--primary: 48 100% 48%` (골드)를 `221 70% 70%` 또는 `oklch(0.72 0.16 254)`로 변경. 골드는 워크스페이스 옵션 색 (`workspace.brand_color`)으로 격하 — `useWorkspaceColors` 훅에 추가.

#### 2.4 라우터에 `chrome` 메타 추가
`src/router/index.tsx`에서 각 라우트에 `handle: { chrome: 'branded' | 'minimal' | 'document' }` 추가. `AppLayout`에서 `useMatches()`로 읽어 `<body>` 또는 `<main>`에 `data-chrome="..."` 속성 부여.

```css
body[data-chrome="minimal"]::before { display: none; }
body[data-chrome="document"]::before { opacity: 0.3; }
```

매핑 가이드:
- `branded` — Login, RegisterPage, WorkspaceDashboard, WorkspaceSelectPage, empty states
- `minimal` — BoardPage, IssueListPage, IssueDetailPage, AdminPages, SettingsPages
- `document` — DocumentSpacePage, PublicDocumentPage

#### 2.5 Sidebar 활성 상태 단일화
`src/components/layout/Sidebar.tsx`의 `NavItem` / `SubLink`:
- `bg-primary/12` 채움 + 우측 dot 제거
- 좌측 3px bar (`::before`) 추가, 활성 시 `background: var(--accent)`, `border-radius: 99px`, `height: 60%`

```tsx
className={cn(
  "relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-[var(--motion-fast)]",
  active
    ? "text-foreground font-medium before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-[60%] before:bg-primary before:rounded-full"
    : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
)}
```

#### 2.6 Density 토글
새 파일 `src/lib/density-provider.tsx` (MotionProvider와 동형). `data-density="compact"|"comfortable"|"spacious"`를 `<html>`에 부여. CSS:

```css
html[data-density="compact"]    { font-size: clamp(13px, 0.7vw, 15px); }
html[data-density="comfortable"]{ font-size: clamp(14px, 0.875vw, 17px); }
html[data-density="spacious"]   { font-size: clamp(16px, 1vw, 19px); }
```

`PreferencesPage`에 라디오 토글 추가. localStorage key: `orbitail_density`. 문서 에디터(`DocumentEditor.tsx`) 내부는 항상 comfortable을 강제 (지역 div에 `data-density="comfortable"`).

#### 2.7 Empty state 컴포넌트
`src/components/ui/empty-state.tsx` 신규. props: `icon`, `title`, `description`, `cta`. 기본 icon은 작은 정적 SVG 행성 (Orbit 메타포 재사용).

적용처: IssueListPage, SprintsPage, DocumentExplorerPage, AnnouncementsPage, NotificationDropdown.

#### 2.8 FLIP — 보드 카드 상태 이동
`src/pages/project/BoardPage.tsx`:
- 카드 wrapper를 `motion.div`로 변경, `layout` prop + `layoutId={issue.id}` 부여
- 컬럼 컨테이너에 `<AnimatePresence>` 추가
- transition: `{ type: 'spring', stiffness: 400, damping: 32 }` 또는 단순 `{ duration: 0.22, ease: [0.4, 0.8, 0.2, 1] }` (orbit curve)

### Phase 3 — Strategic (이번 분기, 4 items)

#### 3.1 Orbit 메타포 → 시각 시스템
신규 컴포넌트:
- `<OrbitAvatar size workspace />` — 워크스페이스 아바타. `OrbiTailOrbit`의 행성 1~3개를 작게 렌더, 알림 미읽음 수에 따라 행성 추가.
- `<SprintProgressOrbit ratio />` — 호선 위 행성. `SprintBurndown.tsx`의 컴팩트 시각화 카드로 사용.

`OrbiTailOrbit.tsx`를 그대로 사용하지 말고 작은 variant 추출 (`OrbitGlyph` — single path, single dot, no halo). 현재의 큰 버전은 “브랜드 모먼트”용으로만.

#### 3.2 Display serif (선택)
Google Fonts에서 Fraunces variable 추가 (`frontend/font/`에 self-host). `--font-display: "Fraunces", var(--font-heading)`. 적용처는 단 4곳:
- AuthCardHeader
- WorkspaceDashboard greeting
- EmptyState title
- Onboarding/Setup hero

`fontFamily.display` 키를 tailwind 설정에 추가하고 `font-display` 유틸리티로 사용.

#### 3.3 Shared element transitions
이슈 리스트 → IssueDetailPanel/Modal:
- `IssueRow`의 제목·코드 span에 `motion.span layoutId={`issue-title-${id}`}`
- `IssueDetailPanel` 헤더의 같은 요소에 동일 layoutId
- `<AnimatePresence>`로 모달 열림/닫힘 감싸기

같은 패턴을 다음에도 적용: 문서 카드 → DocumentSpacePage, 프로젝트 카드 → ProjectIssuePage.

#### 3.4 WebSocket pulse — 실시간 활동 strip
`src/hooks/useWebSocket.ts` 또는 `useDocumentWebSocket.ts`에서 `issue.updated` 이벤트 수신 시 변경된 이슈 ID를 5초 동안 state에 유지하고, `IssueRow` 또는 보드 카드에 `data-recently-changed="userColor"` 부여:

```css
[data-recently-changed]::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  background: var(--recent-color, var(--accent));
  border-radius: 99px;
  animation: pulse-strip 0.4s var(--ease-smooth) forwards;
}
@keyframes pulse-strip { from { opacity: 0; transform: scaleY(0.3) } to { opacity: 1; transform: scaleY(1) } }
```

5초 후 React state에서 제거 → 자연스럽게 사라짐. 변경자 아바타 색은 `useAuthStore` 또는 user preferences에서.

---

## Design Tokens (정확 값)

### Colors — Light mode (oklch)
```
--bg-base:           oklch(0.97 0.008 260)
--bg-card:           oklch(0.99 0.006 260)
--ink:               oklch(0.21 0.02 260)
--ink-soft:          oklch(0.42 0.02 260)
--ink-mute:          oklch(0.62 0.015 260)
--rule:              oklch(0.88 0.012 260)
--rule-soft:         oklch(0.93 0.01 260)
--primary:           oklch(0.55 0.18 254)
--primary-fg:        oklch(0.99 0 0)
--ring:              oklch(0.55 0.18 254 / 0.5)
```

### Colors — Dark mode (same hue)
```
--bg-base:           oklch(0.18 0.02 260)
--bg-card:           oklch(0.22 0.02 260)
--ink:               oklch(0.92 0.01 260)
--ink-soft:          oklch(0.72 0.015 260)
--rule:              oklch(0.32 0.015 260)
--primary:           oklch(0.72 0.16 254)
```

### Priority (single hue gradient)
```
--priority-urgent:   oklch(0.50 0.22 25)   shape: ◆ filled
--priority-high:     oklch(0.62 0.18 25)   shape: ▲
--priority-medium:   oklch(0.74 0.14 50)   shape: ●
--priority-low:      oklch(0.82 0.08 90)   shape: ○
--priority-none:     oklch(0.85 0.01 260)  shape: · (dotted ring)
```

### State (3-pair)
```
backlog   fill 0.92/0.01/260  text 0.45/0.02/260  border 0.65/0.012/260
unstarted fill 0.94/0.02/260  text 0.50/0.02/260  border 0.70/0.015/260
started   fill 0.92/0.08/145  text 0.40/0.16/145  border 0.55/0.16/145
completed fill 0.92/0.10/180  text 0.40/0.14/180  border 0.55/0.14/180
cancelled fill 0.90/0.005/260 text 0.45/0.01/260  border 0.65/0.01/260  (strikethrough text)
```

### Motion
```
--motion-fast:       120ms   /* hover, button, tooltip */
--motion-base:       220ms   /* page, modal, panel, stagger 합 */
--motion-slow:       360ms   /* orbit, empty-state, brand moment */

--ease-snap:         cubic-bezier(0.2, 0, 0, 1)
--ease-smooth:       cubic-bezier(0.4, 0, 0.2, 1)
--ease-orbit:        cubic-bezier(0.4, 0.8, 0.2, 1)

stagger-step:        40ms (rich)  / 0ms (minimal)
spring (rich):       stiffness 400, damping 32, mass 0.8
```

### Type Scale (1.25 ratio)
```
display  48px / 1.05 / 600 / -0.025em / Fraunces
3xl      32px / 1.15 / 600 / -0.02em
2xl      22px / 1.25 / 600 / -0.01em
xl       18px / 1.4  / 600
lg       17px / 1.5  / 600
base     14px / 1.55 / 400
sm       13px / 1.5  / 400
xs       12px / 1.5  / 400
2xs      11px / 1.4  / 500 (mono, uppercase, tracking 0.08em)
```

### Spacing & Radius (변경 없음, 기존 유지)
- radius: `--radius: 0.75rem` 그대로
- spacing: tailwind 기본값 그대로

---

## Files in This Bundle

- `OrbiTail Design Audit.html` — 8 섹션 audit 리포트 (TOC, before/after, 모션 타임라인 포함). 구현 시 항상 시각 명세로 참조.
- `README.md` — 본 문서.

원본 코드 위치: `orbitail/frontend/` (사용자 로컬 폴더, 별도 import 또는 mounted access 필요).

---

## Acceptance Criteria

각 phase가 끝났을 때 확인해야 할 것:

**Phase 1**
- [ ] OS 레벨 reduced-motion 켰을 때 점 격자가 멈춤
- [ ] 카드들이 더 이상 “선택된 듯” 보이지 않음
- [ ] Tab으로 포커스 이동 시 ring이 명확히 보임
- [ ] grep으로 `0.15`, `0.2`, `0.22`, `0.25`, `300ms` 같은 하드코딩 모션 값이 없음

**Phase 2**
- [ ] 우선순위 5종이 색 + 형태로 모두 구분됨 (색맹 시뮬레이터로 검증)
- [ ] 라이트/다크 mode primary가 같은 hue
- [ ] BoardPage / IssueListPage 진입 시 점 격자 + Orbit이 안 보임
- [ ] WCAG AA: 모든 priority/state 텍스트 ≥ 4.5:1, 큰 텍스트 ≥ 3:1
- [ ] Density 토글이 PreferencesPage에서 작동, 새로고침 후 유지
- [ ] Board에서 카드 드래그-드롭 시 FLIP 애니메이션 발생

**Phase 3**
- [ ] WorkspaceDashboard에 SprintProgressOrbit 카드 1개 이상
- [ ] Login + Dashboard greeting에 display serif 적용
- [ ] 이슈 리스트 → 모달 전환 시 제목이 같은 위치에서 자연스럽게 이어짐
- [ ] 다른 탭에서 이슈 수정 시 5초간 strip이 표시되고 사라짐

---

## Notes for Claude Code

- 기존 i18n 키(`common.json`)는 깨뜨리지 말 것. 새 라벨은 추가만.
- 기존 storage key 유지: `orbitail_motion_mode`. 새 key는 `orbitail_density` 사용.
- `framer-motion`은 이미 의존성에 포함됨 — `layout`, `layoutId`, `AnimatePresence`만 추가 활용.
- `recharts`는 SprintBurndown에서만 사용 중 — Orbit 진행률 시각화는 plain SVG로 (의존성 늘리지 말 것).
- 변경 PR은 phase 단위로 분리. 각 PR description에 본 README의 해당 phase 체크리스트 포함.
- 디자인 audit HTML은 dev 서버에 띄우지 말고 `design_handoff_orbitail_redesign/`에만 두기.
