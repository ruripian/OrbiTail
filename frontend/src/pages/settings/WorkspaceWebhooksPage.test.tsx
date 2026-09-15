import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import ko from "@/locales/ko/common.json";
import en from "@/locales/en/common.json";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  ping: vi.fn(),
  deliveries: vi.fn(),
  members: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}:${JSON.stringify(vars)}` : k),
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));
vi.mock("@/api/webhooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/webhooks")>()),
  webhooksApi: {
    list: mocks.list, create: mocks.create, update: mocks.update, remove: mocks.remove,
    ping: mocks.ping, deliveries: mocks.deliveries,
  },
}));
vi.mock("@/api/workspaces", () => ({ workspacesApi: { members: mocks.members } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { WorkspaceWebhooksPage } from "./WorkspaceWebhooksPage";
import { WEBHOOK_EVENTS } from "@/api/webhooks";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";

const WS = "ws1";
const ME = { id: "u1", email: "me@x.test", display_name: "나" };

const hook = (over = {}) => ({
  id: "h1", name: "슬랙", url: "https://hooks.example.com/x", events: ["issue.created"], is_active: true,
  disabled_reason: "", consecutive_failures: 0, created_by: { id: ME.id, display_name: ME.display_name },
  created_at: "2026-09-15T00:00:00Z", last_delivery: null, ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${WS}/workspace-settings/webhooks`]}>
        <Routes>
          <Route path="/:workspaceSlug/workspace-settings/webhooks" element={<WorkspaceWebhooksPage />} />
          <Route path="/:workspaceSlug/workspace-settings/api-tokens" element={<p>tokens-page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: ME as never });
  useDemoStore.setState({ isDemo: false, expiresAt: null });
  mocks.members.mockResolvedValue([{ id: "m1", member: ME, role: 20 }]);
  mocks.list.mockResolvedValue([]);
  mocks.deliveries.mockResolvedValue([]);
});

describe("WorkspaceWebhooksPage", () => {
  it("모든 이벤트에 ko/en 이름이 있다 (i18next 키 경로로 찾을 수 있는 형태)", () => {
    for (const e of WEBHOOK_EVENTS) {
      const key = e.replace(".", "_") as keyof typeof ko.settings.webhooks.event;
      expect(ko.settings.webhooks.event[key], e).toBeTruthy();
      expect(en.settings.webhooks.event[key], e).toBeTruthy();
    }
  });

  it("관리자가 아니면 토큰 화면으로 보낸다", async () => {
    mocks.members.mockResolvedValue([{ id: "m1", member: ME, role: 15 }]);
    renderPage();
    expect(await screen.findByText("tokens-page")).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("만들면 비밀값을 한 번만 보여 준다", async () => {
    mocks.create.mockResolvedValue({ ...hook(), secret: "s3cr3t-value" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /settings.webhooks.create$/ }));
    await userEvent.type(screen.getByLabelText("settings.webhooks.name"), "슬랙");
    await userEvent.type(screen.getByLabelText("settings.webhooks.url"), "https://hooks.example.com/x");
    await userEvent.click(screen.getByLabelText("settings.webhooks.event.comment_created"));
    await userEvent.click(screen.getByRole("button", { name: "settings.webhooks.createSubmit" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(WS, {
      name: "슬랙", url: "https://hooks.example.com/x",
      events: ["issue.created", "issue.updated", "comment.created"],
    }));
    expect(await screen.findByText("s3cr3t-value")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settings.webhooks.done" }));
    await waitFor(() => expect(screen.queryByText("s3cr3t-value")).not.toBeInTheDocument());
  });

  it("시험 발송은 켜진 웹훅에서만 누를 수 있다", async () => {
    mocks.list.mockResolvedValue([hook(), hook({ id: "h2", name: "꺼진 것", is_active: false })]);
    mocks.ping.mockResolvedValue({});
    renderPage();
    const pings = await screen.findAllByRole("button", { name: "settings.webhooks.ping" });
    expect(pings[0]).toBeEnabled();
    expect(pings[1]).toBeDisabled();
    await userEvent.click(pings[0]);
    await waitFor(() => expect(mocks.ping).toHaveBeenCalledWith(WS, "h1"));
  });
});
