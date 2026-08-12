/**
 * 문서 읽기 설정 — 글자 크기 / 서체를 "보는 사람 본인 화면에만" 적용.
 *
 * 문서의 font_size_* 는 서버 필드라 바꾸면 모든 협업자 화면이 같이 바뀐다.
 * 읽는 사람이 자기 눈에 맞춰 조절하는 건 개인 취향이므로 localStorage 에만 남긴다.
 *
 * 우선순위: 개인 설정 > 문서에 저장된 값 > 앱 기본값
 * null 은 "개인 설정 없음" — 문서 값으로 되돌아간다(기본값 버튼).
 *
 * 문서별이 아니라 전역 1벌이다. 문서마다 다른 크기를 쓰고 싶은 경우는 드물고,
 * 문서 수만큼 키가 쌓이는 것도 피하기 위함.
 */

import { useCallback, useEffect, useState } from "react";
import { FONT_SANS, loadWebFont, type FontFamilyKey } from "@/lib/font-settings";

export type DocFontSizes = { body: number; h3: number; h2: number; h1: number };

/** 문서 서체 — 앱 UI 서체 목록을 그대로 쓰되 "앱 기본" 옵션을 앞에 둔다. */
export type DocFontKey = FontFamilyKey | "inherit";

export const DOC_FONT_LABELS: Array<{ value: DocFontKey; label: string }> = [
  { value: "inherit", label: "앱 기본" },
  { value: "pretendard", label: "Pretendard" },
  { value: "noto", label: "Noto Sans KR" },
  { value: "nanum-gothic", label: "나눔고딕" },
  { value: "nanum-myeongjo", label: "나눔명조" },
  { value: "system", label: "시스템" },
];

/** doc-frame 에 주입할 font-family 값. "inherit" 이면 앱 서체(--font-sans)를 따른다. */
export function docFontCss(key: DocFontKey): string {
  return key === "inherit" ? "var(--font-sans)" : (FONT_SANS[key] ?? "var(--font-sans)");
}

export const DOC_FS_DEFAULT: DocFontSizes = { body: 18, h3: 22, h2: 28, h1: 36 };
export const DOC_FS_RANGE: Record<keyof DocFontSizes, [number, number]> = {
  body: [14, 24], h3: [16, 32], h2: [20, 44], h1: [24, 60],
};

interface StoredPrefs {
  fontSize: DocFontSizes | null;
  font: DocFontKey;
}

const STORAGE_KEY = "doc_reading_prefs";
const EMPTY: StoredPrefs = { fontSize: null, font: "inherit" };

function read(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<StoredPrefs>;
    return {
      fontSize: p.fontSize ?? null,
      font: p.font ?? "inherit",
    };
  } catch {
    return EMPTY;
  }
}

export function useDocReadingPrefs() {
  const [prefs, setPrefs] = useState<StoredPrefs>(read);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    if (prefs.font !== "inherit") loadWebFont(prefs.font);
  }, [prefs]);

  const setFontSize = useCallback((next: DocFontSizes) => {
    setPrefs((p) => ({ ...p, fontSize: next }));
  }, []);

  const setFont = useCallback((font: DocFontKey) => {
    setPrefs((p) => ({ ...p, font }));
  }, []);

  /** 개인 설정 해제 — 문서에 저장된 값으로 되돌아간다. */
  const reset = useCallback(() => setPrefs(EMPTY), []);

  return {
    /** null 이면 문서 값을 쓰라는 뜻 */
    fontSize: prefs.fontSize,
    font: prefs.font,
    /** 기본값 버튼 활성화 판단용 */
    isCustom: prefs.fontSize !== null || prefs.font !== "inherit",
    setFontSize,
    setFont,
    reset,
  };
}

/**
 * 슬라이더 한 단계를 바꿀 때 나머지 단계를 밀어올리거나 끌어내려 항상
 * body < h3 < h2 < h1 순서를 유지한다. (본문이 헤더보다 커지는 역전 방지)
 */
export function adjustFontSizes(
  current: DocFontSizes,
  key: keyof DocFontSizes,
  val: number,
): DocFontSizes {
  const [lo, hi] = DOC_FS_RANGE[key];
  const v = Math.max(lo, Math.min(hi, Math.round(val)));
  const next: DocFontSizes = { ...current, [key]: v };
  const ORDER: (keyof DocFontSizes)[] = ["body", "h3", "h2", "h1"];
  const idx = ORDER.indexOf(key);
  for (let i = idx + 1; i < ORDER.length; i++) {
    const prevKey = ORDER[i - 1];
    if (next[ORDER[i]] <= next[prevKey]) next[ORDER[i]] = next[prevKey] + 1;
  }
  for (let i = idx - 1; i >= 0; i--) {
    const upper = ORDER[i + 1];
    if (next[ORDER[i]] >= next[upper]) next[ORDER[i]] = next[upper] - 1;
  }
  return next;
}
