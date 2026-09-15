import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  trashList: vi.fn(),
  restore: vi.fn(),
  purge: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}:${JSON.stringify(vars)}` : k),
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));
vi.mock("@/api/projects", () => ({
  projectsApi: {
    list: mocks.list,
    unarchive: vi.fn(),
    trash: { list: mocks.trashList, restore: mocks.restore, purge: mocks.purge },
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ArchivedProjectsPage } from "./ArchivedProjectsPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/ws/workspace-settings/archived"]}>
        <Routes>
          <Route path="/:workspaceSlug/workspace-settings/archived" element={<ArchivedProjectsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.trashList.mockResolvedValue([{
    id: "p1", name: "결제", identifier: "PAY", archived_at: null,
    deleted_at: new Date().toISOString(), deleted_by: "관리자",
    purge_at: new Date(Date.now() + 29.5 * 86_400_000).toISOString(),
  }]);
  mocks.restore.mockResolvedValue({});
  mocks.purge.mockResolvedValue(undefined);
});

describe("ArchivedProjectsPage — 휴지통", () => {
  it("삭제한 프로젝트가 남은 일수와 함께 보이고 복구할 수 있다", async () => {
    renderPage();
    expect(await screen.findByText("결제")).toBeInTheDocument();
    expect(screen.getByText('archivedProjects.daysLeft:{"days":30}')).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /archivedProjects.restore/ }));
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith("ws", "p1"));
  });

  it("영구 삭제는 확인을 거친다", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "archivedProjects.purge" }));
    expect(mocks.purge).not.toHaveBeenCalled();
    const buttons = await screen.findAllByRole("button", { name: "archivedProjects.purge" });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(mocks.purge).toHaveBeenCalledWith("ws", "p1"));
  });
});
