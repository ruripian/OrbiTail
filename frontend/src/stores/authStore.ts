import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "@/lib/i18n";
import { queryClient } from "@/lib/query-client";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: User, access: string, refresh: string) => void;
  clearAuth: () => void;
  /** 프로필/설정 변경 후 스토어의 user 정보만 갱신 (토큰 유지) */
  updateUser: (user: User) => void;
  /** axios refresh 인터셉터에서 호출 — 새 토큰 저장, user 유지. refresh는 rotation 시에만 전달 */
  updateTokens: (access: string, refresh?: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) => {
        localStorage.setItem("access_token", accessToken);
        localStorage.setItem("refresh_token", refreshToken);
        /* 유저의 언어 설정을 i18n에 즉시 반영 */
        if (user.language && i18n.language !== user.language) i18n.changeLanguage(user.language);
        /* 사용자 전환 — 이전 사용자의 query cache(workspaces/issues 등)를 모두 비워
           새 사용자에게 stale 데이터가 노출되지 않도록 한다. (계정 전환/재로그인 모두 커버) */
        queryClient.clear();
        set({ user, accessToken, refreshToken });
      },
      clearAuth: () => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        /* 로그아웃 시에도 cache 비움 — 다음 로그인 사용자가 빈/타인 데이터를 받지 않게 */
        queryClient.clear();
        set({ user: null, accessToken: null, refreshToken: null });
      },
      updateUser: (user) => set({ user }),
      updateTokens: (access, refresh) => {
        localStorage.setItem("access_token", access);
        if (refresh) {
          localStorage.setItem("refresh_token", refresh);
        }
        set((state) => ({
          accessToken: access,
          refreshToken: refresh ?? state.refreshToken,
        }));
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      /* 스토리지에서 복원 시 유저 언어 설정 i18n에 반영 */
      onRehydrateStorage: () => (state) => {
        if (state?.user?.language && i18n.language !== state.user.language) {
          i18n.changeLanguage(state.user.language);
        }
      },
    }
  )
);
