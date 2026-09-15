import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  members: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

/* t 는 키를 그대로 돌려준다 — 문구가 바뀌어도 테스트가 흔들리지 않게 */
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));
vi.mock("@/api/apiTokens", () => ({
  apiTokensApi: { list: mocks.list, create: mocks.create, revoke: mocks.revoke },
}));
vi.mock("@/api/workspaces", () => ({ workspacesApi: { members: mocks.members } }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import { WorkspaceApiTokensPage } from "./WorkspaceApiTokensPage";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";

const WS = "ws1";
const ME = { id: "u1", email: "me@x.test", display_name: "나" };

const token = (over = {}) => ({
  id: "t1",
  name: "CI",
  prefix: "orbt_AbCdEf",
  scope: "read",
  expires_at: "2026-12-01T00:00:00Z",
  last_used_at: null,
  created_at: "2026-09-01T00:00:00Z",
  revoked_at: null,
  owner: { id: ME.id, display_name: ME.display_name, email: ME.email },
  status: "active",
  ...over,
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${WS}/workspace-settings/api-tokens`]}>
        <Routes>
          <Route path="/:workspaceSlug/workspace-settings/api-tokens" element={<WorkspaceApiTokensPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: ME as never });
  useDemoStore.setState({ isDemo: false, expiresAt: null });
  mocks.members.mockResolvedValue([{ id: "m1", member: ME, role: 15 }]);
  mocks.list.mockResolvedValue([]);
});

describe("WorkspaceApiTokensPage", () => {
  it("발급한 원문은 한 번만 보이고, 닫았다 다시 열면 남아 있지 않다", async () => {
    mocks.create.mockResolvedValue({ ...token(), token: "orbt_secret-value" });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /settings.apiTokens.create$/ }));
    await userEvent.type(screen.getByLabelText("settings.apiTokens.name"), "CI");
    await userEvent.click(screen.getByRole("button", { name: /settings.apiTokens.scope.write/ }));
    await userEvent.click(screen.getByRole("button", { name: "settings.apiTokens.createSubmit" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(WS, { name: "CI", scope: "write", expires_in_days: 90 }),
    );
    expect(await screen.findByText("orbt_secret-value")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "settings.apiTokens.done" }));
    await waitFor(() => expect(screen.queryByText("orbt_secret-value")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /settings.apiTokens.create$/ }));
    expect(screen.queryByText("orbt_secret-value")).not.toBeInTheDocument();
    expect(screen.getByLabelText("settings.apiTokens.name")).toHaveValue("");
  });

  it("살아 있는 토큰만 폐기 버튼이 있고, 확인을 거쳐 폐기한다", async () => {
    mocks.list.mockResolvedValue([
      token(),
      token({ id: "t2", name: "old", status: "revoked", revoked_at: "2026-09-02T00:00:00Z" }),
    ]);
    mocks.revoke.mockResolvedValue(undefined);
    renderPage();

    const revokeButtons = await screen.findAllByRole("button", { name: "settings.apiTokens.revoke" });
    expect(revokeButtons).toHaveLength(1);

    await userEvent.click(revokeButtons[0]);
    const dialogButtons = await screen.findAllByRole("button", { name: "settings.apiTokens.revoke" });
    await userEvent.click(dialogButtons[dialogButtons.length - 1]);
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith(WS, "t1"));
  });

  it("관리자에게만 워크스페이스 전체 보기가 있다", async () => {
    renderPage();
    await screen.findByText("settings.apiTokens.empty");
    expect(screen.queryByRole("button", { name: "settings.apiTokens.tabAll" })).not.toBeInTheDocument();
  });

  it("관리자가 전체 보기를 누르면 all=true 로 부른다", async () => {
    mocks.members.mockResolvedValue([{ id: "m1", member: ME, role: 20 }]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "settings.apiTokens.tabAll" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(WS, true));
  });

  it("데모에서는 만들기 버튼이 없다", async () => {
    useDemoStore.setState({ isDemo: true, expiresAt: "2026-09-16T00:00:00Z" });
    renderPage();
    expect(await screen.findByText("settings.apiTokens.demoBlocked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /settings.apiTokens.create$/ })).not.toBeInTheDocument();
  });
});
