import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { FontSettingsProvider, useFontSettings } from "./font-settings";
import { useAuthStore } from "@/stores/authStore";
import { settingsApi } from "@/api/settings";
import type { User } from "@/types";

vi.mock("@/api/settings", () => ({
  settingsApi: { updatePreferences: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null });
  document.documentElement.style.cssText = "";
});

function makeUser(over: Partial<User> = {}, id = "u1"): User {
  return {
    id, email: "a@b.c", display_name: "A",
    ui_font_scale: 1.0, ui_font_family: "pretendard", ui_font_mono: "jetbrains",
    ...over,
  } as User;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <FontSettingsProvider>{children}</FontSettingsProvider>
);
const renderFonts = () => renderHook(() => useFontSettings(), { wrapper });
const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);

describe("FontSettingsProvider", () => {
  it("저장된 값이 없으면 기본값으로 시작하고 :root 에 반영한다", () => {
    const { result } = renderFonts();
    expect(result.current.fontScale).toBe(1.0);
    expect(result.current.fontFamily).toBe("pretendard");
    expect(rootVar("--app-font-scale")).toBe("1");
    expect(rootVar("--font-sans")).toContain("Pretendard");
  });

  it("localStorage 값을 복원한다 (비로그인 상태의 fallback)", () => {
    localStorage.setItem(
      "view_settings",
      JSON.stringify({ fontScale: 1.2, fontFamily: "noto", fontMono: "d2coding" }),
    );
    const { result } = renderFonts();
    expect(result.current.fontScale).toBe(1.2);
    expect(result.current.fontFamily).toBe("noto");
    expect(result.current.fontMono).toBe("d2coding");
  });

  it("배율은 0.8~1.4 로 잘라낸다", () => {
    localStorage.setItem("view_settings", JSON.stringify({ fontScale: 99 }));
    expect(renderFonts().result.current.fontScale).toBe(1.4);
  });

  it("깨진 JSON 이어도 기본값으로 뜬다", () => {
    localStorage.setItem("view_settings", "{not json");
    expect(renderFonts().result.current.fontFamily).toBe("pretendard");
  });

  it("로그인한 계정의 설정이 localStorage 보다 우선한다", () => {
    localStorage.setItem("view_settings", JSON.stringify({ fontFamily: "noto" }));
    useAuthStore.setState({ user: makeUser({ ui_font_family: "nanum-myeongjo" }) });

    const { result } = renderFonts();

    expect(result.current.fontFamily).toBe("nanum-myeongjo");
    expect(rootVar("--font-sans")).toContain("Nanum Myeongjo");
  });

  it("계정을 전환하면 그 계정의 설정을 따라간다", () => {
    useAuthStore.setState({ user: makeUser({ ui_font_family: "noto" }, "u1") });
    const { result } = renderFonts();
    expect(result.current.fontFamily).toBe("noto");

    act(() => {
      useAuthStore.setState({ user: makeUser({ ui_font_family: "nanum-gothic" }, "u2") });
    });
    expect(result.current.fontFamily).toBe("nanum-gothic");
  });

  it("같은 계정이 유지되는 동안 사용자의 변경이 서버 값에 덮이지 않는다", () => {
    useAuthStore.setState({ user: makeUser({ ui_font_family: "pretendard" }, "u1") });
    const { result } = renderFonts();

    act(() => result.current.setFontFamily("noto"));
    expect(result.current.fontFamily).toBe("noto");

    /* user 참조만 새로 만들어져도(같은 id) 되돌아가면 안 된다 */
    act(() => {
      useAuthStore.setState({ user: makeUser({ ui_font_family: "pretendard" }, "u1") });
    });
    expect(result.current.fontFamily).toBe("noto");
  });

  it("비로그인 상태에서는 서버로 저장하지 않는다", () => {
    const { result } = renderFonts();

    act(() => result.current.setFontScale(1.2));

    expect(result.current.fontScale).toBe(1.2);
    expect(localStorage.getItem("view_settings")).toContain("1.2");
    expect(settingsApi.updatePreferences).not.toHaveBeenCalled();
  });

  it("로그인 상태에서 변경하면 서버에 저장한다 — 연속 조작이어도 마지막 값 1회만", async () => {
    vi.mocked(settingsApi.updatePreferences).mockResolvedValue(makeUser());
    useAuthStore.setState({ user: makeUser() });
    const { result } = renderFonts();

    /* 슬라이더 드래그처럼 연속 호출 — 중간값이 매번 전송되면 안 된다 */
    act(() => {
      result.current.setFontScale(1.1);
      result.current.setFontScale(1.2);
      result.current.setFontScale(1.3);
    });

    await waitFor(() => expect(settingsApi.updatePreferences).toHaveBeenCalledTimes(1));
    expect(settingsApi.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ ui_font_scale: 1.3 }),
    );
  });

  it("서버 저장이 실패해도 화면 값은 유지된다", async () => {
    vi.mocked(settingsApi.updatePreferences).mockRejectedValue(new Error("network"));
    useAuthStore.setState({ user: makeUser() });
    const { result } = renderFonts();

    act(() => result.current.setFontFamily("noto"));

    await waitFor(() => expect(settingsApi.updatePreferences).toHaveBeenCalled());
    expect(result.current.fontFamily).toBe("noto");
  });

  it("reset 은 기본값으로 되돌린다", () => {
    localStorage.setItem(
      "view_settings",
      JSON.stringify({ fontScale: 1.3, fontFamily: "noto", fontMono: "d2coding" }),
    );
    const { result } = renderFonts();

    act(() => result.current.reset());

    expect(result.current.fontScale).toBe(1.0);
    expect(result.current.fontFamily).toBe("pretendard");
    expect(result.current.fontMono).toBe("jetbrains");
  });
});
