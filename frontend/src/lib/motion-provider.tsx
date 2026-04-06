/**
 * 애니메이션 모드 프로바이더
 *
 * 모드:
 *   - "rich":    풍부한 애니메이션 (spring, stagger, 페이지 전환 등)
 *   - "minimal": 최소 애니메이션 (즉시 전환, 기본 transition만)
 *
 * body에 data-motion="rich" | "minimal" 속성을 설정하고,
 * framer-motion의 transition 기본값을 모드에 따라 변경합니다.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type MotionMode = "rich" | "minimal";

interface MotionContextValue {
  mode: MotionMode;
  setMode: (mode: MotionMode) => void;
  /** rich 모드일 때만 true — 조건부 애니메이션에 활용 */
  isRich: boolean;
  /** 모드에 따른 spring transition */
  spring: { type: "spring"; stiffness: number; damping: number; mass: number } | { duration: number };
  /** 모드에 따른 fade transition */
  fade: { duration: number };
  /** stagger delay (rich: 0.05s, minimal: 0) */
  staggerDelay: number;
}

const STORAGE_KEY = "orbitail_motion_mode";

const MotionContext = createContext<MotionContextValue>({
  mode: "rich",
  setMode: () => {},
  isRich: true,
  spring: { type: "spring", stiffness: 300, damping: 25, mass: 0.8 },
  fade: { duration: 0.2 },
  staggerDelay: 0.05,
});

export function MotionProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<MotionMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved === "minimal" ? "minimal" : "rich") as MotionMode;
  });

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
    spring: isRich
      ? { type: "spring", stiffness: 300, damping: 25, mass: 0.8 }
      : { duration: 0.1 },
    fade: { duration: isRich ? 0.2 : 0.05 },
    staggerDelay: isRich ? 0.05 : 0,
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
