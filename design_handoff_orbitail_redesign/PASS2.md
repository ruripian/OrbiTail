# OrbiTail Design Pass 2 — Week 1 Quick Wins

이 문서는 `OrbiTail Design Audit v2.html`의 **Week 1 lane** 5개를 단일 PR로 묶기 위한 구현 가이드다.
Pass 1(Phase 1–3)은 이미 main에 머지됨. 이 PR은 “토큰 시스템 바깥에 남아있는 잔재 청소”에 집중.

> 모든 변경은 기존 i18n 키, storage key(`orbitail_motion_mode`, `orbitail_density`), framer-motion / recharts 외 의존성을 깨지 않는다.

---

## 1. SprintProgress 토큰화 (CRITICAL)

**파일:** `frontend/src/pages/project/ProjectIssuePage.tsx` (≈L320–345)

진행 띠와 카운트 라벨이 `bg-green-500`, `text-green-600`, `text-blue-600`으로 박혀 있다.
이게 다른 모든 화면이 따르는 `--state-completed-fill` / `--state-started-fill` 토큰을 우회한다.

**Before**
```tsx
<div className="h-full rounded-full bg-green-500 transition-all duration-500"
     style={{ width: `${pct}%` }} />
...
<span className="flex items-center gap-1 text-green-600 shrink-0">
  <CheckCircle2 className="h-3 w-3" /> {completed}
</span>
<span className="flex items-center gap-1 text-blue-600 shrink-0">
  <Circle className="h-3 w-3" /> {inProgress}
</span>
```

**After**
```tsx
<div
  className="h-full rounded-full transition-all"
  style={{
    width: `${pct}%`,
    background: `hsl(var(--state-completed-fill))`,
    transitionDuration: "var(--motion-slow)",
  }}
/>
...
<span className="flex items-center gap-1 shrink-0"
      style={{ color: `hsl(var(--state-completed-text))` }}>
  <CheckCircle2 className="h-3 w-3" /> {completed}
</span>
<span className="flex items-center gap-1 shrink-0"
      style={{ color: `hsl(var(--state-started-text))` }}>
  <Circle className="h-3 w-3" /> {inProgress}
</span>
```

**검증**
- workspace에서 `brand_color`를 다른 hue로 바꾼 뒤 sprint 진행 띠가 따라가는지 확인
- 다크모드에서 띠 채도가 다른 카드와 어울리는지

---

## 2. Glass border tint 제거 (Light mode only)

**파일:** `frontend/src/index.css` (≈L103)

라이트 모드 `--glass-border`가 여전히 `rgba(61,114,232,0.35)` — 모든 카드에 옅은 파란 보더.
v1에서 `--border`는 슬레이트로 중립화했는데 glass만 남았다.

**Before**
```css
:root {
  --glass-border: rgba(61, 114, 232, 0.35);
  --glass-shadow: 0 8px 32px rgba(61, 114, 232, 0.08), ...;
  --glass-sidebar-shadow: 0 0 0 1px rgba(61, 114, 232, 0.12), ...;
}
```

**After**
```css
:root {
  --glass-border: hsl(var(--border) / 0.7);
  --glass-shadow: 0 8px 32px rgba(20, 28, 50, 0.08),
                  0 2px 8px rgba(20, 28, 50, 0.05),
                  inset 0 1px 0 rgba(255,255,255,0.60);
  --glass-sidebar-shadow: 0 0 0 1px hsl(var(--border) / 0.5),
                          2px 0 24px rgba(20, 28, 50, 0.06);
}
```

다크 모드(`.dark`)는 이미 옅음 — 손대지 말 것.

---

## 3. focus-visible 글로벌 ring (WCAG 2.4.7)

**파일:** `frontend/src/index.css` (`@layer base` 블록 끝)

raw `<button>`을 쓰는 dropdown trigger들(ProjectIssuePage filter 3개 등)이 키보드 포커스 시 시각 단서가 0.

**추가**
```css
@layer base {
  /* 키보드 포커스 — 모든 인터랙티브 요소에 ring 보장.
     mouse focus는 :focus-visible 매처 덕에 영향 없음. */
  button:focus-visible,
  a:focus-visible,
  [role="button"]:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
    border-radius: var(--radius);
  }
}
```

shadcn 컴포넌트는 자체 ring이 있으므로 outline이 중복돼도 시각적으로 문제 없음 — 그대로 둘 것.

---

## 4. Density 폰트 비율 재조정

**파일:** `frontend/src/index.css` (≈L185–189)

3단계 사이가 거의 1px 차이라 토글 효과가 미미.

**Before**
```css
html[data-density="compact"]     { font-size: clamp(13px, 0.7vw,   15px); }
html[data-density="comfortable"] { font-size: clamp(14px, 0.875vw, 17px); }
html[data-density="spacious"]    { font-size: clamp(16px, 1vw,     19px); }
```

**After**
```css
html[data-density="compact"]     { font-size: clamp(12px, 0.78vw,  14px); }
html[data-density="comfortable"] { font-size: clamp(14px, 0.875vw, 17px); }
html[data-density="spacious"]    { font-size: clamp(16px, 1.05vw,  20px); }
```

**검증**
- compact ↔ spacious 토글 시 명확한 변화가 느껴지는지 (FHD 1920px 기준 13px → 17px)
- TableView 행 높이가 비례 변화하는지 (rem 기반 spacing 확인)

---

## 5. EmptyState description·CTA 채우기

**검색 명령:**
```bash
rg "EmptyState\s+title=" frontend/src --type tsx
```

다음 사용처에서 description·CTA가 비어 있다:

| 파일 | 라인 | 권고 |
|---|---|---|
| `pages/project/views/TableView.tsx` | 1028 | description: 필터 적용 여부에 따라 분기 / CTA: `+ New issue` (filter 미적용 시) |
| `pages/AnnouncementsPage.tsx` | 102 | description: "새 공지가 등록되면 여기에 표시됩니다" |
| `pages/project/SprintsPage.tsx` | 98 | description + CTA: `+ Create sprint` |
| `pages/project/views/BacklogView.tsx` | 142 | description: "Backlog 이슈는 …" / CTA: `+ Add to backlog` |
| `pages/documents/DocumentExplorerPage.tsx` | 163 | description + CTA: `+ New document` |

i18n 키는 다음 네이밍 규칙 따라 추가:
```
empty.<scope>.title
empty.<scope>.description
empty.<scope>.cta
```

예시:
```json
// locales/ko/common.json
"empty": {
  "table": {
    "title": "이슈가 없습니다",
    "titleFiltered": "조건에 맞는 이슈가 없습니다",
    "description": "이 프로젝트에 첫 이슈를 만들어보세요.",
    "descriptionFiltered": "필터를 조정하거나 새 이슈를 만들 수 있습니다.",
    "cta": "+ 새 이슈"
  }
}
```

```tsx
// TableView.tsx
<EmptyState
  title={t(hasFilter ? "empty.table.titleFiltered" : "empty.table.title")}
  description={t(hasFilter ? "empty.table.descriptionFiltered" : "empty.table.description")}
  cta={!hasFilter && !readOnly ? (
    <Button size="sm" onClick={() => setCreateOpen(true)}>
      {t("empty.table.cta")}
    </Button>
  ) : undefined}
/>
```

영문(`locales/en/common.json`)도 동일 구조로 추가할 것.

---

## PR 체크리스트

- [ ] `pnpm typecheck` 통과
- [ ] `pnpm lint` 통과
- [ ] 라이트/다크 모드 양쪽 시각 회귀 확인 (Sprint banner, 모든 카드 보더, EmptyState 5곳)
- [ ] 키보드 Tab 순회 — 모든 dropdown·icon button에 ring 보임
- [ ] Density 토글 3단계 변화가 명확한지 육안 확인
- [ ] 신규 i18n 키 ko/en 양쪽 등록
- [ ] 새 의존성 추가 없음

## PR 메시지 템플릿

```
design: pass-2 quick wins (audit v2 / week 1)

5 cleanup items from post-Phase-1-3 audit:
- Sprint progress: replace hardcoded green/blue with state tokens
- Glass border: drop primary tint in light mode
- Global focus-visible ring (WCAG 2.4.7)
- Density type scale: widen compact↔spacious gap
- EmptyState: fill description + CTA across 5 sites

No new deps. Token-only changes for items 1-4. i18n keys added for item 5.
```
