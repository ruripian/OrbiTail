/**
 * Density 프로바이더 (Phase 2.6)
 *
 * 모드:
 *   - "compact"     : 한 화면에 더 많이 — root font 13~15px
 *   - "comfortable" : 기본 — root font 14~17px (기존 톤 유지)
 *   - "spacious"    : 호흡감 — root font 16~19px
 *
 * <html>에 data-density 속성을 부여하고, index.css의
 *   html[data-density="..."] { font-size: clamp(...) }
 * 셀렉터가 전역 폰트 스케일을 조정한다 (rem 기반이라 spacing/콤포넌트도 비례).
 *
 * 문서 에디터처럼 항상 comfortable이어야 하는 영역은 자체 div에
 *   data-density="comfortable"
 * 을 부여해 부분적으로 덮어쓴다 (CSS 셀렉터 우선순위로 처리).
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Density = "compact" | "comfortable" | "spacious";

const STORAGE_KEY = "orbitail_density";

interface DensityContextValue {
  density: Density;
  setDensity: (d: Density) => void;
}

const DensityContext = createContext<DensityContextValue>({
  density: "comfortable",
  setDensity: () => {},
});

function readInitial(): Density {
  if (typeof localStorage === "undefined") return "comfortable";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "compact" || saved === "comfortable" || saved === "spacious") return saved;
  return "comfortable";
}

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(readInitial);

  const setDensity = (d: Density) => {
    setDensityState(d);
    localStorage.setItem(STORAGE_KEY, d);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
  }, [density]);

  return (
    <DensityContext.Provider value={{ density, setDensity }}>
      {children}
    </DensityContext.Provider>
  );
}

export function useDensity() {
  return useContext(DensityContext);
}
