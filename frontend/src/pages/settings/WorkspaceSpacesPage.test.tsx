import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), members: vi.fn() }));

vi.mock("@/api/documents", () => ({
  documentsApi: {
    adminSpaces: {
      list: mocks.list, update: mocks.update, remove: vi.fn(),
      members: { list: vi.fn(async () => []), add: vi.fn(), setRole: vi.fn(), remove: vi.fn() },
    },
  },
}));
vi.mock("@/api/workspaces", () => ({ workspacesApi: { members: mocks.members } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
/* i18n — t 가 키를 그대로 돌려주게 해서 문구 변경에 테스트가 흔들리지 않게 한다. */
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));


import { WorkspaceSpacesPage } from "./WorkspaceSpacesPage";
import { useAuthStore } from "@/stores/authStore";

const ME = { id: "u1", email: "me@x.test", display_name: "나" };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/ws/workspace-settings/spaces"]}>
        <Routes>
          <Route path="/:workspaceSlug/workspace-settings/spaces" element={<WorkspaceSpacesPage />} />
          <Route path="/:workspaceSlug/workspace-settings/archived" element={<p>archived-page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: ME as never });
  mocks.members.mockResolvedValue([{ id: "m1", member: ME, role: 20 }]);
  mocks.list.mockResolvedValue([{
    id: "s1", name: "인사 비밀", icon_prop: null, is_private: true, archived_at: null,
    document_count: 3, member_count: 2, admins: ["김관리"], i_am_member: false, created_at: "",
  }]);
  mocks.update.mockResolvedValue({});
});

describe("WorkspaceSpacesPage", () => {
  it("멤버가 아닌 비공개 스페이스도 목록에 보이고 공개로 바꿀 수 있다", async () => {
    renderPage();
    expect(await screen.findByText("인사 비밀")).toBeInTheDocument();
    expect(screen.getByText("workspaceSettings.projects.notMember")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "workspaceSettings.spaces.makePublic" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("ws", "s1", { is_private: false }));
  });

  it("관리자가 아니면 들어올 수 없다", async () => {
    mocks.members.mockResolvedValue([{ id: "m1", member: ME, role: 15 }]);
    renderPage();
    expect(await screen.findByText("archived-page")).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
