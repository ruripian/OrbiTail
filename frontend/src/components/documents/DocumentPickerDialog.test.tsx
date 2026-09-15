import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  spaces: vi.fn(),
  list: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@/api/documents", () => ({
  documentsApi: {
    spaces: { list: mocks.spaces },
    list: mocks.list,
    search: mocks.search,
    create: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { DocumentPickerDialog } from "./DocumentPickerDialog";

const space = (id: string, name: string) => ({ id, name, space_type: "project", project: `p-${id}` });
const doc = (id: string, title: string, spaceId: string) => ({ id, title, space: spaceId, parent: null, is_folder: false });

function renderPicker(props: Partial<Parameters<typeof DocumentPickerDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentPickerDialog open onOpenChange={vi.fn()} workspaceSlug="ws" onSelect={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spaces.mockResolvedValue([space("s-mine", "결제 프로젝트"), space("s-other", "다른 프로젝트")]);
  mocks.list.mockImplementation(async (_ws: string, sid: string) =>
    sid === "s-mine" ? [doc("d1", "결제 설계", "s-mine")] : [doc("d2", "남의 문서", "s-other")]);
  mocks.search.mockResolvedValue([doc("d1", "결제 설계", "s-mine"), doc("d2", "결제 남의 문서", "s-other")]);
});

describe("DocumentPickerDialog — 프로젝트 스페이스 우선", () => {
  it("처음엔 이 프로젝트 스페이스만 펼쳐 보여 주고, 버튼으로 다른 스페이스를 연다", async () => {
    renderPicker({ focusSpaceId: "s-mine" });
    expect(await screen.findByText("결제 설계")).toBeInTheDocument();
    expect(screen.queryByText("다른 프로젝트")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /다른 스페이스 문서도 보기/ }));
    expect(await screen.findByText("다른 프로젝트")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "이 프로젝트 문서만 보기" }));
    await waitFor(() => expect(screen.queryByText("다른 프로젝트")).not.toBeInTheDocument());
  });

  it("검색도 이 프로젝트 문서로 좁히고, 가려진 건수를 알려 준다", async () => {
    renderPicker({ focusSpaceId: "s-mine" });
    await userEvent.type(await screen.findByPlaceholderText(/검색/), "결제");
    /* 트리에도 같은 제목이 있으므로 검색 결과가 도착했다는 신호(가려진 건수)를 먼저 기다린다 */
    expect(await screen.findByText("1건 더 있음")).toBeInTheDocument();
    expect(screen.getByText("결제 설계")).toBeInTheDocument();
    expect(screen.queryByText("결제 남의 문서")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /다른 스페이스 문서도 보기/ }));
    expect(await screen.findByText("결제 남의 문서")).toBeInTheDocument();
  });

  it("초점 스페이스가 없으면 전부 보여 준다", async () => {
    renderPicker();
    expect(await screen.findByText("결제 프로젝트")).toBeInTheDocument();
    expect(screen.getByText("다른 프로젝트")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /다른 스페이스 문서도 보기/ })).not.toBeInTheDocument();
  });
});
