import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  membersList: vi.fn(),
  membersUpdate: vi.fn(),
  membersRemove: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

/* t 는 키를 그대로 돌려준다 — 문구가 바뀌어도 테스트가 흔들리지 않게 (DemoLandingPage.test 와 동일) */
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));
vi.mock("@/api/teams", () => ({
  teamsApi: {
    get: mocks.get,
    update: mocks.update,
    delete: mocks.remove,
    members: {
      list: mocks.membersList,
      update: mocks.membersUpdate,
      remove: mocks.membersRemove,
      add: vi.fn(),
    },
  },
}));
vi.mock("@/api/workspaces", () => ({ workspacesApi: { members: vi.fn(async () => []) } }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import { TeamGeneralPage } from "./TeamGeneralPage";
import { TeamMembersPage } from "./TeamMembersPage";
import { useAuthStore } from "@/stores/authStore";

const WS = "ws1";
const TEAM_ID = "t1";
const ADMIN_USER = { id: "u1", email: "admin@x.test", display_name: "관리자" };
const PLAIN_USER = { id: "u2", email: "member@x.test", display_name: "팀원" };

const team = (over = {}) => ({
  id: TEAM_ID,
  workspace: "w1",
  name: "Nimbus Studio",
  description: "디자인 시스템 팀",
  color: "",
  icon_prop: null,
  created_by: null,
  member_count: 2,
  my_role: 20,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  ...over,
});

const members = () => [
  { id: "m1", member: ADMIN_USER, role: 20, title: "PM", added_by: null, created_at: "" },
  { id: "m2", member: PLAIN_USER, role: 15, title: "", added_by: null, created_at: "" },
];

function renderPage(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${WS}/teams/${TEAM_ID}/settings`]}>
        <Routes>
          <Route path="/:workspaceSlug/teams/:teamId/settings" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(team());
  mocks.membersList.mockResolvedValue(members());
  mocks.update.mockImplementation(async (_w, _t, data) => team(data));
  mocks.membersUpdate.mockImplementation(async () => members()[1]);
  useAuthStore.setState({ user: ADMIN_USER as never });
});

describe("TeamGeneralPage", () => {
  it("팀 이름·설명을 서버 값으로 채우고 저장한다", async () => {
    renderPage(<TeamGeneralPage />);
    const name = await screen.findByDisplayValue("Nimbus Studio");
    expect(screen.getByDisplayValue("디자인 시스템 팀")).toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, "Orbit Labs");
    await userEvent.click(screen.getByRole("button", { name: "team.settings.general.save" }));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(WS, TEAM_ID, {
        name: "Orbit Labs",
        description: "디자인 시스템 팀",
        icon_prop: { type: "lucide", name: "Box", color: "#5E6AD2" },
      }),
    );
  });

  it("바꾼 게 없으면 저장 버튼이 잠겨 있다", async () => {
    renderPage(<TeamGeneralPage />);
    const save = await screen.findByRole("button", { name: "team.settings.general.save" });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByDisplayValue("Nimbus Studio"), "!");
    await waitFor(() => expect(save).toBeEnabled());
  });

  it("아이콘을 바꿔도 저장을 눌러야 서버에 반영된다", async () => {
    renderPage(<TeamGeneralPage />);
    const save = await screen.findByRole("button", { name: "team.settings.general.save" });
    expect(save).toBeDisabled();

    /* 피커 열고 색을 인디고(기본) → 그린으로 */
    await userEvent.click(screen.getByRole("button", { name: "iconPicker.selectIcon" }));
    await userEvent.click(await screen.findByRole("button", { name: "#26B55E" }));

    /* 로컬 상태만 바뀐다 — 저장 버튼은 열리지만 서버 호출은 아직 없다 */
    await waitFor(() => expect(save).toBeEnabled());
    expect(mocks.update).not.toHaveBeenCalled();

    await userEvent.click(save);
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(WS, TEAM_ID, {
        name: "Nimbus Studio",
        description: "디자인 시스템 팀",
        icon_prop: { type: "lucide", name: "Box", color: "#26B55E" },
      }),
    );
  });

  it("위험 구역은 팀 이름을 정확히 입력해야 삭제가 활성화된다", async () => {
    renderPage(<TeamGeneralPage />);
    const button = await screen.findByRole("button", { name: "team.settings.general.dangerButton" });
    expect(button).toBeDisabled();

    const confirm = screen.getByPlaceholderText("team.settings.general.dangerPlaceholder");
    await userEvent.type(confirm, "Nimbus");
    expect(button).toBeDisabled(); // 부분 일치로는 열리지 않는다

    await userEvent.type(confirm, " Studio");
    await waitFor(() => expect(button).toBeEnabled());

    await userEvent.click(button);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(WS, TEAM_ID));
  });

  it("멤버(비관리자)에게는 위험 구역과 저장 버튼을 감춘다", async () => {
    mocks.get.mockResolvedValue(team({ my_role: 15 }));
    renderPage(<TeamGeneralPage />);
    await screen.findByDisplayValue("Nimbus Studio");
    expect(
      screen.queryByRole("button", { name: "team.settings.general.dangerButton" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "team.settings.general.save" }),
    ).not.toBeInTheDocument();
  });
});

describe("TeamMembersPage", () => {
  it("멤버와 직책을 보여주고, 직책을 인라인으로 저장한다", async () => {
    renderPage(<TeamMembersPage />);
    expect(await screen.findByText("팀원")).toBeInTheDocument();
    expect(screen.getByText("PM")).toBeInTheDocument();

    /* 직책이 빈 멤버는 '직책 추가' placeholder 를 보여준다 */
    await userEvent.click(screen.getByText("team.settings.members.titleAdd"));
    const input = screen.getByPlaceholderText("team.settings.members.titlePlaceholder");
    await userEvent.type(input, "프론트엔드{Enter}");

    await waitFor(() =>
      expect(mocks.membersUpdate).toHaveBeenCalledWith(WS, TEAM_ID, "m2", { title: "프론트엔드" }),
    );
  });

  it("Escape 로 직책 편집을 취소하면 저장하지 않는다", async () => {
    renderPage(<TeamMembersPage />);
    await screen.findByText("팀원");

    await userEvent.click(screen.getByText("team.settings.members.titleAdd"));
    const input = screen.getByPlaceholderText("team.settings.members.titlePlaceholder");
    await userEvent.type(input, "취소될 값{Escape}");

    expect(mocks.membersUpdate).not.toHaveBeenCalled();
  });

  it("관리자에게만 역할 선택기가 뜨고, 본인 행에는 뜨지 않는다", async () => {
    renderPage(<TeamMembersPage />);
    await screen.findByText("팀원");

    /* 본인(관리자, m1) 행은 라벨만, 타인(m2) 행은 Select 트리거 */
    const rows = screen.getAllByRole("listitem");
    const selfRow = rows.find((r) => within(r).queryByText("관리자"))!;
    const otherRow = rows.find((r) => within(r).queryByText("팀원"))!;
    expect(within(selfRow).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(otherRow).getByRole("combobox")).toBeInTheDocument();
  });

  it("비관리자는 역할을 못 바꾸지만 본인 직책은 고칠 수 있다", async () => {
    mocks.get.mockResolvedValue(team({ my_role: 15 }));
    useAuthStore.setState({ user: PLAIN_USER as never });
    renderPage(<TeamMembersPage />);
    await screen.findByText("팀원");

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    /* 본인(m2) 행의 직책은 편집 가능 → placeholder 버튼이 살아 있다 */
    await userEvent.click(screen.getByText("team.settings.members.titleAdd"));
    expect(
      screen.getByPlaceholderText("team.settings.members.titlePlaceholder"),
    ).toBeInTheDocument();
  });
});
