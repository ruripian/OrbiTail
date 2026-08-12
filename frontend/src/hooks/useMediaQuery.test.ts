import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMediaQuery, useIsDesktop } from "./useMediaQuery";

/**
 * jsdom 에는 matchMedia 가 없다. 쿼리별 매칭 여부를 우리가 제어하고,
 * change 리스너를 붙잡아 뷰포트 변화를 흉내낸다.
 */
let matchTable: Record<string, boolean>;
let listeners: Map<string, Set<(e: MediaQueryListEvent) => void>>;

function fireChange(query: string, matches: boolean) {
  matchTable[query] = matches;
  listeners.get(query)?.forEach((cb) => cb({ matches } as MediaQueryListEvent));
}

beforeEach(() => {
  matchTable = {};
  listeners = new Map();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return matchTable[query] ?? false; },
    media: query,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(cb);
    },
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.get(query)?.delete(cb);
    },
  }));
});

const Q = "(min-width: 1024px)";

describe("useMediaQuery", () => {
  it("첫 렌더에서 현재 매칭 상태를 그대로 반환한다 (깜빡임 없이)", () => {
    matchTable[Q] = true;
    expect(renderHook(() => useMediaQuery(Q)).result.current).toBe(true);
  });

  it("매칭되지 않으면 false", () => {
    expect(renderHook(() => useMediaQuery(Q)).result.current).toBe(false);
  });

  it("뷰포트가 바뀌면 따라간다", () => {
    matchTable[Q] = false;
    const { result } = renderHook(() => useMediaQuery(Q));
    expect(result.current).toBe(false);

    act(() => fireChange(Q, true));
    expect(result.current).toBe(true);

    act(() => fireChange(Q, false));
    expect(result.current).toBe(false);
  });

  it("쿼리 문자열이 바뀌면 새 쿼리 기준으로 다시 판정한다", () => {
    const A = "(min-width: 640px)";
    const B = "(min-width: 1280px)";
    matchTable[A] = true;
    matchTable[B] = false;

    const { result, rerender } = renderHook(({ q }) => useMediaQuery(q), {
      initialProps: { q: A },
    });
    expect(result.current).toBe(true);

    rerender({ q: B });
    expect(result.current).toBe(false);
  });

  it("언마운트하면 리스너를 정리한다", () => {
    const { unmount } = renderHook(() => useMediaQuery(Q));
    expect(listeners.get(Q)?.size).toBeGreaterThan(0);

    unmount();
    expect(listeners.get(Q)?.size ?? 0).toBe(0);
  });
});

describe("useIsDesktop", () => {
  it("lg 브레이크포인트(1024px) 기준을 쓴다", () => {
    matchTable["(min-width: 1024px)"] = true;
    expect(renderHook(() => useIsDesktop()).result.current).toBe(true);
  });
});
