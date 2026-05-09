# PASS5 — 컴포넌트 추출 (Component Extraction)

> **목표**: 비대해진 페이지 컴포넌트를 작고 단일 책임을 가진 단위로 분리해 가독성 · 재사용성 · 테스트 가능성을 회복한다.
> **회귀 위험**: 낮음 (시각적 변경 없음, pure refactor). 단 IssueDetailPage 분할은 prop drilling이 많아 신중히.

---

## Context

PASS4까지 시각/IA/도메인 정합성 작업이 끝났다. 이제 **코드 구조 부채**를 정리한다. 현재 상태:

| 파일 | 라인 수 | 문제 |
|---|---|---|
| `IssueDetailPage.tsx` | **1381** | 6개 탭 body + 사이드바 + 2개 보조 컴포넌트가 한 파일에 섞여 있음 |
| `ArchiveView.tsx` | 235 | 행 컴포넌트 + 계층 트리 + 쿼리 + 액션이 한 파일에 묶여 있음 |
| `TrashView.tsx` | 156 | ArchiveView와 거의 같은 구조 — 중복 |

3가지 추출 작업으로 IssueDetailPage 1381줄 → **약 600줄**, ArchiveView/TrashView 391줄 → **약 250줄** (공유 base 포함)로 줄인다.

---

## Step 1 — `<RestorableListView>` (Archive/Trash 공유 base) — Sev: 3

### 현재

`ArchiveView.tsx`와 `TrashView.tsx`는 다음을 거의 똑같이 반복한다:

- list query + invalidate helpers
- restore mutation + (delete | purge) mutation
- 헤더 행 + 데이터 행 layout (border, padding, hover)
- empty state + loading state
- "복구 / 영구삭제" 버튼 페어

차이는 **3가지뿐**:
- 컬럼 구성 (Archive는 ID/title/priority/state/date, Trash는 title/priority/daysLeft)
- 행이 계층 트리인지 평면인지
- "영구삭제" 권한 체크 (Trash만 `perms.can_purge`)

### 작업

**신규 파일**: `frontend/src/components/views/RestorableListView.tsx`

```tsx
type Column<T> = {
  id: string;
  label: string;            // i18n 키가 아닌 이미 번역된 문자열
  width: string;            // tailwind class (예: "w-20", "flex-1")
  align?: "left" | "center" | "right";
  render: (row: T) => React.ReactNode;
};

type Action<T> = {
  id: string;
  label: string;
  icon: React.ReactNode;
  variant?: "outline" | "destructive";
  onClick: (row: T) => void;
  disabled?: (row: T) => boolean;
  visible?: (row: T) => boolean;   // perms 체크용
  confirmMessage?: string;
};

interface Props<T> {
  rows: T[];
  isLoading: boolean;
  rowKey: (row: T) => string;
  columns: Column<T>[];
  actions: Action<T>[];
  emptyState: { icon: React.ReactNode; title: string; description?: string };
  hint?: string;                   // 상단 안내 문구
  /** 계층 행 — Archive 전용. 없으면 평면 렌더 */
  hierarchy?: {
    childrenOf: (row: T) => T[];
    canExpand: (row: T) => boolean;
  };
  onRowClick?: (row: T) => void;
}

export function RestorableListView<T>({ ... }: Props<T>) { ... }
```

내부 구현:
- 헤더: `columns.map(c => <span className={cn(c.width, alignClass(c.align))}>{c.label}</span>)`
- actions 영역: `w-44` 고정, `actions.filter(a => a.visible?.(row) ?? true).map(...)`
- hierarchy가 있으면 expand chevron + depth 들여쓰기 자동
- empty/loading은 `<EmptyState>` + 기존 loading div 그대로

### `ArchiveView.tsx` 사용

```tsx
const columns: Column<Issue>[] = [
  { id: "id", label: t("issues.table.cols.id"), width: "w-16",
    render: i => <span className="text-2xs font-mono">{i.sequence_id}</span> },
  { id: "title", label: t("issues.table.cols.title"), width: "flex-1",
    render: i => <span className="text-sm truncate">{i.title}</span> },
  { id: "priority", label: t("issues.table.cols.priority"), width: "w-20", align: "center",
    render: i => <PriorityChip priority={i.priority} /> },
  { id: "state", label: t("issues.table.cols.state"), width: "w-20", align: "center",
    render: i => i.state_detail && <StateChip state={i.state_detail} /> },
  { id: "date", label: t("views.archive.archivedDate"), width: "w-24", align: "center",
    render: i => <span className="text-xs">{formatDate(i.archived_at)}</span> },
];

const actions: Action<Issue>[] = [
  { id: "restore", label: t("views.archive.restore"), icon: <RotateCcw />,
    variant: "outline", onClick: i => unarchiveMutation.mutate(i.id),
    disabled: () => unarchiveMutation.isPending },
  { id: "delete", label: t("views.archive.delete"), icon: <Trash2 />,
    variant: "destructive", onClick: i => deleteMutation.mutate(i.id),
    confirmMessage: t("issues.detail.deleteConfirm") },
];

return (
  <RestorableListView
    rows={topLevel}
    isLoading={isLoading}
    rowKey={i => i.id}
    columns={columns}
    actions={actions}
    hint={t("views.archive.description")}
    emptyState={{
      icon: <Archive className="h-10 w-10" />,
      title: t("views.archive.empty"),
      description: t("views.archive.emptyDescription"),
    }}
    hierarchy={{ childrenOf: i => childrenMap.get(i.id) ?? [], canExpand: i => (childrenMap.get(i.id)?.length ?? 0) > 0 }}
    onRowClick={i => onIssueClick?.(i.id)}
  />
);
```

### `TrashView.tsx` 사용

거의 같음. `actions[1].visible = () => perms.can_purge`, hierarchy 없음.

### 부가 작업

- `PriorityChip`, `StateChip` 도 따로 추출해서 `frontend/src/components/issues/chips/` 아래 둔다 (둘 다 ArchiveView 인라인 코드를 그대로 옮기면 됨).
- `ArchiveView.tsx`의 `ArchivedIssueRow`는 RestorableListView 내부 `<HierarchyRow>`로 흡수 — 별도 export 안 함.

### 검증

- 화면 비교: 라이트/다크 모드, 빈 상태, 1뎁스/2뎁스 계층, 액션 버튼 hover.
- `can_purge: false` 유저로 Trash 들어갔을 때 "영구삭제" 버튼이 숨는지.

---

## Step 2 — `<IssueMetaSidebar>` 추출 — Sev: 4

### 현재

`IssueDetailPage.tsx` **L853 ~ L1010** 약 160줄이 우측 사이드바다. 8개 picker (State / Priority / Assignee / Label / Category / Sprint / StartDate / DueDate) + Parent picker + meta info + LinkedDocumentsSection + Activity feed.

이 사이드바는 **이슈 상세 페이지 외에도** 향후 우측 패널 모드(slide-over)에서 재사용된다. 지금부터 분리해 두면 패널 모드 작업이 거의 공짜.

### 작업

**신규 파일**: `frontend/src/components/issues/IssueMetaSidebar.tsx`

```tsx
interface Props {
  issue: Issue;
  workspaceSlug: string;
  projectId: string;
  states: State[];
  members: Member[];
  labels: Label[];
  categories: Category[];
  sprints: Sprint[];
  projectIssues: Issue[];
  parentChain: Issue[];
  onUpdate: (patch: Partial<Issue>) => void;     // updateMutation.mutate를 wrap
  inPanel?: boolean;                              // pt-10 추가용
  readOnly?: boolean;                             // pointer-events-none
}

export function IssueMetaSidebar({ ... }: Props) {
  return (
    <div className="w-[26rem] shrink-0 border-l border-border overflow-y-auto bg-muted/5">
      <div className={cn("divide-y divide-border/60", inPanel && "pt-10", readOnly && "pointer-events-none opacity-70")}>
        <MetaSection.PriorityState ... />
        <MetaSection.AssigneeLabel ... />
        <MetaSection.CategorySprint ... />
        <MetaSection.Dates ... />
        <MetaSection.Parent ... />
        <MetaSection.Info ... />
        <LinkedDocumentsSection issueId={issue.id} workspaceSlug={...} projectId={...} />
        {/* Activity는 사이드바 밖 — 본문 탭으로 빼는 게 맞음, 이미 그렇게 되어 있음 */}
      </div>
    </div>
  );
}
```

내부 `MetaSection` 서브컴포넌트는 이미 IssueDetailPage에 있는 6개 grid 블록을 그대로 옮긴다 — 이름만 정리.

### IssueDetailPage 변경

```tsx
{/* 기존 L851 ~ L1010 통째로 교체 */}
<IssueMetaSidebar
  issue={issue}
  workspaceSlug={workspaceSlug!}
  projectId={projectId!}
  states={states}
  members={members}
  labels={labels}
  categories={categories}
  sprints={sprints}
  projectIssues={projectIssues}
  parentChain={parentChain}
  onUpdate={(patch) => updateMutation.mutate(patch)}
  inPanel={inPanel}
  readOnly={readOnly}
/>
```

### 검증

- 페이지 모드 / 패널 모드 둘 다 사이드바 동일하게 나오는지
- `readOnly={true}` 일 때 모든 picker 클릭 안 되는지
- TypeScript 타입 좁히기 — `issue.is_field`일 때 StatePicker만 dash로 빠지는 분기가 살아있어야 함

---

## Step 3 — IssueDetailPage 탭 body 분할 — Sev: 4

### 현재

`activeTab === "X" && (...)` 블록 6개가 IssueDetailPage 본문에 인라인이다. 각 블록 길이:

| 탭 | 라인 범위 | 길이 |
|---|---|---|
| sub-issues | L513 ~ L598 | 86줄 |
| links | L599 ~ L682 | 84줄 |
| nodes | L683 ~ L698 | 16줄 (이미 NodeLinksPane으로 위임됨) |
| attachments | L699 ~ L765 | 67줄 |
| comments | L766 ~ L821 | 56줄 |
| activity | L822 ~ L851 | 30줄 |

### 작업

**신규 디렉토리**: `frontend/src/pages/project/issue-detail/tabs/`

```
tabs/
  SubIssuesTab.tsx
  LinksTab.tsx
  AttachmentsTab.tsx
  CommentsTab.tsx
  ActivityTab.tsx
  index.ts             // re-export
```

각 탭 컴포넌트의 prop signature는 **딱 그 탭이 필요한 데이터만**. 예시:

```tsx
// SubIssuesTab.tsx
interface Props {
  issueId: string;
  workspaceSlug: string;
  projectId: string;
  subIssues: Issue[];
  states: State[];
  members: Member[];
  onSubIssueClick: (id: string) => void;
  readOnly?: boolean;
}

export function SubIssuesTab({ ... }: Props) {
  // 기존 L513 ~ L598 그대로 이동
  // useMutation 같은 hook도 같이 이동 (L350 ~ L362 createSubIssueMutation)
}
```

**원칙**:
- 각 탭은 **자기 mutation을 직접 소유**. IssueDetailPage에 있던 `createSubIssueMutation`, `addLinkMutation`, `uploadMutation`, `addCommentMutation` 등을 해당 탭으로 이동.
- query 데이터(subIssues, links, attachments...)는 IssueDetailPage가 카운트 표시용으로 여전히 필요하므로 IssueDetailPage가 fetch해서 prop으로 내려준다. **각 탭이 자기 query를 또 호출하면 안 됨** (중복 네트워크).
- `nodes` 탭은 이미 `<NodeLinksPane>` 위임이라 그대로 둠.

### IssueDetailPage 변경

```tsx
<div className="flex-1 ...">
  {/* 탭 nav는 그대로 */}
  {activeTab === "sub-issues" && <SubIssuesTab ... />}
  {activeTab === "links"      && <LinksTab ... />}
  {activeTab === "nodes"      && <NodeLinksPane ... />}
  {activeTab === "attachments" && <AttachmentsTab ... />}
  {activeTab === "comments"   && <CommentsTab ... />}
  {activeTab === "activity"   && <ActivityTab activities={activities} fmtDate={fmtDate} />}
</div>
```

### 검증

- 각 탭 진입 시 데이터 정상 표시
- 액션(추가/삭제/업로드/댓글 작성) 후 카운트 배지(`(N)`) 즉시 갱신되는지 — IssueDetailPage가 invalidateQueries 잘 받는지
- 파일 size formatter `formatFileSize`(L36)는 AttachmentsTab으로 같이 이동

### 결과

IssueDetailPage.tsx **1381줄 → 약 600줄** 예상.
- 본문: 헤더 + 제목/설명 + 탭 nav + 탭 라우팅 (~150줄)
- 사이드바: `<IssueMetaSidebar />` 호출 한 줄
- 보조: `formatFileSize` (이동), `LinkedDocumentsSection`/`NodeLinksPane` (이동, 별도 파일로)

---

## Step 4 — localStorage 키 namespace 정리 — Sev: 2

### 현재

```
orbitail_graph_showIds, orbitail_graph_labelSize, orbitail_graph_animating,
orbitail_graph_layout, orbitail_graph_repulsion, orbitail_graph_orbitSpeed,
orbitail_graph_linkType, orbitail_graph_cohesion (legacy),
orbitail_timeline_col_widths
```

GraphView 안에 **8개 useState + 8개 useEffect**가 같은 패턴(try/catch, JSON parse, setItem)을 반복.

### 작업

**신규 파일**: `frontend/src/hooks/useLocalState.ts`

```ts
export function useLocalState<T>(key: string, initial: T, parse?: (raw: string) => T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`orbitail.${key}`);
      if (raw == null) return initial;
      return parse ? parse(raw) : (JSON.parse(raw) as T);
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(`orbitail.${key}`, typeof value === "string" ? value : JSON.stringify(value)); }
    catch { /* quota exceeded */ }
  }, [key, value]);
  return [value, setValue];
}
```

키 prefix를 `orbitail_` (snake) → `orbitail.` (dot)로 통일. **마이그레이션 필요**:

```ts
// frontend/src/lib/migrations.ts (신규)
const LEGACY_KEYS: Record<string, string> = {
  orbitail_graph_showIds:    "orbitail.graph.showIds",
  orbitail_graph_labelSize:  "orbitail.graph.labelSize",
  orbitail_graph_animating:  "orbitail.graph.animating",
  orbitail_graph_layout:     "orbitail.graph.layout",
  orbitail_graph_repulsion:  "orbitail.graph.repulsion",
  orbitail_graph_orbitSpeed: "orbitail.graph.orbitSpeed",
  orbitail_graph_linkType:   "orbitail.graph.linkType",
  orbitail_timeline_col_widths: "orbitail.timeline.colWidths",
};

export function runLocalStorageMigrations() {
  if (localStorage.getItem("orbitail.migrations.v1")) return;
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEYS)) {
    const v = localStorage.getItem(oldKey);
    if (v != null && localStorage.getItem(newKey) == null) {
      localStorage.setItem(newKey, v);
    }
    localStorage.removeItem(oldKey);
  }
  // legacy cohesion → repulsion 변환은 GraphView가 이미 처리, 여기선 키만 정리
  localStorage.removeItem("orbitail_graph_cohesion");
  localStorage.setItem("orbitail.migrations.v1", "1");
}
```

`main.tsx`에서 React render 직전에 호출.

### 검증

- 기존 사용자 설정 유지되는지 (브라우저 devtools에서 old key 입력 후 마이그레이션 실행 → new key로 옮겨지는지)
- 두 번 실행해도 idempotent (`orbitail.migrations.v1` flag)
- GraphView 8개 state가 모두 `useLocalState` 사용으로 깔끔해지는지

---

## 작업 순서 & PR 분할

**한 PR로 묶지 말 것** — 회귀 테스트 부담이 너무 커진다.

| PR | 내용 | 회귀 위험 |
|---|---|---|
| PASS5-A | Step 4 (localStorage) | 매우 낮음 |
| PASS5-B | Step 1 (RestorableListView) | 낮음 |
| PASS5-C | Step 2 (IssueMetaSidebar) | 중간 (패널 모드 회귀 주의) |
| PASS5-D | Step 3 (IssueDetailPage 탭 분할) | 중간 (mutation 이전 누락 주의) |

각 PR은 typecheck + 화면 회귀 확인 후 머지.

---

## PR 체크리스트 (PR마다 복붙)

```
- [ ] typecheck 통과
- [ ] lint 통과 (warning 증가 없음)
- [ ] 시각 회귀 없음 (라이트/다크 둘 다 확인)
- [ ] 새 의존성 추가 없음
- [ ] 기존 동작 보존:
      - 액션 → 토스트 → invalidate → UI 갱신 흐름
      - 권한 분기 (can_purge 등)
      - readOnly / inPanel 모드
- [ ] i18n 키 변경 없음 (이번 PASS는 순수 리팩토링)
```

---

## 비목표

이번 PASS에서 **하지 않는 것**:

- ❌ 새 기능
- ❌ 시각 변경 (간격/색/타이포 손대지 않음)
- ❌ API 시그니처 변경
- ❌ 테스트 추가 (별도 PASS로 — 추출 후 단위 테스트 작성이 훨씬 쉬워짐)

PASS5 머지 후 PASS6에서 "추출된 컴포넌트에 대한 단위 테스트 + Storybook 추가"로 자연스럽게 이어진다.
