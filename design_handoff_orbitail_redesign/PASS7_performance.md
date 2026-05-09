# PASS7 — 성능 (Performance Pass)

> **전제**: PASS5/6 완료 (테스트가 있어야 회귀 감지 가능).
> **목표**: 이슈 500개+ 워크스페이스에서도 끊김 없는 UX.
> **회귀 위험**: 중간 (가상화 도입 시 스크롤/포커스/키보드 nav 깨질 수 있음).

---

## Step 1 — 베이스라인 측정 (먼저!)

뭘 고칠지는 측정 후 결정. 추측으로 가상화 박지 말 것.

### 측정 대상

1. **Lighthouse** (production build)
   - WorkspaceDashboard / BoardPage / IssueListPage / TimelineView / GraphView
   - LCP, CLS, INP, TBT 기록

2. **React Profiler**
   - 이슈 100개 / 500개 / 1000개 시드 데이터로 IssueListPage 렌더 시간
   - 보드 dnd 시 프레임 드롭 (Performance 탭)

3. **Network**
   - 페이지 진입 시 동시 요청 수
   - 동일 query 중복 요청 (React Query 정책 미스)

4. **Bundle**
   - `pnpm build` 후 dist size 분석 (`vite-bundle-visualizer`)
   - 가장 큰 chunk 5개 identify

`design_handoff_orbitail_redesign/PASS7_baseline.md`에 결과 기록.

---

## Step 2 — React Query 정책 통일

### 현재 문제

각 hook이 staleTime/gcTime 다르게 설정 — 같은 데이터를 여러 번 fetch.

### 작업

`frontend/src/lib/query-defaults.ts` (신규):

```ts
export const QUERY_DEFAULTS = {
  // 거의 안 바뀌는 메타데이터
  meta: { staleTime: 5 * 60_000, gcTime: 30 * 60_000 },     // states, labels, members
  // 자주 바뀌는 리스트
  list: { staleTime: 30_000, gcTime: 5 * 60_000 },          // issues, comments
  // 실시간성 필요
  realtime: { staleTime: 0, gcTime: 60_000 },               // notifications, activity
};
```

`main.tsx`에서 QueryClient 기본값으로 적용 (가장 흔한 case = `list`).
개별 hook이 메타/실시간일 때만 override.

검증: Network 탭에서 페이지 전환 후 같은 endpoint 중복 호출 사라지는지.

---

## Step 3 — 가상화 (베이스라인이 임계점 넘을 때만)

### 임계점

- 100개 이하: 가상화 불필요
- 100~500개: react-virtuoso 도입 검토
- 500개+: 필수

### 우선순위

1. **IssueListPage 평면 모드** — 가장 단순, 가장 효과 큼
2. **TimelineView** — col_widths 계산 복잡, 가상화 후 헤더 sticky 회귀 주의
3. **BoardPage 컬럼 내 카드** — 컬럼당 100개+ 거의 없음, 보류
4. **GraphView** — canvas/SVG 기반이라 다른 문제 (노드 culling)

### 도입 (IssueListPage)

```bash
pnpm add react-virtuoso
```

`IssueListPage.tsx`:

```tsx
import { Virtuoso } from "react-virtuoso";

<Virtuoso
  data={filteredIssues}
  itemContent={(_, issue) => <IssueRow issue={issue} ... />}
  components={{ Header: ListHeader, EmptyPlaceholder: EmptyState }}
  increaseViewportBy={400}
/>
```

**주의**:
- 행 높이가 가변이면 `Virtuoso`가 알아서 측정
- 키보드 nav (j/k)는 `virtuoso.scrollToIndex` 호출
- focus 유지 — 행 클릭 후 모달 닫힐 때 해당 row로 복귀

### 계층 모드는 별도

부모-자식 expand 트리는 react-virtuoso로 못 함. **react-arborist** 또는 **TanStack Virtual + 수동 flatten** 필요. 베이스라인이 정말 느린 경우만 별도 PR.

---

## Step 4 — 코드 분할 (Lazy Load)

### 대상

- `IssueCreateDialog` (~30KB, 항상 로드되지만 첫 클릭까지 안 씀)
- `TemplateManageDialog` (~20KB)
- `GraphView` (~80KB, force-graph 라이브러리)
- `TimelineView` (~40KB)

### 작업

```tsx
const IssueCreateDialog = lazy(() => import("@/components/issues/IssueCreateDialog"));

// 사용처
<Suspense fallback={null}>
  {open && <IssueCreateDialog ... />}
</Suspense>
```

`Suspense` fallback은 모달의 경우 `null` (트리거 버튼이 이미 보임).

검증: `pnpm build` 후 별도 chunk로 분리됐는지 (`stats.html`).

---

## Step 5 — 이미지 / 아이콘

### 아이콘

`lucide-react`가 tree-shake 잘 되지만, 프로젝트 어딘가에서 `import * as Icons` 패턴 쓰면 전부 들어옴. grep으로 확인:

```bash
grep -r "from 'lucide-react'" frontend/src | grep -E "import \*|import \{ \* "
```

발견되면 named import로 교체.

### 아바타 / 첨부 이미지

- `loading="lazy"` 기본
- 큰 첨부는 thumbnail variant (백엔드가 제공하면 사용, 없으면 백엔드 작업 별도 티켓)

---

## Step 6 — 메모이제이션 (마지막에!)

Profiler에서 실제로 느린 컴포넌트만 `React.memo` / `useMemo` / `useCallback`. **추측 금지**.

흔한 hot spot:
- `BoardPage`의 카드 (드래그 시 전체 리렌더)
- `IssueListPage` 행 (한 행 변경 시 전체 리렌더)
- `IssueMetaSidebar` (이슈 변경마다 8개 picker 전부 리렌더)

memo 후 Profiler 다시 측정해서 **실제로 빨라졌는지 확인**. 안 빨라지면 되돌림 (memo는 비용도 있음).

---

## 체크리스트

- [ ] PASS7_baseline.md 작성 (Lighthouse / Profiler / Network / Bundle)
- [ ] QueryClient 기본 정책 통일 (`query-defaults.ts`)
- [ ] 중복 query 제거 검증 (Network 탭)
- [ ] (조건부) IssueListPage 가상화
- [ ] (조건부) TimelineView 가상화
- [ ] 4개 모달/뷰 lazy load
- [ ] Bundle visualizer로 chunk 분리 확인
- [ ] 아이콘 import 패턴 점검
- [ ] Profiler 기반 핫스팟 memo (측정 → memo → 재측정)
- [ ] PASS7_results.md (before/after 수치)

---

## 비목표

- ❌ Server-side rendering — 별도 결정
- ❌ Service Worker / PWA — 별도 결정
- ❌ WebSocket 도입 — PASS10에서 다룸

---

## 작업 시간 추정

- Step 1 (측정): 0.5일
- Step 2 (query): 0.5일
- Step 3 (가상화): 1~2일 (조건부)
- Step 4 (lazy): 0.5일
- Step 5 (images): 0.5일
- Step 6 (memo): 0.5~1일

총 3~5일.
