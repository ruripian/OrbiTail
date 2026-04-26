import { useEffect, useState } from "react";

/**
 * useLocalState — localStorage 와 동기화되는 useState 변종 (PASS5-A).
 *
 * 키는 자동으로 "orbitail." prefix 가 붙는다 (dot-namespace 통일).
 * 문자열은 그대로 저장, 그 외 타입은 JSON.stringify. parse 옵션으로 string→T 변환을 커스터마이즈.
 *
 *   const [showIds, setShowIds] = useLocalState<boolean>("graph.showIds", true);
 *   const [layout, setLayout]   = useLocalState<"force" | "orbit">("graph.layout", "force",
 *     (raw) => raw === "orbit" ? "orbit" : "force");
 */
export function useLocalState<T>(
  key: string,
  initial: T,
  parse?: (raw: string) => T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const fullKey = `orbitail.${key}`;

  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw == null) return initial;
      if (parse) return parse(raw);
      // 문자열 타입이면 raw 자체. 그 외엔 JSON.parse.
      if (typeof initial === "string") return raw as unknown as T;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      localStorage.setItem(fullKey, serialized);
    } catch {
      /* quota exceeded — silent ignore */
    }
  }, [fullKey, value]);

  return [value, setValue];
}
