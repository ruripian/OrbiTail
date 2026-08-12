import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { settingsApi } from "@/api/settings";

/* 앱 전역 글꼴 설정 — 사용자 선호 서체/고정폭/글자 배율. 즉시 :root 적용 + 백엔드 debounce 저장.
   계정 단위라 다른 사람 화면에는 영향이 없다.
   문서 본문 한정 글꼴은 hooks/useDocReadingPrefs(로컬 전용) 쪽이다.
   캘린더/타임라인 뷰 옵션인 hooks/useViewSettings 와는 무관하니 혼동 주의. */

export type FontFamilyKey = "pretendard" | "system" | "noto" | "nanum-gothic" | "nanum-myeongjo";
export type FontMonoKey = "jetbrains" | "d2coding" | "system";

export const FONT_SANS: Record<FontFamilyKey, string> = {
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
export function loadWebFont(key: FontFamilyKey | FontMonoKey) {
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

export interface FontSettingsState {
  fontScale: number;          // 0.8 ~ 1.4
  fontFamily: FontFamilyKey;
  fontMono: FontMonoKey;
}

const DEFAULT_STATE: FontSettingsState = {
  fontScale: 1.0,
  fontFamily: "pretendard",
  fontMono: "jetbrains",
};

function readLocal(): FontSettingsState {
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

function applyToRoot(s: FontSettingsState) {
  const root = document.documentElement;
  root.style.setProperty("--app-font-scale", String(s.fontScale));
  root.style.setProperty("--font-sans", FONT_SANS[s.fontFamily] ?? FONT_SANS.pretendard);
  root.style.setProperty("--font-mono", FONT_MONO[s.fontMono] ?? FONT_MONO.jetbrains);
  loadWebFont(s.fontFamily);
  loadWebFont(s.fontMono);
}

interface FontSettingsCtx extends FontSettingsState {
  setFontScale: (v: number) => void;
  setFontFamily: (v: FontFamilyKey) => void;
  setFontMono: (v: FontMonoKey) => void;
  reset: () => void;
}

const Ctx = createContext<FontSettingsCtx | null>(null);

export function FontSettingsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FontSettingsState>(() => readLocal());
  const userId = useAuthStore((s) => s.user?.id);
  const userFontScale = useAuthStore((s) => s.user?.ui_font_scale);
  const userFontFamily = useAuthStore((s) => s.user?.ui_font_family);
  const userFontMono = useAuthStore((s) => s.user?.ui_font_mono);
  const updateUser = useAuthStore((s) => s.updateUser);

  /* 서버에서 받아온 값을 그대로 서버로 되돌려보내지 않기 위한 가드.
     true 인 동안의 state 변화는 "밖에서 들어온 것"이라 저장하지 않는다.
     첫 마운트(localStorage 복원)도 저장 대상이 아니므로 true 로 시작. */
  const fromServer = useRef(true);

  /* 로그인·계정 전환 시 그 계정의 설정을 적용 — localStorage는 비로그인 시 fallback.
     deps 가 userId 뿐인 건 의도적이다. 같은 계정이 유지되는 동안에는 사용자가 방금 바꾼
     값을 서버 응답이 덮어쓰면 안 되기 때문. */
  useEffect(() => {
    if (!userId) return;
    fromServer.current = true;
    setState({
      fontScale: clampScale(userFontScale ?? DEFAULT_STATE.fontScale),
      fontFamily: (userFontFamily as FontFamilyKey) || DEFAULT_STATE.fontFamily,
      fontMono: (userFontMono as FontMonoKey) || DEFAULT_STATE.fontMono,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /* 적용 + 저장. 서버 PATCH 는 state 가 확정된 뒤 400ms debounce —
     effect cleanup 이 이전 타이머를 지우므로 슬라이더 드래그 중 중간값은 전송되지 않는다. */
  useEffect(() => {
    applyToRoot(state);
    localStorage.setItem("view_settings", JSON.stringify(state));

    if (fromServer.current) {
      fromServer.current = false;
      return;
    }
    if (!userId) return;

    const timer = setTimeout(async () => {
      try {
        const updated = await settingsApi.updatePreferences({
          ui_font_scale: state.fontScale,
          ui_font_family: state.fontFamily,
          ui_font_mono: state.fontMono,
        });
        updateUser(updated);
      } catch {
        /* 조용히 실패 — localStorage에는 이미 저장됨 */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [state, userId, updateUser]);

  const commit = useCallback((patch: Partial<FontSettingsState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const value: FontSettingsCtx = {
    ...state,
    setFontScale: (v) => commit({ fontScale: clampScale(v) }),
    setFontFamily: (v) => commit({ fontFamily: v }),
    setFontMono: (v) => commit({ fontMono: v }),
    reset: () => commit(DEFAULT_STATE),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFontSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFontSettings must be used within FontSettingsProvider");
  return v;
}
