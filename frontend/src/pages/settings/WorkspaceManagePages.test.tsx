import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  members: vi.fn(), projects: vi.fn(), update: vi.fn(), trash: vi.fn(), activity: vi.fn(), usage: vi.fn(),
}));

vi.mock("@/api/workspaces", () => ({ workspacesApi: { members: mocks.members } }));
vi.mock("@/api/manage", () => ({
  manageApi: {
    activity: mocks.activity,
    usage: mocks.usage,
    projects: {
      list: mocks.projects, update: mocks.update, trash: mocks.trash,
      members: { list: vi.fn(async () => []), add: vi.fn(), setRole: vi.fn(), remove: vi.fn() },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { WorkspaceProjectsManagePage } from "./WorkspaceProjectsManagePage";
import { WorkspaceActivityPage } from "./WorkspaceActivityPage";
import { WorkspaceUsagePage, formatBytes } from "./WorkspaceUsagePage";
import { useAuthStore } from "@/stores/authStore";

const ME = { id: "u1", email: "me@x.test", display_name: "나" };

function renderAt(path: string, element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/ws/workspace-settings/${path}`]}>
        <Routes>
          <Route path={`/:workspaceSlug/workspace-settings/${path}`} element={element} />
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
  mocks.projects.mockResolvedValue([
    { id: "p1", name: "비밀 결제", identifier: "SEC", visibility: "private", lead: null, member_count: 2,
      issue_count: 7, archived_at: null, deleted_at: null, i_am_member: false, created_at: "" },
    { id: "p2", name: "지운 것", identifier: "OLD", visibility: "public", lead: null, member_count: 1,
      issue_count: 0, archived_at: null, deleted_at: "2026-09-01T00:00:00Z", i_am_member: true, created_at: "" },
  ]);
  mocks.update.mockResolvedValue({});
  mocks.trash.mockResolvedValue({});
});

describe("WorkspaceProjectsManagePage", () => {
  it("멤버가 아닌 비공개 프로젝트를 보여 주고 보관·휴지통으로 옮길 수 있다", async () => {
    renderAt("projects", <WorkspaceProjectsManagePage />);
    expect(await screen.findByText("비밀 결제")).toBeInTheDocument();
    expect(screen.getByText("· 나는 멤버 아님")).toBeInTheDocument();
    expect(screen.queryByText("지운 것")).not.toBeInTheDocument();
    expect(screen.getByText(/휴지통에 프로젝트 1개/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "보관" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("ws", "p1", { archived: true }));

    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    await userEvent.click(await screen.findByRole("button", { name: "휴지통으로" }));
    await waitFor(() => expect(mocks.trash).toHaveBeenCalledWith("ws", "p1"));
  });

  it("관리자가 아니면 들어올 수 없다", async () => {
    mocks.members.mockResolvedValue([{ id: "m1", member: ME, role: 15 }]);
    renderAt("projects", <WorkspaceProjectsManagePage />);
    expect(await screen.findByText("archived-page")).toBeInTheDocument();
    expect(mocks.projects).not.toHaveBeenCalled();
  });
});

describe("WorkspaceActivityPage", () => {
  it("비공개에 자신을 추가한 기록을 표시하고 분류로 거른다", async () => {
    mocks.activity.mockResolvedValue({
      count: 1, next: null, previous: null,
      results: [{
        id: "a1", action: "space.member_added", actor: { id: "u1", display_name: "김관리", email: "a@x.test" },
        target_type: "document_space", target_id: "s1", target_label: "인사",
        metadata: { member: "a@x.test", role: 5, self_added: true, is_private: true, via: "workspace_settings" },
        created_at: "2026-09-15T01:00:00Z",
      }],
    });
    renderAt("activity", <WorkspaceActivityPage />);
    expect(await screen.findByText("비공개에 자신을 추가")).toBeInTheDocument();
    expect(screen.getByText(/스페이스 멤버를 추가함/)).toBeInTheDocument();
    expect(screen.getByText(/뷰어 · 워크스페이스 설정에서/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "웹훅" }));
    await waitFor(() => expect(mocks.activity).toHaveBeenLastCalledWith("ws", { category: "webhook", page: 1 }));
  });
});

describe("WorkspaceUsagePage", () => {
  it("용량을 합산하고 주인 없는 개인 스페이스를 사유와 함께 보여 준다", async () => {
    mocks.usage.mockResolvedValue({
      members: 3, projects: 2, projects_archived: 0, projects_trashed: 1, issues: 10, issues_trashed: 0,
      spaces: 1, documents: 4, documents_trashed: 0, teams: 1,
      storage: { issue_attachments: { count: 1, bytes: 1024 * 1024 }, document_attachments: { count: 2, bytes: 1024 * 1024 } },
      orphan_personal_spaces: [{ id: "o1", name: "떠난 사람", owner_email: "left@x.test", document_count: 2, reason: "owner_left" }],
      can_delete_orphans: false,
    });
    renderAt("usage", <WorkspaceUsagePage />);
    expect(await screen.findByText("2.0 MB")).toBeInTheDocument();
    expect(screen.getByText(/워크스페이스를 떠남 · 문서 2/)).toBeInTheDocument();
    expect(screen.getByText(/시스템 관리자에게 요청/)).toBeInTheDocument();
    expect(formatBytes(512)).toBe("512 B");
  });
});
