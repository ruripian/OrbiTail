import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  toastError: vi.fn(),
}));

/* authStore → lib/i18n 이 initReactI18next 를 필요로 하므로 모듈 전체를 갈아끼우지
   않고 useTranslation 만 덮어쓴다. t 는 키를 그대로 돌려줘 문구 변경에 흔들리지 않게 한다. */
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));
vi.mock("@/api/demo", () => ({ demoApi: { createSession: mocks.createSession } }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

import { DemoLandingPage } from "./DemoLandingPage";
import { ThemeProvider } from "@/lib/theme-provider";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";

function renderPage(ttlHours: number | null, onStart = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <DemoLandingPage ttlHours={ttlHours} onStart={onStart} />
      </ThemeProvider>
    </QueryClientProvider>
  );
  return { onStart };
}

const SESSION = {
  access: "access-token",
  refresh: "refresh-token",
  user: { id: "u1", email: "you@abc.demo.invalid", display_name: "You" },
  expires_at: "2999-01-01T00:00:00Z",
};

describe("DemoLandingPage", () => {
  beforeEach(() => {
    /* matchMedia 는 jsdom 에 없다 — AuthCard 안의 ThemeProvider 가 쓴다.
       "OS 는 light" 로 고정해 결정적으로 만든다. (theme-provider.test.tsx 와 동일) */
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    useDemoStore.getState().clearDemo();
  });

  it("설명과 시작 버튼을 렌더한다", () => {
    renderPage(24);
    expect(screen.getByText("demo.description")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "demo.start" })).toBeInTheDocument();
  });

  it("ttlHours 가 있으면 만료 시간이 포함된 안내를 쓴다", () => {
    renderPage(24);
    expect(screen.getByText('demo.noticeWithTtl:{"hours":24}')).toBeInTheDocument();
  });

  it("ttlHours 가 없으면 기본 안내를 쓴다", () => {
    renderPage(null);
    expect(screen.getByText("demo.notice")).toBeInTheDocument();
  });

  it("시작을 누르면 세션을 만들고 인증·데모 상태를 채운 뒤 onStart 를 부른다", async () => {
    mocks.createSession.mockResolvedValue(SESSION);
    const { onStart } = renderPage(24);

    await userEvent.click(screen.getByRole("button", { name: "demo.start" }));

    await waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(useAuthStore.getState().accessToken).toBe("access-token");
    expect(localStorage.getItem("access_token")).toBe("access-token");
    expect(useDemoStore.getState().isDemo).toBe(true);
    expect(useDemoStore.getState().expiresAt).toBe(SESSION.expires_at);
  });

  it("세션 생성이 실패하면 토스트만 띄우고 진입하지 않는다", async () => {
    mocks.createSession.mockRejectedValue(new Error("429"));
    const { onStart } = renderPage(24);

    await userEvent.click(screen.getByRole("button", { name: "demo.start" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("demo.startFailed"));
    expect(onStart).not.toHaveBeenCalled();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useDemoStore.getState().isDemo).toBe(false);
  });
});
