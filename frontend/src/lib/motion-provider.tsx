/**
 * 애니메이션 모드 프로바이더
 *
 * 모드:
 *   - "rich":    풍부한 애니메이션 (spring, stagger, 페이지 전환 등)
 *   - "minimal": 최소 애니메이션 (즉시 전환, 기본 transition만)
 *
 * body에 data-motion="rich" | "minimal" 속성을 설정하고,
 * framer-motion의 transition 기본값을 모드에 따라 변경합니다.
 *
 * Phase 1.1 — 저장된 사용자 선호가 없으면 OS 레벨 prefers-reduced-motion을 반영해 minimal로 시작.
 * Phase 1.4 — duration/easing이 index.css의 --motion-* 토큰과 1:1 매핑됨.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type MotionMode = "rich" | "minimal";

/** index.css의 --motion-* 토큰과 동일한 ms 값 (framer-motion은 초 단위 사용) */
const MOTION_FAST_S = 0.12;
const MOTION_BASE_S = 0.22;
/** 토큰 stagger-step: rich 40ms / minimal 0ms */
const STAGGER_STEP_S = 0.04;
/** Phase 1.4 spring (rich): stiffness 400 / damping 32 / mass 0.8 */
const SPRING_RICH = { type: "spring" as const, stiffness: 400, damping: 32, mass: 0.8 };
/** ease-orbit cubic-bezier 값 — index.css와 동일 */
export const EASE_ORBIT: [number, number, number, number] = [0.4, 0.8, 0.2, 1];
export const EASE_SMOOTH: [number, number, number, number] = [0.4, 0, 0.2, 1];
export const EASE_SNAP: [number, number, number, number] = [0.2, 0, 0, 1];

interface MotionContextValue {
  mode: MotionMode;
  setMode: (mode: MotionMode) => void;
  /** rich 모드일 때만 true — 조건부 애니메이션에 활용 */
  isRich: boolean;
  /** 모드에 따른 spring transition */
  spring: typeof SPRING_RICH | { duration: number };
  /** 모드에 따른 fade transition (--motion-base / --motion-fast) */
  fade: { duration: number };
  /** stagger delay 단위 (rich: 0.04s, minimal: 0) */
  staggerDelay: number;
}

const STORAGE_KEY = "orbitail_motion_mode";

/** OS 레벨 reduced-motion 선호 여부 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 초기 모드 결정: 저장값 우선 → OS prefers-reduced-motion → rich */
function resolveInitialMode(): MotionMode {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "minimal" || saved === "rich") return saved;
  }
  return prefersReducedMotion() ? "minimal" : "rich";
}

const MotionContext = createContext<MotionContextValue>({
  mode: "rich",
  setMode: () => {},
  isRich: true,
  spring: SPRING_RICH,
  fade: { duration: MOTION_BASE_S },
  staggerDelay: STAGGER_STEP_S,
});

export function MotionProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<MotionMode>(resolveInitialMode);

  const setMode = (m: MotionMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
  };

  useEffect(() => {
    document.body.setAttribute("data-motion", mode);
  }, [mode]);

  const isRich = mode === "rich";

  const value: MotionContextValue = {
    mode,
    setMode,
    isRich,
    spring: isRich ? SPRING_RICH : { duration: MOTION_FAST_S },
    fade: { duration: isRich ? MOTION_BASE_S : MOTION_FAST_S },
    staggerDelay: isRich ? STAGGER_STEP_S : 0,
  };

  return (
    <MotionContext.Provider value={value}>
      {children}
    </MotionContext.Provider>
  );
}

export function useMotion() {
  return useContext(MotionContext);
}
