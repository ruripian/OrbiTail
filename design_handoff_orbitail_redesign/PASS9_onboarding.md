# PASS9 — Onboarding / Empty State (Concrete)

> **전제**: PASS5~8 완료. 컴포넌트 추출, 테스트, 성능, 접근성이 모두 정리된 상태.
> **목표**: 첫 사용자 + 신규 워크스페이스 + 빈 상태에서 "다음에 뭘 해야 할지 모르겠다" 시그널 제거.
> **회귀 위험**: 낮음 (대부분 추가 — 기존 페이지 손대지 않음).

---

## Step 1 — Welcome Flow (신규 워크스페이스 직후)

### 트리거

워크스페이스 생성 직후, 또는 사용자가 워크스페이스에 처음 진입할 때 (`workspace.created_by === currentUser && !localStorage.orbitail.onboarding.{wsId}.welcome_done`).

### 작업

**신규 파일**: `frontend/src/components/onboarding/WelcomeFlow.tsx`

```tsx
type Step = {
  id: string;
  title: string;
  description: string;
  cta: { label: string; action: () => void };
  illustration?: React.ReactNode;   // OrbitGlyph variant 재사용
};

const STEPS: Step[] = [
  { id: "welcome", title: t("onboarding.welcome.title"), description: ..., cta: { label: t("...next"), action: next } },
  { id: "sample-project", title: ..., description: ..., cta: { label: t("...createSample"), action: createSampleProject } },
  { id: "first-issue", title: ..., description: ..., cta: { label: t("...createFirst"), action: openIssueDialog } },
  { id: "invite", title: ..., description: ..., cta: { label: t("...invite"), action: openInviteDialog } },
  { id: "done", title: ..., description: ..., cta: { label: t("...explore"), action: dismiss } },
];
```

내부 구조:
- 풀스크린 모달 (Radix Dialog, `closeOnEscape: false` for first 3 steps, true for 4-5)
- 좌측 — 진행 dot (0/5, 1/5...)
- 우측 — 현재 step 컨텐츠 + Skip 링크 (모든 step에서 노출, 단 한 번 확인 dialog)
- 완료 시 `localStorage.setItem('orbitail.onboarding.{wsId}.welcome_done', '1')` + 토스트 "Tip: Press `?` for keyboard shortcuts"

**샘플 프로젝트 시드 데이터** (`frontend/src/lib/sample-data.ts`):

```ts
export const SAMPLE_PROJECT = {
  name: "Sample Project",
  description: "A walkthrough project to learn OrbiTail",
  issues: [
    { title: "Welcome — try editing this", priority: "medium", labels: ["onboarding"] },
    { title: "Drag me to In Progress", priority: "high", state: "unstarted" },
    { title: "Add a comment", priority: "low" },
    { title: "Try keyboard shortcut `c`", priority: "none" },
    { title: "Set a due date", priority: "medium" },
  ],
  labels: [{ name: "onboarding", color: "blue" }, { name: "tip", color: "yellow" }],
  states: ["Backlog", "Unstarted", "In Progress", "Completed", "Cancelled"],
};
```

샘플 프로젝트는 백엔드에서 생성하지 말고 **프론트엔드가 일반 API 호출**로 만든다 — 즉 사용자가 일반 프로젝트로 인지하고 자유롭게 삭제/편집 가능.

### AppLayout 통합

```tsx
{showWelcome && <WelcomeFlow workspaceId={ws.id} onComplete={() => setShowWelcome(false)} />}
```

조건:
- `currentUser.id === workspace.created_by`
- `!localStorage.getItem('orbitail.onboarding.${ws.id}.welcome_done')`
- `workspace.created_at`이 30분 이내 (가입 직후 케이스 보호)

### i18n 키 (ko/en 양쪽)

```
onboarding.welcome.title
onboarding.welcome.description
onboarding.sampleProject.title
onboarding.sampleProject.description
onboarding.sampleProject.cta
onboarding.sampleProject.skip
onboarding.firstIssue.title
... (각 step 5개 × title/description/cta = 15개 키)
onboarding.skip.confirm
onboarding.skip.confirmDescription
onboarding.complete.toast
```

---

## Step 2 — Inline Coachmark (특정 액션 첫 실행 시)

### 작업

**신규 파일**: `frontend/src/components/onboarding/Coachmark.tsx`

```tsx
interface Props {
  id: string;                     // localStorage key
  anchor: HTMLElement | (() => HTMLElement | null);
  title: string;
  description: string;
  side?: "top" | "bottom" | "left" | "right";
  onDismiss?: () => void;
}

export function Coachmark({ id, ... }: Props) {
  const [dismissed, setDismissed] = useLocalState(`coachmark.${id}`, false);
  if (dismissed) return null;
  // Radix Popover로 anchor 옆에 표시 + arrow + "Got it" 버튼
}
```

### 적용 지점 (5개만 — 과하면 역효과)

| ID | Anchor | 트리거 |
|---|---|---|
| `first_issue_created` | TopBar의 "Create" 버튼 | 첫 이슈 생성 직후 → "Press `c` to create another" |
| `first_comment` | IssueDetailPage 댓글 input | 첫 댓글 작성 후 → "Tip: `@mention` to notify others" |
| `board_drag` | 보드 첫 카드 | BoardPage 진입 5초 후, 한 번만 → "Drag cards to change state" |
| `view_switcher` | View switcher 드롭다운 | IssueListPage 3회 방문 후 → "Try Timeline or Graph view" |
| `keyboard_help` | TopBar 우측 user menu | 가입 후 5분 + 어떤 단축키도 사용 안 했으면 → "Press `?` for shortcuts" |

각 coachmark는 dismiss 시 `localStorage.orbitail.coachmark.{id} = '1'` 영구 저장.

---

## Step 3 — Getting Started 위젯

### 위치

`WorkspaceDashboard.tsx` 우측 컬럼 (또는 sticky bottom card on mobile). 5/5 완료 시 자동 hide.

### 작업

**신규 파일**: `frontend/src/components/onboarding/GettingStarted.tsx`

```tsx
type Task = {
  id: string;
  label: string;
  done: boolean;
  hint?: string;
  action?: () => void;
};

const TASKS: Task[] = [
  { id: "create_project", label: t("..."), done: projects.length > 0 },
  { id: "create_issue", label: t("..."), done: issuesCount > 0 },
  { id: "invite_member", label: t("..."), done: members.length > 1 },
  { id: "first_comment", label: t("..."), done: hasCommented },
  { id: "use_shortcut", label: t("..."), done: localStorage.getItem("orbitail.shortcuts.used") === "1" },
];
```

UI:
- 진행률 바 (3/5 완료)
- 체크박스 + 라벨 + done 시 strikethrough
- 미완료 task 클릭 시 해당 액션 trigger (e.g. invite dialog 열기)
- 100% 완료 시 "🎉 You're all set" 메시지 5초 후 위젯 hide + `localStorage.orbitail.gettingStarted.dismissed = '1'`
- Dismiss 버튼 (X) — 명시적 dismiss도 영구 hide

### `use_shortcut` 트래킹

`lib/hotkeys.ts`에서 단축키 실행될 때마다:
```ts
localStorage.setItem("orbitail.shortcuts.used", "1");
```

---

## Step 4 — Empty State 톤 재점검

PASS2에서 EmptyState description+CTA 채웠음. 여기서 한 단계 더:

- 모든 EmptyState의 CTA가 **즉시 실행되는 액션**으로 (외부 링크 X, 내부 dialog 또는 라우팅)
- description은 2줄 이하 (translate ko/en 둘 다 점검)
- icon은 정적 SVG, 모션 금지 (브랜드 모먼트 화면 외에는)

**대상**:
- IssueListPage empty
- SprintsPage empty
- DocumentExplorerPage empty
- AnnouncementsPage empty
- NotificationDropdown empty
- ArchiveView empty (PASS5의 RestorableListView로 통합됨)
- TrashView empty (동일)

---

## 체크리스트

- [ ] WelcomeFlow 5단계 모달 (skip + dismiss + 진행 dot)
- [ ] 샘플 프로젝트 시드 (lib/sample-data.ts) — 일반 API로 생성
- [ ] AppLayout 트리거 조건 (created_by + !done + 30분 이내)
- [ ] Coachmark 5개 적용 (first_issue, first_comment, board_drag, view_switcher, keyboard_help)
- [ ] GettingStarted 위젯 (대시보드 우측, 5 tasks, 진행률, dismiss)
- [ ] use_shortcut 트래킹 (lib/hotkeys.ts)
- [ ] EmptyState 톤 재점검 (5+곳)
- [ ] i18n 키 ko/en 동시 등록 (~25개)
- [ ] 기존 사용자 영향 없음 — `localStorage` 이미 있는 워크스페이스는 onboarding 안 뜨는지

---

## 비목표

- ❌ 동영상 가이드 — 별도 트랙
- ❌ AI 챗봇 도우미 — 별도 트랙
- ❌ 가이드 투어 라이브러리 (`react-joyride`) — 자체 Coachmark로 충분

---

## 작업 시간 추정

3~4일.
