import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { settingsApi } from "@/api/settings";

/* 보기 설정 — 사용자 선호 글자 크기/폰트 패밀리. 즉시 :root 적용 + 백엔드 debounce 저장. */

export type FontFamilyKey = "pretendard" | "system" | "noto" | "nanum-gothic" | "nanum-myeongjo";
export type FontMonoKey = "jetbrains" | "d2coding" | "system";

const FONT_SANS: Record<FontFamilyKey, string> = {
  pretendard: '"Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  noto: '"Noto Sans KR", "Pretendard", -apple-system, sans-serif',
  "nanum-gothic": '"Nanum Gothic", "Pretendard", -apple-system, sans-serif',
  "nanum-myeongjo": '"Nanum Myeongjo", "Pretendard", serif',
};

const FONT_MONO: Record<FontMonoKey, string> = {
  jetbrains: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
  d2coding: '"D2Coding", "JetBrains Mono", ui-monospace, monospace',
  system: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
};

export const FONT_SANS_LABELS: Array<{ value: FontFamilyKey; label: string }> = [
  { value: "pretendard", label: "Pretendard (기본)" },
  { value: "system", label: "시스템" },
  { value: "noto", label: "Noto Sans KR" },
  { value: "nanum-gothic", label: "나눔고딕" },
  { value: "nanum-myeongjo", label: "나눔명조" },
];

export const FONT_MONO_LABELS: Array<{ value: FontMonoKey; label: string }> = [
  { value: "jetbrains", label: "JetBrains Mono (기본)" },
  { value: "d2coding", label: "D2Coding" },
  { value: "system", label: "시스템" },
];

/* 한글 웹폰트 — 필요할 때만 로드. 한 번만 <link> 추가 */
const LOADED_LINKS = new Set<string>();
function loadWebFont(key: FontFamilyKey | FontMonoKey) {
  const href: string | null = (() => {
    switch (key) {
      case "noto":            return "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap";
      case "nanum-gothic":    return "https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&display=swap";
      case "nanum-myeongjo":  return "https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700&display=swap";
      case "d2coding":        return "https://cdn.jsdelivr.net/gh/joungkyun/font-d2coding/d2coding.css";
      default: return null;
    }
  })();
  if (!href || LOADED_LINKS.has(href)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  LOADED_LINKS.add(href);
}

export interface ViewSettingsState {
  fontScale: number;          // 0.8 ~ 1.4
  fontFamily: FontFamilyKey;
  fontMono: FontMonoKey;
}

const DEFAULT_STATE: ViewSettingsState = {
  fontScale: 1.0,
  fontFamily: "pretendard",
  fontMono: "jetbrains",
};

function readLocal(): ViewSettingsState {
  try {
    const raw = localStorage.getItem("view_settings");
    if (!raw) return DEFAULT_STATE;
    const p = JSON.parse(raw);
    return {
      fontScale: clampScale(p.fontScale ?? DEFAULT_STATE.fontScale),
      fontFamily: (p.fontFamily ?? DEFAULT_STATE.fontFamily) as FontFamilyKey,
      fontMono: (p.fontMono ?? DEFAULT_STATE.fontMono) as FontMonoKey,
    };
  } catch {
    return DEFAULT_STATE;
  }
}
function clampScale(v: number) {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.8, Math.min(1.4, v));
}

function applyToRoot(s: ViewSettingsState) {
  const root = document.documentElement;
  root.style.setProperty("--app-font-scale", String(s.fontScale));
  root.style.setProperty("--font-sans", FONT_SANS[s.fontFamily] ?? FONT_SANS.pretendard);
  root.style.setProperty("--font-mono", FONT_MONO[s.fontMono] ?? FONT_MONO.jetbrains);
  loadWebFont(s.fontFamily);
  loadWebFont(s.fontMono);
}

interface ViewSettingsCtx extends ViewSettingsState {
  setFontScale: (v: number) => void;
  setFontFamily: (v: FontFamilyKey) => void;
  setFontMono: (v: FontMonoKey) => void;
  reset: () => void;
}

const Ctx = createContext<ViewSettingsCtx | null>(null);

export function ViewSettingsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ViewSettingsState>(() => readLocal());
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 로그인 시 서버 값이 있으면 우선 적용 — localStorage는 비로그인 시 fallback */
  useEffect(() => {
    if (!user) return;
    const next: ViewSettingsState = {
      fontScale: clampScale(user.ui_font_scale ?? DEFAULT_STATE.fontScale),
      fontFamily: (user.ui_font_family as FontFamilyKey) || DEFAULT_STATE.fontFamily,
      fontMono: (user.ui_font_mono as FontMonoKey) || DEFAULT_STATE.fontMono,
    };
    setState(next);
  }, [user?.id]);

  useEffect(() => {
    applyToRoot(state);
    localStorage.setItem("view_settings", JSON.stringify(state));
  }, [state]);

  /* 서버 저장 debounce — 슬라이더 드래그 중 중간값 전송 방지 */
  const persist = useCallback((next: ViewSettingsState) => {
    if (!user) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await settingsApi.updatePreferences({
          ui_font_scale: next.fontScale,
          ui_font_family: next.fontFamily,
          ui_font_mono: next.fontMono,
        });
        updateUser(updated);
      } catch {
        /* 조용히 실패 — localStorage에는 이미 저장됨 */
      }
    }, 400);
  }, [user, updateUser]);

  const commit = useCallback((patch: Partial<ViewSettingsState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, [persist]);

  const value: ViewSettingsCtx = {
    ...state,
    setFontScale: (v) => commit({ fontScale: clampScale(v) }),
    setFontFamily: (v) => commit({ fontFamily: v }),
    setFontMono: (v) => commit({ fontMono: v }),
    reset: () => commit(DEFAULT_STATE),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useViewSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useViewSettings must be used within ViewSettingsProvider");
  return v;
}
