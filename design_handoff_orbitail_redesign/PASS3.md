# OrbiTail Design Pass 3 — Cleanup & Duplication

이 문서는 `OrbiTail Design Audit v4 - Duplication.html`의 **Sprint 1 (Easy wins)** 8개 항목과
**Sprint 2 (컴포넌트 추출)** 중 가장 ROI 높은 2개를 단일 PR로 묶기 위한 구현 가이드다.

PASS2까지 머지된 상태 가정. 이 PR은 “페이지마다 남아있는 코드 잔재 + 중복 dialog 패턴 청소”에 집중.

> 모든 변경은 기존 i18n 키, API 시그니처, localStorage 키 동작을 깨지 않는다.
> localStorage 키 마이그레이션은 별도 PR로 분리.

---

## 작업 순서

토큰/시각 변경 없는 cleanup 먼저 → 그 다음 컴포넌트 추출 → 마지막 사용처 교체.
각 항목 후 `npm run typecheck && npm run lint` 한 번씩.

---

## 1. ProfilePage — Email read-only 정리 (15min)

**파일:** `frontend/src/pages/settings/ProfilePage.tsx` (≈L198–208)

변경 불가능한 값을 `<input disabled>`로 보여주는 건 어포던스 거짓말.
평문 한 줄 + 변경 안내 링크로 바꾼다.

**Before**
```tsx
<div>
  <Label>{t("settings.profile.email")}</Label>
  <Input
    type="email"
    value={user?.email ?? ""}
    disabled
    readOnly
    className="mt-1.5 bg-muted/40 cursor-not-allowed"
  />
  <p className="mt-1 text-xs text-muted-foreground">
    {t("settings.profile.emailReadonlyHint")}
  </p>
</div>
```

**After**
```tsx
<div>
  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
    {t("settings.profile.email")}
  </Label>
  <p className="mt-1 text-sm font-medium">{user?.email}</p>
  <p className="mt-1 text-xs text-muted-foreground">
    {t("settings.profile.emailChangeHint")}
  </p>
</div>
```

**i18n 키 추가:**
- `settings.profile.emailChangeHint` — ko: `"이메일을 변경하려면 지원팀에 문의하세요."` / en: `"Contact support to change your email."`
- 기존 `settings.profile.emailReadonlyHint`는 안 쓰면 제거.

---

## 2. SecurityPage — 계정 탈퇴 3중 확인 → 2중 (10min)

**파일:** `frontend/src/pages/settings/SecurityPage.tsx` (≈L175–185)

비밀번호 + "DELETE" 입력 + `window.confirm()` 3중 확인은 과한 friction이고,
`window.confirm`은 디자인 시스템 밖이라 톤도 깨진다. 비밀번호 + 확인 텍스트만 남긴다.

**Before**
```tsx
const handleDelete = async () => {
  if (!password || confirm !== "DELETE") return;
  if (!window.confirm(t("settings.security.deleteFinalConfirm"))) return;
  await deleteMutation.mutateAsync({ password });
};
```

**After**
```tsx
const handleDelete = async () => {
  if (!password || confirm !== "DELETE") return;
  await deleteMutation.mutateAsync({ password });
};
```

`settings.security.deleteFinalConfirm` i18n 키도 grep 후 미사용이면 제거.

> Step 4의 `<DangerZone>` 추출 시 이 페이지도 같이 교체될 거지만, 우선 friction부터 제거.

---

## 3. IssueDetailPage — PRIORITY_CONFIG 중복 제거 (10min)

**파일:** `frontend/src/pages/project/IssueDetailPage.tsx` (L31–37)

이 파일 상단에 하드코딩된 `PRIORITY_CONFIG`가 있는데, `@/constants/priority`에 이미
`PRIORITY_LIST`, `PRIORITY_LABEL_KEY`, 색상 상수가 있다. 중복 제거.

**Before**
```tsx
const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "#ef4444" },
  high:   { label: "High",   color: "#f97316" },
  medium: { label: "Medium", color: "#eab308" },
  low:    { label: "Low",    color: "#60a5fa" },
  none:   { label: "None",   color: "#9ca3af" },
};
```

**After**
- `frontend/src/constants/priority.ts`에서 `PRIORITY_COLOR` (또는 동등 export) 확인.
  없으면 거기에 추가하고, hex가 아닌 CSS variable (`var(--priority-urgent)` 등)로 통일.
- IssueDetailPage 상단 const 통째로 삭제. 사용처는 `import { PRIORITY_LABEL_KEY, PRIORITY_COLOR } from "@/constants/priority"` 로.
- 라벨은 `t(PRIORITY_LABEL_KEY[priority])`로.

**검증:** 우선순위 픽커 / 헤더 / 활동 로그 셋 모두 같은 색·라벨 나오는지 확인.

---

## 4. Sidebar — 잔재 제거 (10min)

**파일:** `frontend/src/components/layout/Sidebar.tsx`

### 4-1. Phase 주석 제거 (L30–33)
```tsx
// ❌ Phase 2.5: NavItem 좌측 인디케이터
// ❌ Phase 2.6: 즐겨찾기 섹션 …
```
→ 의도 주석은 keep, 단순 phase 번호는 git history에 맡기고 제거.

### 4-2. allFavorited 빈 텍스트 제거 (≈L355–365)
즐겨찾기에 모든 프로젝트를 등록한 상태("public 0 + favorite N")일 때
`{t("sidebar.allFavorited")}` 안내가 뜨는 분기. 사용자에게 의미 없는 정보.
조건문 통째로 제거 — public 섹션은 `publicProjects.length === 0`이면 그냥 안 그려지면 됨.

### 4-3. NavItem + AnnouncementsNavItem 통합
거의 동일한 두 컴포넌트가 `badge` prop 하나 차이로 분리되어 있다.

**Before**
```tsx
function NavItem({ to, icon, label, ... }) { ... }
function AnnouncementsNavItem({ to, icon, label, badge, ... }) { /* 거의 동일 + badge */ }
```

**After**
```tsx
interface NavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number; // optional — 있으면 우상단 카운트
  ...
}
function NavItem({ to, icon, label, badge, ... }: NavItemProps) {
  ...
  {badge !== undefined && badge > 0 && (
    <span className="ml-auto …">{badge > 99 ? "99+" : badge}</span>
  )}
}
```
사용처 1곳(공지) 변경. `AnnouncementsNavItem` export 제거.

---

## 5. WorkspaceDashboard — groupBy 토글 + 빈 필터 정리 (30min)

**파일:** `frontend/src/pages/workspace/WorkspaceDashboard.tsx`

### 5-1. groupBy state/project 토글 제거
대시보드 사용자가 그룹 기준을 자주 바꾸지 않는다. 상태별 그룹으로 고정.

- `groupBy` state · setter · localStorage 키 항목 모두 제거.
- `STATE_GROUPS` 기준으로 한 번만 그루핑.
- `PersistedFilters` 인터페이스에서 `groupBy` 필드 제거.
- 토글 UI(우상단 segmented control) 제거.

### 5-2. localStorage 마이그레이션
기존 키 `orbitail_dashboard_filters`에 `groupBy` 필드 들어 있는 사용자 데이터 처리:

```ts
function loadFilters(): Partial<PersistedFilters> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    delete parsed.groupBy; // ← 한 번만 정리, 다음 saveFilters에서 자연스럽게 제거됨
    return parsed;
  } catch {
    return {};
  }
}
```

> 이 PR에서는 localStorage 키 prefix 통일(`orbitail.dashboard.filters` dot-notation)은 다루지 않음 — Sprint 4의 별도 PR.

---

## 6. PreferencesPage — Save 버튼 제거 + 즉시 저장 통일 (1d)

**파일:** `frontend/src/pages/settings/PreferencesPage.tsx`

현재 Theme/Motion/Density는 onChange 즉시 저장, Language/Timezone/FirstDayOfWeek는 react-hook-form
+ Save 버튼. 일관성 깨짐. **모든 그룹 즉시 저장**으로 통일.

### 6-1. Locale 그룹 mutation 즉시 트리거
```tsx
// before — handleSubmit 안에서만 호출
const onSubmit = (values) => mutation.mutate(values);

// after — onValueChange/onChange에서 직접
<Select
  value={locale.timezone}
  onValueChange={(v) => {
    setLocale((prev) => ({ ...prev, timezone: v }));
    mutation.mutate({ ...locale, timezone: v });
  }}
>
```

Language, FirstDayOfWeek도 동일 패턴.

### 6-2. Save 버튼 + form wrapper 제거
```tsx
{/* 삭제 */}
<form onSubmit={handleSubmit(onSubmit)}>...
  <Button type="submit">{t("common.save")}</Button>
</form>
```

→ 그냥 div + 각 control에 onChange 핸들러.

### 6-3. 카드 그루핑 (선택, 같은 PR이면 병행)
Audit v4의 제안대로 7개 그룹 → 3개 카드:
- **Appearance**: Theme · Motion · Density
- **Locale & Region**: Language · Timezone · FirstDayOfWeek
- **Notifications**: 기존 그대로

기존에 hr만으로 분리했던 걸 `<Card>` 또는 `<section className="rounded-lg border …">`로 시각적 그루핑.

> 이 단계가 가장 시간이 오래 걸리고 회귀 위험도 가장 큼.
> 만약 이 PR이 너무 커지면 6-3을 다음 PR로 분리해도 됨.

---

## 7. `<DangerZone>` 컴포넌트 추출 (4h)

**신설:** `frontend/src/components/ui/danger-zone.tsx`

SecurityPage(계정 탈퇴), GeneralPage(프로젝트 archive/leave/delete) 4개 호출처가 비슷하지만
다르게 그려져 있다. 1개 컴포넌트로 통합.

```tsx
interface DangerZoneProps {
  title: string;
  description: string;
  /** 사용자가 정확히 입력해야 confirm 활성화. 생략하면 input 없이 바로 가능 */
  confirmText?: string;
  /** 비밀번호 입력 필요 여부 (account delete만 해당) */
  requiresPassword?: boolean;
  buttonLabel: string;
  onConfirm: (params: { password?: string }) => void | Promise<void>;
  isPending?: boolean;
  /** "subtle" = leave 같은 약한 위험, "destructive" = delete */
  severity?: "subtle" | "destructive";
}

export function DangerZone({
  title, description,
  confirmText, requiresPassword = false,
  buttonLabel, onConfirm,
  isPending = false,
  severity = "destructive",
}: DangerZoneProps) {
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");

  const isReady =
    (!confirmText || confirm === confirmText) &&
    (!requiresPassword || password.length > 0);

  return (
    <div className={cn(
      "rounded-lg border p-4",
      severity === "destructive"
        ? "border-destructive/30 bg-destructive/5"
        : "border-border bg-muted/30"
    )}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>

      {requiresPassword && (
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="mt-3"
        />
      )}

      {confirmText && (
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={`Type "${confirmText}"`}
          className="mt-2"
        />
      )}

      <Button
        variant={severity === "destructive" ? "destructive" : "outline"}
        disabled={!isReady || isPending}
        onClick={() => onConfirm({ password: requiresPassword ? password : undefined })}
        className="mt-3"
      >
        {isPending ? "..." : buttonLabel}
      </Button>
    </div>
  );
}
```

### 사용처 교체

**SecurityPage.tsx — 계정 탈퇴**
```tsx
<DangerZone
  title={t("settings.security.deleteAccount")}
  description={t("settings.security.deleteAccountDesc")}
  confirmText="DELETE"
  requiresPassword
  buttonLabel={t("settings.security.deleteAccountButton")}
  onConfirm={({ password }) => deleteMutation.mutate({ password: password! })}
  isPending={deleteMutation.isPending}
/>
```

**GeneralPage.tsx — Archive / Leave / Delete 3개**
```tsx
<DangerZone severity="subtle"
  title="Archive project" description="…"
  confirmText={undefined}
  buttonLabel="Archive"
  onConfirm={() => archiveMutation.mutate()}
/>
<DangerZone severity="subtle"
  title="Leave project" description="…"
  buttonLabel="Leave"
  onConfirm={() => leaveMutation.mutate()}
/>
<DangerZone
  title="Delete project" description="…"
  confirmText={projectName}  // 프로젝트 이름 입력
  buttonLabel="Delete project"
  onConfirm={() => deleteMutation.mutate()}
  isPending={deleteMutation.isPending}
/>
```

GeneralPage의 기존 Dialog 3개 + state 6개 (`archiveOpen`, `leaveOpen`, `deleteOpen`, ...)
삭제. confirm input은 inline으로 바뀌므로 Dialog wrapper 자체가 불필요.

> 만약 PM/디자이너가 "Dialog 형태가 필요하다"라고 하면 `<Dialog><DangerZone/></Dialog>`로
> 한 단계 wrap하는 형태로만 변경. DangerZone 자체는 layout-agnostic.

---

## PR 체크리스트

- [ ] Step 1 — Email read-only → 평문
- [ ] Step 2 — `window.confirm` 제거
- [ ] Step 3 — PRIORITY_CONFIG 중복 제거 + 색 토큰 통일 확인
- [ ] Step 4 — Sidebar 3개 cleanup (NavItem 통합 포함)
- [ ] Step 5 — Dashboard groupBy 토글 제거 + 마이그레이션
- [ ] Step 6 — PreferencesPage 즉시 저장 통일 (6-3 카드 그루핑은 옵션)
- [ ] Step 7 — `<DangerZone>` 추출 + 4개 사용처 교체
- [ ] `npm run typecheck` 클린
- [ ] `npm run lint` 클린
- [ ] 미사용 i18n 키 grep 후 제거 (`emailReadonlyHint`, `deleteFinalConfirm` 등)
- [ ] 미사용 i18n 키 추가 (`emailChangeHint` ko/en)
- [ ] 라이트/다크 모드 양쪽에서 `<DangerZone>` 시각 회귀 확인
- [ ] 프로젝트 archive → 복원 플로우 동작 확인 (Dialog→inline 전환 후)
- [ ] 계정 탈퇴 플로우 동작 확인 (비밀번호 + DELETE 입력 후 버튼 활성)

---

## PR 메시지 템플릿

```
chore(design): pass 3 — cleanup & duplication

PASS3.md의 7개 항목 cleanup. v4 audit의 Sprint 1 + DangerZone 추출.

- ProfilePage: email read-only input → 평문
- SecurityPage: account-delete window.confirm 제거
- IssueDetailPage: 하드코딩된 PRIORITY_CONFIG 제거 (constants 사용)
- Sidebar: phase 주석, allFavorited 빈 텍스트, AnnouncementsNavItem 통합
- WorkspaceDashboard: groupBy 토글 제거 (state별 고정)
- PreferencesPage: Locale 그룹 즉시 저장 통일, Save 버튼 제거
- New: <DangerZone> 컴포넌트 — Security + General의 dialog 4종 통합

i18n 키:
+ settings.profile.emailChangeHint (ko/en)
- settings.profile.emailReadonlyHint
- settings.security.deleteFinalConfirm

회귀 가능성: PreferencesPage 즉시 저장 패턴 변경, DangerZone 시각 변경.
검증: typecheck/lint 클린, 라이트/다크 모드 모두 확인, 4개 위험 액션 모두 동작 확인.
```

---

## 다음 패스 예고 (PASS4 예정, 머지 후)

- IssueDetailPage 1388줄 → `tabs/` 폴더 split
- `<RestorableListView>` 추출 (Archive + Trash)
- `<IssueMetaSidebar>` 추출 (Detail + Board + Table 재사용)
- localStorage 키 dot-notation 통일 (`orbitail.dashboard.filters` 등) + 마이그레이션
- Project Settings 7→4 탭 (Workflow + Automation 그루핑) — IA 변경, 별도 검토 필요
