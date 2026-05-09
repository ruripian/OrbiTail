# PASS6 — Storybook + 단위 테스트

> **전제**: PASS5의 4개 PR (A/B/C/D)이 모두 머지되었을 것.
> **목표**: 추출된 작은 컴포넌트들을 격리해서 검증할 수 있는 환경 구축.
> **회귀 위험**: 없음 (테스트/스토리만 추가, 프로덕션 코드 손대지 않음).

---

## 왜 지금인가

PASS5에서 IssueDetailPage 1381줄 → 600줄로 쪼갰다. 작은 컴포넌트는 단위 테스트 비용이 1/10이 된다. **이 시점이 테스트 도입의 골든 윈도우**. 더 미루면 컴포넌트가 다시 비대해질 위험이 있다.

---

## Step 1 — 도구 도입

### Storybook (이미 있으면 생략)

```bash
cd frontend
pnpm dlx storybook@latest init --type react-vite
```

설정:
- `.storybook/preview.tsx` — Tailwind 글로벌 CSS import, dark mode addon, i18n decorator
- `.storybook/main.ts` — `stories: ["../src/**/*.stories.@(ts|tsx)"]`

### Vitest

```bash
pnpm add -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

`src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);
```

`src/test/wrappers.tsx` — QueryClientProvider + i18n + Router를 묶은 `renderWithProviders`.

`package.json` script:
```json
"test": "vitest",
"test:ui": "vitest --ui",
"storybook": "storybook dev -p 6006"
```

---

## Step 2 — Story 작성 (우선순위 순)

### 1순위 — Picker 11개 (가장 재사용 빈도 높음)

`frontend/src/components/issues/*.stories.tsx`:

- `state-picker.stories.tsx`
  - Default / Empty / Many states (10+) / Disabled / In dialog
- `priority-picker.stories.tsx`
  - 모든 5단계 선택 상태 한눈에
- `assignee-picker.stories.tsx`
  - Single / Multi-select / 100명+ 검색
- `parent-picker.stories.tsx`
  - 자기 자신 제외, parentChain 제외 검증
- `label-picker`, `category-picker`, `sprint-picker`
  - Default / Selected / Empty
- `template-picker.stories.tsx` (PASS4 신설)
  - 템플릿 0개 / 3개 / 관리 모달 열기
- `template-manage-dialog.stories.tsx`

각 story는 mock data를 inline으로 — 실제 API 호출 없음. `parameters: { layout: "centered" }` 기본.

### 2순위 — PASS5 추출 컴포넌트

- `RestorableListView.stories.tsx`
  - Empty / Loading / Flat (10 rows) / Hierarchy (2 depth) / Long list (100 rows) / All actions hidden (perms false)
- `IssueMetaSidebar.stories.tsx`
  - Page mode / Panel mode / Read-only / Field issue (state dash)
- 5개 탭 (`SubIssuesTab` / `LinksTab` / `AttachmentsTab` / `CommentsTab` / `ActivityTab`) 각각
  - Empty / Loaded / Loading

### 3순위 — 기타 핵심

- `EmptyState.stories.tsx` (5가지 variant)
- `Sidebar.stories.tsx` (collapsed / expanded / WS status indicator 모든 상태)
- `Combobox.stories.tsx` (검색 / 키보드 nav / 빈 결과)

---

## Step 3 — 단위 테스트 (위험 영역만)

**모든 컴포넌트에 테스트를 쓰지 말 것**. 다음 5개 영역만 우선:

### 1. Mutation 흐름 (PASS5 가장 큰 회귀 위험)

`SubIssuesTab.test.tsx`:
- 추가 버튼 클릭 → `createSubIssueMutation` 호출되는가
- 성공 후 input clear 되는가
- 실패 시 에러 토스트 호출되는가 (sonner mock)

같은 패턴을 `LinksTab`, `AttachmentsTab`, `CommentsTab`에 반복.

### 2. 권한 분기

`RestorableListView.test.tsx`:
- `actions[i].visible = () => false` → 해당 버튼 렌더 안 됨
- TrashView 시나리오: `can_purge: false`일 때 영구삭제 버튼 숨김

### 3. ParentPicker 자기-제외 로직

```ts
test("자기 자신과 parentChain은 옵션에 안 나옴", () => {
  render(<ParentPicker issues={...} currentIssueId="A" excludeIds={["B", "C"]} ... />);
  // 옵션 리스트에 A, B, C 없는지
});
```

### 4. localStorage 마이그레이션 (PASS5-A)

`migrations.test.ts`:
- legacy key 있을 때 → new key로 옮겨지고 legacy 삭제됨
- migration flag 있을 때 → no-op
- 두 번 실행해도 idempotent

### 5. EmptyState description 번역 키 존재 검증

i18n 키 빠짐 회귀 방지:
```ts
test.each(["workspaces.empty.desc", "projects.empty.desc", ...])(
  "%s 키가 ko/en 양쪽에 존재", (key) => {
    expect(ko[key]).toBeDefined();
    expect(en[key]).toBeDefined();
  }
);
```

---

## Step 4 — CI 통합 (선택)

`.github/workflows/test.yml` (프로젝트가 GitHub Actions 쓰는 경우):

```yaml
- run: pnpm install
- run: pnpm typecheck
- run: pnpm lint
- run: pnpm test --run
- run: pnpm build-storybook
```

CI 없으면 README에 "PR 전 `pnpm test && pnpm typecheck` 실행" 한 줄.

---

## 체크리스트

- [ ] Vitest + Testing Library 설치, `pnpm test` 동작
- [ ] Storybook 설치, `pnpm storybook` 동작 (dark mode toggle 포함)
- [ ] Picker 11개 story 작성
- [ ] PASS5 추출 컴포넌트 story 작성 (RestorableListView, IssueMetaSidebar, 5개 탭)
- [ ] EmptyState / Sidebar / Combobox story 작성
- [ ] Mutation 4개 탭 단위 테스트
- [ ] 권한 분기 테스트
- [ ] ParentPicker 자기-제외 테스트
- [ ] localStorage 마이그레이션 테스트
- [ ] i18n 키 존재 테스트
- [ ] (선택) CI 워크플로우

---

## 비목표

- ❌ 100% 커버리지 — 시간 낭비
- ❌ E2E 테스트 — 별도 PASS (Playwright 도입은 PASS7 이후)
- ❌ 시각 회귀 도구(Chromatic) — 베타 사용자 피드백 후 결정

---

## 결과

- 신규 파일: ~25개 (story 16, test 9, 설정 4)
- 변경 파일: 0개 (프로덕션 코드 안 건드림)
- 작업 시간 추정: 2~3일
