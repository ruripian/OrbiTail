import { describe, it, expect, beforeEach } from "vitest";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  getRemember,
  setRemember,
  setTokens,
} from "./token-storage";

describe("token-storage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("기본값은 유지 — 설정이 없으면 localStorage 에 저장한다", () => {
    expect(getRemember()).toBe(true);
    setTokens("a", "r");
    expect(localStorage.getItem("access_token")).toBe("a");
    expect(sessionStorage.getItem("access_token")).toBeNull();
    expect(getAccessToken()).toBe("a");
    expect(getRefreshToken()).toBe("r");
  });

  it("유지 해제 시 sessionStorage 에 저장한다", () => {
    setRemember(false);
    setTokens("a", "r");
    expect(sessionStorage.getItem("access_token")).toBe("a");
    expect(localStorage.getItem("access_token")).toBeNull();
    expect(getAccessToken()).toBe("a");
  });

  it("설정을 바꿔 로그인하면 반대편 저장소의 옛 토큰이 남지 않는다", () => {
    setTokens("old", "old-r");
    setRemember(false);
    setTokens("new", "new-r");
    expect(localStorage.getItem("access_token")).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
    expect(getAccessToken()).toBe("new");
  });

  it("refresh 없이 갱신하면 기존 refresh 토큰을 유지한다", () => {
    setTokens("a", "r");
    setTokens("a2");
    expect(getAccessToken()).toBe("a2");
    expect(getRefreshToken()).toBe("r");
  });

  it("clearTokens 는 양쪽 저장소를 비우되 remember 설정은 남긴다", () => {
    setRemember(false);
    setTokens("a", "r");
    localStorage.setItem("access_token", "stale");
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("access_token")).toBeNull();
    expect(getRemember()).toBe(false);
  });
});
