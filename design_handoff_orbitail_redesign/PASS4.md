# OrbiTail Design Pass 4 — IA Restructure

이 문서는 `OrbiTail Design Audit v4 - Duplication.html`의 **Sprint 4 (IA 재배치)** 항목들을
한 PR(또는 2개 PR)로 묶어 처리하기 위한 구현 가이드다.

PASS3까지 머지된 상태 가정. 이 PASS는 **라우팅·라벨·탭 구조를 바꾼다.**
시각 cleanup이 아니라 **정보 구조 자체를 옮기는 작업**이라 회귀 테스트가 가장 중요하다.

> 이 PR은 외부 링크/북마크에 영향이 큼 → 모든 구 경로에 redirect 필수.
> i18n 키 변경이 많음 → ko/en 양쪽 동시 작업.

---

## ✓ 사전 결정 (resolved)

1. **GraphView** — KEEP. 의존성/연결 시각화 실사용 view. 이 PR에서 손대지 않음.
2. **Templates 이동 형태** — (b) **이슈 생성 모달 contextual 관리**로. Settings에서 Templates 탭 완전 제거. Workflow 탭에는 States + Labels 2개 섹션만.
   → 작업량 더 들지만 한 번에 끝내는 게 맞다는 PM 판단.

(`PASS4 Decisions.html` 참고)

---

## 작업 순서

회귀 위험 낮은 순으로:
**Step 1 → 2** (라벨만 바꿈, 라우팅 안 건드림)
**Step 3 → 4 → 5** (라우팅 변경, redirect 필수)
**Step 6** (선택, 검토 후)

각 step 후 `npm run typecheck && npm run lint`. Step 3·4·5 후 수동 회귀 1회.

---

## 1. "Notifications" 라벨 분리 — User vs Project (1h)

가장 작고 가장 큰 인지 부조화 해소. 라우팅 안 바꾸고 라벨·아이콘만 변경.

### 1-1. Project Settings 탭 라벨 변경

**파일:** `frontend/src/pages/project/settings/ProjectSettingsLayout.tsx` (L13)

```diff
- { to: "notifications", tKey: "project.settings.tabs.notifications", icon: Bell },
+ { to: "integrations", tKey: "project.settings.tabs.integrations", icon: Webhook },
```

> 경로(`to`)도 `notifications` → `integrations`로 변경 시 redirect 필요.
> 이 PR에서는 **경로는 유지, 라벨만 변경** (redirect 부담 줄이기).
> 경로 변경은 Step 5와 같이 처리.

**임시 절충 (이 step):** 경로는 `notifications` 유지, **i18n 라벨만** `integrations`로.
- `project.settings.tabs.notifications` → 키 그대로, 값만 변경
  - ko: `"통합"` / en: `"Integrations"`
- 아이콘: `Bell` → `Webhook` (lucide-react)

### 1-2. NotificationsPage 내부 카피 변경

**파일:** `frontend/src/pages/project/settings/NotificationsPage.tsx`

페이지 제목·설명 카피 변경:
- 제목: "Integrations & webhooks"
- 설명: "이 프로젝트의 변경 사항을 외부로 발신합니다 (Slack, webhook, email)."

→ "내가 받는 알림은 사용자 설정에서 관리하세요" 인라인 안내 + 링크 (User Preferences로).

i18n 키:
```
project.settings.integrations.title    = "Integrations"
project.settings.integrations.subtitle = "Send updates from this project to external destinations."
project.settings.integrations.userHint = "Manage notifications you receive in {link}user preferences{/link}."
```

기존 `project.settings.notifications.*` 키는 미사용으로 처리 후 제거.

---

## 2. Sprint + Analytics → Reports (1d)

두 view tab을 합쳐 한 페이지에 두 탭으로.

### 2-1. 새 view 만들기

**신설:** `frontend/src/pages/project/views/ReportsView.tsx`

```tsx
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SprintReport } from "./reports/SprintReport";   // 기존 SprintView 내용 이동
import { AnalyticsReport } from "./reports/AnalyticsReport"; // 기존 AnalyticsView 내용 이동

interface Props {
  workspaceSlug: string;
  projectId: string;
}

export function ReportsView({ workspaceSlug, projectId }: Props) {
  const [tab, setTab] = useState<"current" | "history">("current");

  return (
    <div className="flex flex-col h-full">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="px-6 pt-4">
        <TabsList>
          <TabsTrigger value="current">Current sprint</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="mt-4 flex-1">
          <SprintReport workspaceSlug={workspaceSlug} projectId={projectId} />
        </TabsContent>
        <TabsContent value="history" className="mt-4 flex-1">
          <AnalyticsReport workspaceSlug={workspaceSlug} projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

기존 `views/SprintView.tsx` → `views/reports/SprintReport.tsx` 이동 (이름 + import path만).
기존 `views/AnalyticsView.tsx` → `views/reports/AnalyticsReport.tsx` 이동.

### 2-2. ProjectIssuePage 탭 정리

**파일:** `frontend/src/pages/project/ProjectIssuePage.tsx`

```diff
-type ViewId = "table" | "board" | "backlog" | "calendar" | "timeline" | "graph" | "sprints" | "analytics" | "archive" | "trash";
+type ViewId = "table" | "board" | "backlog" | "calendar" | "timeline" | "graph" | "reports" | "archive" | "trash";

 const VIEWS = [
   { id: "table",     ... },
   { id: "board",     ... },
   { id: "backlog",   ... },
   { id: "calendar",  ... },
   { id: "timeline",  ... },
   { id: "graph",     ... },           // ⚠️ 사전 결정에 따라 제거 가능
-  { id: "sprints",    key: "views.tabs.cycles",     Icon: Zap   },
-  { id: "analytics", key: "views.tabs.analytics",  Icon: BarChart3 },
+  { id: "reports",   key: "views.tabs.reports",    Icon: BarChart3 },
   { id: "archive",   ... },           // ⚠️ Step 4에서 sidebar로 이동
 ];
```

```diff
-{currentView === "sprints" && <SprintView ... />}
-{currentView === "analytics" && <AnalyticsView ... />}
+{currentView === "reports" && (
+  <ReportsView workspaceSlug={workspaceSlug!} projectId={projectId!} />
+)}
```

### 2-3. URL redirect

기존 `?view=sprints`, `?view=analytics` 진입 사용자를 위한 마이그레이션.
ProjectIssuePage에서 `currentView` 결정 직후:

```tsx
useEffect(() => {
  const v = searchParams.get("view");
  if (v === "sprints" || v === "analytics") {
    setSearchParams({ view: "reports" }, { replace: true });
  }
}, [searchParams]);
```

i18n:
```
views.tabs.reports = "Reports"
```
기존 `views.tabs.cycles`, `views.tabs.analytics`는 유지(다른 곳에서 쓸 수 있음, grep 후 미사용이면 삭제).

---

## 3. Project Settings 7→4 탭 (1.5d)

### 3-1. 통합 후 구조

```
Project Settings
├── ⚙ General         (그대로)
├── 👥 Members         (그대로)
├── ⚡ Workflow         (NEW — states + labels 2 섹션)
└── 🤖 Automation      (NEW — auto-archive + integrations 2 섹션)

# Templates는 이슈 생성 모달 안의 contextual 관리로 이동 (Step 3-bis)
```

### 3-2. WorkflowPage 신설

**신설:** `frontend/src/pages/project/settings/WorkflowPage.tsx`

```tsx
import { StatesSection } from "./sections/StatesSection";    // 기존 StatesPage 내용 이동
import { LabelsSection } from "./sections/LabelsSection";    // 기존 LabelsPage 내용 이동

export function WorkflowPage() {
  return (
    <div className="max-w-4xl space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Workflow</h1>
        <p className="text-sm text-muted-foreground mt-1">
          이슈를 분류하는 도구 — 상태, 라벨
        </p>
      </header>

      <section id="states">
        <h2 className="text-base font-semibold mb-3">States</h2>
        <StatesSection />
      </section>

      <hr />

      <section id="labels">
        <h2 className="text-base font-semibold mb-3">Labels</h2>
        <LabelsSection />
      </section>
    </div>
  );
}
```

기존 page 파일들을 component로 변환:
- `StatesPage.tsx` → `sections/StatesSection.tsx` (페이지 헤더만 제거, 핵심 UI 유지)
- `LabelsPage.tsx` → `sections/LabelsSection.tsx`

deep-link 위해 `#states`, `#labels` 앵커 사용.

> **Templates는 여기 안 들어옴.** Step 3-bis에서 이슈 생성 모달로 이동.

### 3-3. AutomationPage 신설

**신설:** `frontend/src/pages/project/settings/AutomationPage.tsx`

```tsx
import { AutoArchiveSection }   from "./sections/AutoArchiveSection";   // 기존 AutoArchivePage
import { IntegrationsSection }  from "./sections/IntegrationsSection";  // 기존 NotificationsPage

export function AutomationPage() {
  return (
    <div className="max-w-4xl space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Automation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          정책 — 자동 아카이브, 외부 통합
        </p>
      </header>

      <section id="auto-archive">
        <h2 className="text-base font-semibold mb-3">Auto-archive</h2>
        <AutoArchiveSection />
      </section>

      <hr />

      <section id="integrations">
        <h2 className="text-base font-semibold mb-3">Integrations</h2>
        <IntegrationsSection />
      </section>
    </div>
  );
}
```

### 3-4. ProjectSettingsLayout 탭 정리

**파일:** `frontend/src/pages/project/settings/ProjectSettingsLayout.tsx`

```tsx
import { Settings, Users, Zap, Cpu } from "lucide-react";

const TABS = [
  { to: "general",    tKey: "project.settings.tabs.general",    icon: Settings },
  { to: "members",    tKey: "project.settings.tabs.members",    icon: Users },
  { to: "workflow",   tKey: "project.settings.tabs.workflow",   icon: Zap },
  { to: "automation", tKey: "project.settings.tabs.automation", icon: Cpu },
];
```

i18n 추가:
```
project.settings.tabs.workflow   = "Workflow"
project.settings.tabs.automation = "Automation"
```

기존 `tabs.states`, `tabs.labels`, `tabs.templates`, `tabs.autoArchive`, `tabs.notifications`(=integrations로 변경됨) → 미사용이면 제거 (단, deep-link 안내용 텍스트로 i18n 일부 활용 가능).

### 3-5. 라우팅 + Redirect

**파일:** `frontend/src/router/index.tsx`

```diff
 path: "projects/:projectId/settings",
 element: <ProjectSettingsLayout />,
 children: [
   { index: true, element: <Navigate to="general" replace /> },
   { path: "general",       element: <GeneralPage /> },
   { path: "members",       element: <MembersPage /> },
-  { path: "states",        element: <StatesPage /> },
-  { path: "labels",        element: <LabelsPage /> },
-  { path: "templates",     element: <TemplatesPage /> },
-  { path: "auto-archive",  element: <AutoArchivePage /> },
-  { path: "notifications", element: <ProjectNotificationsPage /> },
+  { path: "workflow",      element: <WorkflowPage /> },
+  { path: "automation",    element: <AutomationPage /> },
+  /* legacy redirects — 외부 링크/북마크 보존 */
+  { path: "states",        element: <Navigate to="../workflow#states" replace /> },
+  { path: "labels",        element: <Navigate to="../workflow#labels" replace /> },
+  { path: "templates",     element: <Navigate to="../general" replace /> },
+  // ↑ Templates는 이슈 생성 모달로 이동 → settings에선 안내만. General 페이지에 Templates 안내 배너 추가.
+  { path: "auto-archive",  element: <Navigate to="../automation#auto-archive" replace /> },
+  { path: "notifications", element: <Navigate to="../automation#integrations"  replace /> },
 ],
```

→ legacy 5개 경로는 redirect로 보존. 6개월 후 다음 PASS에서 완전 제거.

---

## 3-bis. Templates → 이슈 생성 모달 contextual 관리 (2d)

**핵심:** Settings에서 Templates 페이지 완전 제거. 이슈 생성 모달 안에서 사용 + 관리.

### 3-bis-1. 이슈 생성 모달에 Template picker 추가

**파일:** `frontend/src/components/issues/IssueCreateDialog.tsx` (또는 동등 파일)

모달 상단(또는 title 입력 옆)에 Template 드롭다운:

```tsx
import { TemplatePicker } from "./TemplatePicker"; // 신설

<TemplatePicker
  workspaceSlug={workspaceSlug}
  projectId={projectId}
  onApply={(template) => {
    // template.title, template.description, template.priority, template.labels 등을 form에 주입
    setValue("title", template.title);
    setValue("description", template.description);
    // ...
  }}
/>
```

### 3-bis-2. TemplatePicker 컴포넌트 신설

**신설:** `frontend/src/components/issues/TemplatePicker.tsx`

```tsx
interface Props {
  workspaceSlug: string;
  projectId: string;
  onApply: (template: IssueTemplate) => void;
}

export function TemplatePicker({ workspaceSlug, projectId, onApply }: Props) {
  const { data: templates = [] } = useQuery({
    queryKey: ["templates", workspaceSlug, projectId],
    queryFn: () => projectsApi.templates.list(workspaceSlug, projectId),
  });
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <FileText className="h-4 w-4 mr-1.5" />
            Use template
            <ChevronDown className="h-3 w-3 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72">
          {templates.length === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              저장된 템플릿이 없습니다
            </div>
          ) : (
            templates.map((tpl) => (
              <DropdownMenuItem key={tpl.id} onSelect={() => onApply(tpl)}>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-sm">{tpl.name}</span>
                  <span className="text-xs text-muted-foreground line-clamp-1">{tpl.title}</span>
                </div>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setManageOpen(true)}>
            <Settings2 className="h-3.5 w-3.5 mr-2" />
            템플릿 관리
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => /* 현재 form 값으로 새 템플릿 저장 */}>
            <Plus className="h-3.5 w-3.5 mr-2" />
            현재 입력으로 템플릿 저장
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {manageOpen && (
        <TemplateManageDialog
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          onClose={() => setManageOpen(false)}
        />
      )}
    </>
  );
}
```

### 3-bis-3. TemplateManageDialog 신설

**신설:** `frontend/src/components/issues/TemplateManageDialog.tsx`

기존 `TemplatesPage.tsx`의 핵심 UI(목록·생성·편집·삭제)를 그대로 Dialog 안으로 이동.
페이지 헤더만 Dialog header("템플릿 관리")로 변경.

### 3-bis-4. TemplatesPage 제거

- `frontend/src/pages/project/settings/TemplatesPage.tsx` 삭제
- 라우팅에서 `templates` path 제거 (위 3-5의 redirect는 유지 — `../general`로 보냄)
- 사용처 검색: `grep -r "TemplatesPage"` 후 import 정리

### 3-bis-5. 안내 배너 (선택)

기존 사용자가 `/settings/templates`로 진입 시 General 페이지로 redirect되는데,
어디로 갔는지 모를 수 있음. General 페이지 상단(또는 toast)에 1회 안내:

```tsx
{/* legacy 진입 감지 — search param 또는 referrer로 */}
<Banner variant="info" dismissible>
  📄 템플릿 관리는 이제 <strong>이슈 생성 모달</strong>로 이동했습니다.
  새 이슈를 만들 때 "Use template" 버튼에서 관리할 수 있어요.
</Banner>
```

localStorage 키 `orbitail.templates.movedHintSeen=true`로 1회만 노출.

### 3-bis-6. i18n

```
issue.create.useTemplate         = "Use template"
issue.create.template.empty      = "저장된 템플릿이 없습니다"
issue.create.template.manage     = "템플릿 관리"
issue.create.template.saveCurrent = "현재 입력으로 템플릿 저장"
issue.template.movedHint         = "템플릿 관리는 이슈 생성 모달로 이동했습니다."
```

기존 `project.settings.templates.*` 키들 → 일부는 새 dialog에서 재사용. grep 후 미사용분만 제거.

---

## 4. Archive/Trash → Sidebar로 이동 (1d)

### 4-1. ProjectIssuePage view 탭에서 제거

```diff
-{ id: "archive", key: "views.tabs.archive", Icon: Archive },
+// archive/trash는 sidebar nav로 이동 (PASS4)
```

ViewId 타입에서도 `archive | trash` 제거. 대신 `?view=archive` 진입은 redirect:

```tsx
useEffect(() => {
  const v = searchParams.get("view");
  if (v === "archive") {
    navigate(`/${workspaceSlug}/projects/${projectId}/archive`, { replace: true });
  } else if (v === "trash") {
    navigate(`/${workspaceSlug}/projects/${projectId}/trash`, { replace: true });
  }
}, [searchParams]);
```

### 4-2. 새 라우트 + 페이지

**신설:** `frontend/src/pages/project/ProjectArchivePage.tsx`
**신설:** `frontend/src/pages/project/ProjectTrashPage.tsx`

기존 `views/ArchiveView.tsx`, `views/TrashView.tsx`의 내용을 그대로 옮기되,
ProjectIssuePage의 layout(헤더 등) 없이 **standalone 페이지**로.

> v3 audit에서 PASS5로 다룰 `<RestorableListView>` 추출은 이 PR에서 안 함.
> 이 PR에서는 **위치만 옮기고**, 추출은 다음 PR에서.

**파일:** `frontend/src/router/index.tsx`

```diff
 { path: "projects/:projectId/sprints", element: <SprintsPage /> },
+{ path: "projects/:projectId/archive", element: <ProjectArchivePage /> },
+{ path: "projects/:projectId/trash",   element: <ProjectTrashPage /> },
```

### 4-3. Sidebar에 진입점 추가

**파일:** `frontend/src/components/layout/Sidebar.tsx`

프로젝트가 펼쳐졌을 때(`expanded === true`) 자식 nav에 2개 추가:

```tsx
{expanded && (
  <div className="ml-6 mt-1 space-y-0.5">
    {/* 기존 카테고리 nav */}
    {project.categories.map(...)}

    {/* NEW — 프로젝트 admin entry */}
    <div className="my-1 border-t border-border/50" />
    <NavItem
      to={`/${workspaceSlug}/projects/${project.id}/archive`}
      icon={<Archive className="h-3.5 w-3.5" />}
      label={t("project.nav.archive")}
      compact
    />
    <NavItem
      to={`/${workspaceSlug}/projects/${project.id}/trash`}
      icon={<Trash2 className="h-3.5 w-3.5" />}
      label={t("project.nav.trash")}
      compact
    />
  </div>
)}
```

i18n:
```
project.nav.archive = "Archive"
project.nav.trash   = "Trash"
```

> 시각 분리: 카테고리 list와 admin entry 사이에 1px divider.
> compact prop은 NavItem에 작은 폰트/패딩 variant 추가 (없으면 className으로 처리).

---

## 5. Project "notifications" 경로 → "integrations" 변경 (선택, 30min)

Step 1에서 라벨만 바꿨으면, 이제 경로도 일치시킨다.
이미 Step 3-5에서 `notifications` → `automation#integrations` redirect로 처리되었으면
**이 step은 skip 가능**.

---

## 6. Dashboard "최근 이슈" → activity panel (1d)

> ⚠️ **이 step은 디자인 검토 필요.** activity panel을 어디서 어떻게 띄울지 PM과 합의 필요.
> 합의 안 됐으면 이 PR에서 빼고 별도 PR로.

대시보드 우측 또는 헤더의 종 아이콘 클릭 시 펼쳐지는 패널로 이동.
v4 audit에 구체 디자인 없음 → PM 합의 후 별도 spec 필요.

**이 PR에서 권장:** skip. 다음 audit에서 다룸.

---

## PR 체크리스트

### Required
- [ ] Step 1 — Notifications 라벨 분리 (User=수신, Project=Integrations)
- [ ] Step 2 — Sprint + Analytics → Reports (URL redirect 포함)
- [ ] Step 3 — Project Settings 7→4 탭 (legacy 5개 경로 redirect 포함)
- [ ] **Step 3-bis — Templates → 이슈 생성 모달 contextual 관리**
- [ ] Step 4 — Archive/Trash → Sidebar (sidebar nav 추가, redirect 포함)
- [ ] Step 5 (선택) — notifications 경로 → integrations
- [ ] `npm run typecheck` 클린
- [ ] `npm run lint` 클린

### Optional
- [ ] Step 6 — 대시보드 최근 이슈 → activity panel (PM 합의 후)
- [ ] GraphView 제거 (사전 결정에 따라)

### 회귀 확인
- [ ] **외부 링크 보존**: 이전 5개 settings 경로 모두 새 위치로 redirect (templates는 General로)
- [ ] **외부 링크 보존**: `?view=sprints`, `?view=analytics`, `?view=archive`, `?view=trash` 모두 redirect
- [ ] 라이트/다크 모드에서 새 탭 시각 확인 (Workflow, Automation, Reports)
- [ ] Sidebar에서 프로젝트 펼침 → Archive/Trash 진입 → 이슈 복원 동작
- [ ] `#states`, `#labels` 앵커로 직접 점프 확인 (templates 앵커 없음)
- [ ] Sprint history (이전 Analytics) → Reports History 탭에서 동일 데이터 확인
- [ ] **이슈 생성 모달**: Template picker 동작 — 적용/생성/관리(편집·삭제) 모두
- [ ] **템플릿 이전 데이터** 모두 새 picker에서 보이는지 확인

### i18n
- [ ] 추가: `project.settings.tabs.workflow`, `tabs.automation`
- [ ] 추가: `views.tabs.reports`
- [ ] 추가: `project.nav.archive`, `project.nav.trash`
- [ ] 추가: `project.settings.integrations.*`
- [ ] 변경: `project.settings.tabs.notifications` → 라벨만 "Integrations"
- [ ] 미사용 검토: `tabs.states`, `tabs.labels`, `tabs.templates`, `tabs.autoArchive`, `views.tabs.cycles`, `views.tabs.analytics`, `views.tabs.archive`

---

## PR 메시지 템플릿

```
feat(ia): pass 4 — settings, views, sidebar 재배치

PASS4.md의 IA 변경. v4 audit Sprint 4.

Project Settings: 7 탭 → 4 탭
  - states + labels + templates → Workflow
  - auto-archive + notifications → Automation
  - "notifications" 라벨 → "Integrations" (책임 분리, user vs project)

Project Views: 10 → 7
  - sprints + analytics → Reports (한 페이지, 두 탭)
  - archive + trash → sidebar nav (프로젝트 펼침 안의 admin entry)

외부 링크 보존:
  - 5개 legacy settings 경로 → 새 위치로 redirect
  - ?view=sprints/analytics/archive/trash → 새 경로로 redirect

회귀 확인: 라이트/다크 양쪽, 외부 링크 5종, sidebar nav 동작.
```

---

## PASS5 예고 (PASS4 머지 후)

PASS4가 IA를 옮긴 다음, PASS5에서 컴포넌트 추출:
- `<RestorableListView>` 추출 — Archive + Trash 내부 통합
- `<IssueMetaSidebar>` 추출 — Detail + Board + Table 재사용
- IssueDetailPage 1388줄 → `tabs/` 폴더로 split
- localStorage 키 dot-notation 통일 (`orbitail.dashboard.filters` 등) + 마이그레이션
- 6개월 후: PASS4의 legacy redirects 완전 제거
