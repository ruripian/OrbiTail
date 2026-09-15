import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  membersList: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));
vi.mock("@/api/teams", () => ({
  teamsApi: { get: mocks.get, members: { list: mocks.membersList } },
}));
/* 캘린더는 이 테스트의 관심사가 아니고 무거우므로 통째로 대체 */
vi.mock("./TeamCalendarSection", () => ({
  TeamCalendarSection: () => <div data-testid="calendar" />,
}));

import { TeamDetailPage } from "./TeamDetailPage";

const WS = "ws1";
const TEAM_ID = "t1";

const user = (id: string, name: string) => ({ id, email: `${id}@x.test`, display_name: name });

const MEMBERS = [
  { id: "m1", member: user("u1", "김루리"), role: 20, title: "프론트엔드", added_by: null, created_at: "" },
  { id: "m2", member: user("u2", "박하늘"), role: 15, title: "PM", added_by: null, created_at: "" },
  { id: "m3", member: user("u3", "이바다"), role: 15, title: "", added_by: null, created_at: "" },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${WS}/teams/${TEAM_ID}`]}>
        <Routes>
          <Route path="/:workspaceSlug/teams/:teamId" element={<TeamDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({
    id: TEAM_ID, workspace: "w1", name: "Nimbus Studio", description: "",
    color: "", icon_prop: null, created_by: null, member_count: 3, my_role: 20,
    created_at: "", updated_at: "",
  });
  mocks.membersList.mockResolvedValue(MEMBERS);
});

describe("TeamDetailPage — 멤버 스택", () => {
  it("멤버 스택을 열면 이름과 직책이 함께 나온다", async () => {
    renderPage();
    const trigger = await screen.findByRole("button", {
      name: /team\.memberCount/,
    });
    await userEvent.click(trigger);

    const list = await screen.findByRole("list");
    expect(within(list).getByText("김루리")).toBeInTheDocument();
    expect(within(list).getByText("프론트엔드")).toBeInTheDocument();
    expect(within(list).getByText("박하늘")).toBeInTheDocument();
    expect(within(list).getByText("PM")).toBeInTheDocument();
  });

  it("직책이 없는 멤버는 '직책 미지정' 으로 표시한다", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /team\.memberCount/ }));

    const list = await screen.findByRole("list");
    const row = within(list).getByText("이바다").closest("li")!;
    expect(within(row).getByText("team.home.noTitle")).toBeInTheDocument();
  });

  it("팝오버에서 멤버 관리로 넘어가는 링크를 준다", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /team\.memberCount/ }));

    const link = await screen.findByRole("link", { name: /team\.home\.manageMembers/ });
    expect(link).toHaveAttribute("href", `/${WS}/teams/${TEAM_ID}/settings/members`);
  });
});
