import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider, useTheme } from "./theme-provider";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

/* matchMedia 는 jsdom 에 없다 — "OS 는 light" 로 고정해 system 해석을 결정적으로 만든다. */
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  document.documentElement.classList.remove("dark");
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null });
});

function makeUser(theme: User["theme"], id = "u1"): User {
  return { id, email: "a@b.c", display_name: "A", theme } as User;
}

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;
const renderTheme = () => renderHook(() => useTheme(), { wrapper });
const isDark = () => document.documentElement.classList.contains("dark");

describe("ThemeProvider", () => {
  it("저장된 값이 없으면 system — OS 가 light 면 light 로 해석", () => {
    const { result } = renderTheme();
    expect(result.current.theme).toBe("system");
    expect(result.current.resolvedTheme).toBe("light");
    expect(isDark()).toBe(false);
  });

  it("localStorage 에 저장된 테마로 시작한다", () => {
    localStorage.setItem("theme", "dark");
    const { result } = renderTheme();
    expect(result.current.theme).toBe("dark");
    expect(isDark()).toBe(true);
  });

  it("로그인한 계정의 테마가 localStorage 보다 우선한다", () => {
    /* 다른 기기에서 dark 로 바꿨는데 이 브라우저 localStorage 는 light 인 상황 */
    localStorage.setItem("theme", "light");
    useAuthStore.setState({ user: makeUser("dark") });

    const { result } = renderTheme();

    expect(result.current.theme).toBe("dark");
    expect(isDark()).toBe(true);
    /* 동기화된 값이 localStorage 에도 반영돼야 다음 로드가 깜빡이지 않는다 */
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("계정을 전환하면 그 계정의 테마를 따라간다", () => {
    useAuthStore.setState({ user: makeUser("light", "u1") });
    const { result } = renderTheme();
    expect(result.current.theme).toBe("light");

    act(() => { useAuthStore.setState({ user: makeUser("dark", "u2") }); });
    expect(result.current.theme).toBe("dark");
  });

  it("같은 계정이 유지되는 동안 사용자의 토글이 서버 값에 덮이지 않는다", () => {
    useAuthStore.setState({ user: makeUser("light", "u1") });
    const { result } = renderTheme();

    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");

    /* user 객체 참조만 새로 만들어져도(같은 id) 서버 값으로 되돌아가면 안 된다 */
    act(() => { useAuthStore.setState({ user: makeUser("light", "u1") }); });
    expect(result.current.theme).toBe("dark");
  });

  it("로그아웃해도 마지막 테마를 유지한다", () => {
    useAuthStore.setState({ user: makeUser("dark", "u1") });
    const { result } = renderTheme();
    expect(result.current.theme).toBe("dark");

    act(() => { useAuthStore.setState({ user: null }); });
    expect(result.current.theme).toBe("dark");
  });
});
