import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useParentChain } from "./useParentChain";
import { issuesApi } from "@/api/issues";
import type { Issue } from "@/types";

vi.mock("@/api/issues", () => ({
  issuesApi: { get: vi.fn() },
}));

/** id → parent 관계만 담은 최소 이슈 */
function issue(id: string, parent: string | null): Issue {
  return { id, parent, title: id } as Issue;
}

/** 주어진 관계도를 그대로 돌려주는 fake API */
function mockTree(tree: Record<string, string | null>) {
  vi.mocked(issuesApi.get).mockImplementation(async (_ws, _pid, id: string) => {
    if (!(id in tree)) throw new Error("404");
    return issue(id, tree[id]);
  });
}

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  /* 재시도가 켜져 있으면 404 케이스가 느려진다 */
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

const render = (parentId: string | null | undefined) =>
  renderHook(() => useParentChain("ws", "proj", parentId), { wrapper });

describe("useParentChain", () => {
  it("부모가 없으면 빈 배열", async () => {
    const { result } = render(null);
    expect(result.current).toEqual([]);
    expect(issuesApi.get).not.toHaveBeenCalled();
  });

  it("조상 체인을 root→parent 순서로 돌려준다", async () => {
    mockTree({ p: "gp", gp: "root", root: null });

    const { result } = render("p");

    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(result.current.map((i) => i.id)).toEqual(["root", "gp", "p"]);
  });

  it("부모가 하나뿐이면 그 하나만", async () => {
    mockTree({ p: null });
    const { result } = render("p");
    await waitFor(() => expect(result.current.map((i) => i.id)).toEqual(["p"]));
  });

  it("순환 참조가 있어도 멈춘다", async () => {
    /* a → b → a 로 서로를 가리키는 깨진 데이터 */
    mockTree({ a: "b", b: "a" });

    const { result } = render("a");

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map((i) => i.id)).toEqual(["b", "a"]);
    /* 각 노드를 한 번씩만 조회하고 무한 루프에 빠지지 않아야 한다 */
    expect(issuesApi.get).toHaveBeenCalledTimes(2);
  });

  it("중간 조상 조회가 실패하면 거기까지만 반환한다", async () => {
    mockTree({ p: "missing" });

    const { result } = render("p");

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current.map((i) => i.id)).toEqual(["p"]);
  });

  it("부모가 바뀌면 새 체인으로 교체된다", async () => {
    mockTree({ a: null, b: null });

    const { result, rerender } = renderHook(
      ({ pid }) => useParentChain("ws", "proj", pid),
      { wrapper, initialProps: { pid: "a" as string | null } },
    );
    await waitFor(() => expect(result.current.map((i) => i.id)).toEqual(["a"]));

    rerender({ pid: "b" });
    await waitFor(() => expect(result.current.map((i) => i.id)).toEqual(["b"]));
  });

  it("부모가 null 로 바뀌면 즉시 빈 배열", async () => {
    mockTree({ a: null });

    const { result, rerender } = renderHook(
      ({ pid }) => useParentChain("ws", "proj", pid),
      { wrapper, initialProps: { pid: "a" as string | null } },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));

    rerender({ pid: null });
    expect(result.current).toEqual([]);
  });

  it("workspaceSlug 나 projectId 가 없으면 조회하지 않는다", () => {
    const { result } = renderHook(() => useParentChain(undefined, "proj", "p"), { wrapper });
    expect(result.current).toEqual([]);
    expect(issuesApi.get).not.toHaveBeenCalled();
  });
});
