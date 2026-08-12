import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useDocReadingPrefs, adjustFontSizes, docFontCss,
  DOC_FS_DEFAULT, type DocFontSizes,
} from "./useDocReadingPrefs";

/* setup.ts 가 매 테스트 전에 localStorage 를 비운다. */

describe("useDocReadingPrefs", () => {
  it("저장된 값이 없으면 개인 설정 없음 상태 — 문서 값을 쓰라는 뜻의 null", () => {
    const { result } = renderHook(() => useDocReadingPrefs());
    expect(result.current.fontSize).toBeNull();
    expect(result.current.font).toBe("inherit");
    expect(result.current.isCustom).toBe(false);
  });

  it("크기를 바꾸면 localStorage 에 남고 isCustom 이 켜진다", () => {
    const { result } = renderHook(() => useDocReadingPrefs());
    act(() => result.current.setFontSize({ body: 20, h3: 24, h2: 30, h1: 38 }));

    expect(result.current.fontSize).toEqual({ body: 20, h3: 24, h2: 30, h1: 38 });
    expect(result.current.isCustom).toBe(true);
    expect(JSON.parse(localStorage.getItem("doc_reading_prefs")!).fontSize.body).toBe(20);
  });

  it("서체만 바꿔도 isCustom 이 켜진다", () => {
    const { result } = renderHook(() => useDocReadingPrefs());
    act(() => result.current.setFont("nanum-myeongjo"));
    expect(result.current.isCustom).toBe(true);
    expect(result.current.fontSize).toBeNull();
  });

  it("reset 은 개인 설정을 해제해 문서 값으로 되돌린다", () => {
    const { result } = renderHook(() => useDocReadingPrefs());
    act(() => result.current.setFontSize({ body: 22, h3: 26, h2: 32, h1: 40 }));
    act(() => result.current.setFont("noto"));
    act(() => result.current.reset());

    expect(result.current.fontSize).toBeNull();
    expect(result.current.font).toBe("inherit");
    expect(result.current.isCustom).toBe(false);
  });

  it("저장된 값을 다시 마운트할 때 복원한다", () => {
    localStorage.setItem(
      "doc_reading_prefs",
      JSON.stringify({ fontSize: { body: 19, h3: 23, h2: 29, h1: 37 }, font: "noto" }),
    );
    const { result } = renderHook(() => useDocReadingPrefs());
    expect(result.current.fontSize?.body).toBe(19);
    expect(result.current.font).toBe("noto");
  });

  it("깨진 JSON 이 저장돼 있어도 기본 상태로 뜬다", () => {
    localStorage.setItem("doc_reading_prefs", "{not json");
    const { result } = renderHook(() => useDocReadingPrefs());
    expect(result.current.fontSize).toBeNull();
    expect(result.current.font).toBe("inherit");
  });
});

describe("adjustFontSizes — body < h3 < h2 < h1 순서 유지", () => {
  const base: DocFontSizes = { ...DOC_FS_DEFAULT }; // 18/22/28/36

  it("범위를 벗어난 값은 잘라낸다", () => {
    expect(adjustFontSizes(base, "body", 999).body).toBe(24); // body 최대 24
    expect(adjustFontSizes(base, "body", 0).body).toBe(14);   // body 최소 14
  });

  it("본문을 키우면 위 단계들이 밀려 올라간다", () => {
    const next = adjustFontSizes(base, "body", 24);
    expect(next.body).toBe(24);
    expect(next.h3).toBeGreaterThan(next.body);
    expect(next.h2).toBeGreaterThan(next.h3);
    expect(next.h1).toBeGreaterThan(next.h2);
  });

  it("h1 을 내리면 아래 단계들이 끌려 내려간다", () => {
    const next = adjustFontSizes(base, "h1", 24);
    expect(next.h1).toBe(24);
    expect(next.h2).toBeLessThan(next.h1);
    expect(next.h3).toBeLessThan(next.h2);
    expect(next.body).toBeLessThan(next.h3);
  });

  it("소수점 입력은 반올림한다", () => {
    expect(adjustFontSizes(base, "body", 19.6).body).toBe(20);
  });

  it("원본을 변형하지 않는다", () => {
    const before = { ...base };
    adjustFontSizes(base, "body", 24);
    expect(base).toEqual(before);
  });
});

describe("docFontCss", () => {
  it("inherit 이면 앱 서체 변수를 그대로 쓴다", () => {
    expect(docFontCss("inherit")).toBe("var(--font-sans)");
  });

  it("지정 서체는 실제 font-family 스택을 반환한다", () => {
    expect(docFontCss("nanum-myeongjo")).toContain("Nanum Myeongjo");
  });
});
