import { describe, it, expect } from "vitest";
import { decideBoot, type BootInput } from "./boot";

const NOW = new Date("2026-08-20T12:00:00Z").getTime();

function input(over: Partial<BootInput> = {}): BootInput {
  return {
    setupComplete: true,
    demoEnabled: false,
    hasToken: false,
    isDemoSession: false,
    expiresAt: null,
    now: NOW,
    ...over,
  };
}

describe("decideBoot", () => {
  it("초기 설정이 안 끝났으면 무엇보다 setup 이 우선", () => {
    expect(decideBoot(input({ setupComplete: false, demoEnabled: true, hasToken: true })))
      .toEqual({ screen: "setup", clearSession: false });
  });

  describe("데모 배포가 아닐 때", () => {
    it("토큰이 없어도 라우터로 보낸다 (로그인 화면은 라우터가 처리)", () => {
      expect(decideBoot(input())).toEqual({ screen: "ready", clearSession: false });
    });

    it("토큰이 있으면 그대로 진입", () => {
      expect(decideBoot(input({ hasToken: true }))).toEqual({ screen: "ready", clearSession: false });
    });
  });

  describe("데모 배포일 때", () => {
    const demo = (over: Partial<BootInput> = {}) => decideBoot(input({ demoEnabled: true, ...over }));

    it("세션이 없으면 랜딩", () => {
      expect(demo()).toEqual({ screen: "demo", clearSession: false });
    });

    it("살아 있는 데모 세션이면 그대로 진입", () => {
      expect(demo({ hasToken: true, isDemoSession: true, expiresAt: "2026-08-21T00:00:00Z" }))
        .toEqual({ screen: "ready", clearSession: false });
    });

    it("만료 시각이 없는 데모 세션도 통과시킨다 (만료는 서버가 최종 판단)", () => {
      expect(demo({ hasToken: true, isDemoSession: true, expiresAt: null }))
        .toEqual({ screen: "ready", clearSession: false });
    });

    it("만료된 데모 세션은 버리고 랜딩", () => {
      expect(demo({ hasToken: true, isDemoSession: true, expiresAt: "2026-08-20T11:59:00Z" }))
        .toEqual({ screen: "demo", clearSession: true });
    });

    /* 실제로 났던 문제 — 데모 전환 이전에 로그인해 둔 세션이 남아 있으면
       랜딩을 건너뛰고 들어가 "참가한 워크스페이스가 없습니다" 에 갇혔다. */
    it("데모가 아닌 세션은 버리고 랜딩", () => {
      expect(demo({ hasToken: true, isDemoSession: false }))
        .toEqual({ screen: "demo", clearSession: true });
    });

    it("데모 표시만 남고 토큰이 없는 어긋난 상태도 정리한다", () => {
      expect(demo({ hasToken: false, isDemoSession: true, expiresAt: "2026-08-21T00:00:00Z" }))
        .toEqual({ screen: "demo", clearSession: true });
    });
  });
});
