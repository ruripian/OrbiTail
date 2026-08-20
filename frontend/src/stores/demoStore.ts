import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DemoState {
  /** 데모 세션으로 들어와 있는지 */
  isDemo: boolean;
  /** 샌드박스 만료 시각 (ISO8601). 배지에서 남은 시간 표시에 쓴다 */
  expiresAt: string | null;
  startDemo: (expiresAt: string) => void;
  clearDemo: () => void;
}

/** 데모 세션 상태.
 *  authStore 와 분리한 이유: 로그아웃(clearAuth)과 데모 종료의 시점이 달라서,
 *  한 스토어에 묶으면 새로고침 시 배지만 남거나 반대로 사라지는 어긋남이 생긴다. */
export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      isDemo: false,
      expiresAt: null,
      startDemo: (expiresAt) => set({ isDemo: true, expiresAt }),
      clearDemo: () => set({ isDemo: false, expiresAt: null }),
    }),
    { name: "demo-storage" }
  )
);
