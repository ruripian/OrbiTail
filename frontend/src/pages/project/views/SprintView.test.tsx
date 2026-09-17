import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  sprints: vi.fn(),
  states: vi.fn(),
  events: vi.fn(),
  issues: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));
vi.mock("@/api/projects", () => ({
  projectsApi: {
    sprints: { list: mocks.sprints, create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    states: { list: mocks.states },
    events: { list: mocks.events },
  },
}));
vi.mock("@/api/issues", () => ({ issuesApi: { list: mocks.issues, update: vi.fn() } }));
vi.mock("@/hooks/useProjectPerms", () => ({
  useProjectPerms: () => ({ perms: { can_edit: true } }),
}));
/* i18n — t 가 키를 그대로 돌려주게 해서 문구 변경에 테스트가 흔들리지 않게 한다. */
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));


import { SprintView } from "./SprintView";

const STATES = [
  { id: "s-todo", name: "할 일", group: "unstarted", color: "#F0AD4E" },
  { id: "s-doing", name: "진행 중", group: "started", color: "#5E6AD2" },
  { id: "s-done", name: "완료", group: "completed", color: "#26B55E" },
];

/* 오늘을 기준으로 잡아야 "진행 중" 카드의 남은 일수 계산이 실제 화면과 같아진다 */
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const SPRINTS = [
  { id: "sp-active", name: "Sprint 12", status: "active", start_date: day(-7), end_date: day(3), description: "결제 모듈 안정화" },
  { id: "sp-draft", name: "Sprint 13", status: "draft", start_date: day(4), end_date: day(18), description: "" },
  { id: "sp-done", name: "Sprint 11", status: "completed", start_date: day(-21), end_date: day(-8), description: "" },
];

const issue = (id: string, title: string, state: string, sprint: string | null, pt?: number) => ({
  id, title, state, sprint, estimate_point: pt ?? null,
  parent: null, is_field: false, priority: "none", assignee_details: [],
});

const ISSUES = [
  issue("i1", "토큰 저장소 분리", "s-done", "sp-active", 3),
  issue("i2", "로그인 유지 체크박스", "s-doing", "sp-active", 5),
  issue("i3", "세션 만료 처리", "s-todo", "sp-active", 8),
  issue("i4", "다크모드 토글", "s-todo", null, 2),
  issue("i5", "CSV 내보내기", "s-todo", "sp-done", 5),
];

function renderView(entry = "/ws/p/issues?view=sprints") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <SprintView workspaceSlug="ws" projectId="p" onIssueClick={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SprintView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sprints.mockResolvedValue(SPRINTS);
    mocks.states.mockResolvedValue(STATES);
    mocks.events.mockResolvedValue([]);
    mocks.issues.mockResolvedValue(ISSUES);
  });

  it("목록 — 진행 중/예정/지난 세 구획으로 나눠 보여준다", async () => {
    renderView();
    expect(await screen.findByText("sprints.status.active")).toBeInTheDocument();
    expect(screen.getByText("sprints.status.draft")).toBeInTheDocument();
    expect(screen.getByText("sprints.past")).toBeInTheDocument();
    for (const name of ["Sprint 12", "Sprint 13", "Sprint 11"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("목록 — 진행 중 카드만 진척(완료/전체·%)을 펼쳐 보여준다", async () => {
    renderView();
    /* 완료 1건 / 전체 3건 = 33% — 예상 포인트와 무관하게 이슈 수로 센다 */
    expect(await screen.findByText(/issues\.countIssues.*33%/)).toBeInTheDocument();
    expect(screen.queryByText(/\dpt\b/)).not.toBeInTheDocument();
    /* 지난 스프린트는 완료율 한 칸만 */
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("목록 — 백로그에 남은 건수를 알려준다", async () => {
    renderView();
    expect(await screen.findByText('sprints.backlogWaiting:{"count":1}')).toBeInTheDocument();
  });

  it("스프린트를 누르면 상세로 들어가고 상태 그룹별로 이슈가 묶인다", async () => {
    renderView();
    await userEvent.click(await screen.findByText("Sprint 12"));

    /* 헤더 — 제목·목표·진척이 두 줄 안에 */
    expect(await screen.findByText("결제 모듈 안정화")).toBeInTheDocument();
    expect(screen.getByText("sprints.tabWork")).toBeInTheDocument();

    /* 작업 탭 — 그룹 헤더와 이슈 행 */
    expect(screen.getByText("issues.stateGroup.unstarted")).toBeInTheDocument();
    expect(screen.getAllByText('issues.countIssues:{"count":1}').length).toBeGreaterThan(0); // 그룹 헤더는 건수만
    expect(screen.queryByText(/\dpt\b/)).not.toBeInTheDocument();
    expect(screen.getByText("로그인 유지 체크박스")).toBeInTheDocument();
    /* 백로그 패널 — 이 스프린트에 없는 이슈 */
    expect(screen.getByText("다크모드 토글")).toBeInTheDocument();
  });

  it("스프린트 만들기 창에 설명을 적을 수 있다 — 입력 중 포커스가 튀지 않는다", async () => {
    renderView();
    await userEvent.click(await screen.findByRole("button", { name: /cycles.create|스프린트/ }));
    const desc = await screen.findByPlaceholderText("sprints.goalPlaceholder");
    await userEvent.type(desc, "결제 안정화");
    expect(desc).toHaveValue("결제 안정화");
  });

  it("이슈가 없는 스프린트도 상세가 열린다", async () => {
    mocks.issues.mockResolvedValue([]);
    renderView("/ws/p/issues?view=sprints&sprint=sp-draft");
    expect(await screen.findByText("sprints.emptySprint")).toBeInTheDocument();
  });
});
