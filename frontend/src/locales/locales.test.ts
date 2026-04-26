import { describe, it, expect } from "vitest";
import ko from "./ko/common.json";
import en from "./en/common.json";

/**
 * ko/en 키셋 대칭성 검증.
 * scripts/check-translations.js 의 로직을 vitest 로 옮겨, CI 에서 다른 테스트와 함께 돌도록 함.
 */
function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return flatten(v, key);
    return [key];
  });
}

describe("locales (ko ↔ en symmetry)", () => {
  const koKeys = new Set(flatten(ko));
  const enKeys = new Set(flatten(en));

  it("ko 와 en 의 키 개수가 같다", () => {
    expect(enKeys.size).toBe(koKeys.size);
  });

  it("ko 에만 있는 키가 없다", () => {
    const koOnly = [...koKeys].filter((k) => !enKeys.has(k));
    expect(koOnly).toEqual([]);
  });

  it("en 에만 있는 키가 없다", () => {
    const enOnly = [...enKeys].filter((k) => !koKeys.has(k));
    expect(enOnly).toEqual([]);
  });
});
