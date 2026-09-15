import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ list: vi.fn(), move: vi.fn() }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}:${JSON.stringify(vars)}` : k),
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));
vi.mock("@/api/projects", () => ({ projectsApi: { list: mocks.list } }));
vi.mock("@/api/issues", () => ({ issuesApi: { move: mocks.move } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { MoveIssueDialog } from "./MoveIssueDialog";
import type { Issue } from "@/types";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([
    { id: "p-src", name: "원래", identifier: "SRC", user_role: 20 },
    { id: "p-dst", name: "결제", identifier: "PAY", user_role: 15 },
    { id: "p-view", name: "읽기만", identifier: "RO", user_role: 10 },
  ]);
  mocks.move.mockResolvedValue({ issue: { id: "i1", project_identifier: "PAY", sequence_id: 5 }, moved_count: 2 });
});

describe("MoveIssueDialog", () => {
  it("편집할 수 있는 다른 프로젝트만 고를 수 있고, 옮기면 대상 프로젝트를 알린다", async () => {
    const onMoved = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MoveIssueDialog
          open onOpenChange={vi.fn()} workspaceSlug="ws" projectId="p-src"
          issue={{ id: "i1", title: "옮길 이슈" } as Issue} subIssueCount={1} onMoved={onMoved}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("결제")).toBeInTheDocument();
    expect(screen.queryByText("원래")).not.toBeInTheDocument();
    expect(screen.queryByText("읽기만")).not.toBeInTheDocument();
    expect(screen.getByText(/issues.move.noteSubIssues/)).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: /issues.move.submit/ });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByText("결제"));
    await userEvent.click(submit);
    await waitFor(() => expect(mocks.move).toHaveBeenCalledWith("ws", "p-src", "i1", "p-dst"));
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), "p-dst"));
  });
});
