import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ login: vi.fn(), navigate: vi.fn() }));

/* DemoLandingPage.test 와 같은 이유 — t 는 키를 그대로 돌려준다 */
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, fallback?: string) => fallback ?? k,
    i18n: { language: "ko", changeLanguage: vi.fn() },
  }),
}));
vi.mock("@/api/auth", () => ({ authApi: { login: mocks.login } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
/* 장식용 SVG 애니메이션 — jsdom 에 getTotalLength 가 없어 렌더가 터진다 */
vi.mock("@/components/auth/OrbiTailOrbit", () => ({ OrbiTailOrbit: () => null }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

import { LoginPage } from "./LoginPage";
import { ThemeProvider } from "@/lib/theme-provider";
import { useAuthStore } from "@/stores/authStore";

const TOKENS = {
  access: "access-token",
  refresh: "refresh-token",
  user: { id: "u1", email: "a@b.com", display_name: "A" },
};

function renderPage(entry = "/auth/login") {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[entry]}>
          <LoginPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const loginForm = () => screen.queryByRole("button", { name: "auth.login.submit" });

async function submitLogin() {
  await userEvent.type(screen.getByPlaceholderText("auth.login.emailPlaceholder"), "a@b.com");
  await userEvent.type(screen.getByPlaceholderText("auth.login.passwordPlaceholder"), "pw");
  await userEvent.click(screen.getByRole("button", { name: "auth.login.submit" }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
}

describe("LoginPage — 로그인 유지", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.getState().clearAuth();
    mocks.login.mockResolvedValue(TOKENS);
  });

  it("체크박스는 기본으로 켜져 있다", () => {
    renderPage();
    expect(screen.getByRole("checkbox", { name: "auth.login.rememberMe" })).toBeChecked();
  });

  it("켠 채로 로그인하면 localStorage 에 토큰이 남는다", async () => {
    renderPage();
    await submitLogin();
    expect(localStorage.getItem("access_token")).toBe("access-token");
    expect(sessionStorage.getItem("access_token")).toBeNull();
  });

  it("해제하고 로그인하면 sessionStorage 에만 토큰이 남는다", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("checkbox", { name: "auth.login.rememberMe" }));
    await submitLogin();
    expect(sessionStorage.getItem("access_token")).toBe("access-token");
    expect(localStorage.getItem("access_token")).toBeNull();
  });

  it("직전에 고른 값이 다음 로그인 폼에 남는다", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("checkbox", { name: "auth.login.rememberMe" }));
    await submitLogin();

    /* 다음 방문 — 로그아웃으로 세션은 끊겨도 remember 설정은 남아 있어야 한다 */
    cleanup();
    useAuthStore.getState().clearAuth();
    renderPage();
    expect(screen.getByRole("checkbox", { name: "auth.login.rememberMe" })).not.toBeChecked();
  });
});

describe("LoginPage — 이미 로그인된 상태", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.getState().clearAuth();
  });

  it("세션이 남아 있으면 폼 대신 앱으로 보낸다 (북마크로 /auth/login 진입)", () => {
    useAuthStore.getState().setAuth(TOKENS.user as never, TOKENS.access, TOKENS.refresh);
    renderPage();
    expect(loginForm()).toBeNull();
  });

  it("가입 직후 안내가 붙어 있으면 자동 진입하지 않는다", () => {
    useAuthStore.getState().setAuth(TOKENS.user as never, TOKENS.access, TOKENS.refresh);
    renderPage("/auth/login?notice=verify-email");
    expect(loginForm()).toBeInTheDocument();
  });

  it("세션이 없으면 폼을 보여준다", () => {
    renderPage();
    expect(loginForm()).toBeInTheDocument();
  });
});
