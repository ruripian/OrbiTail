import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import i18n from "@/lib/i18n";
import { queryClient } from "@/lib/query-client";
import {
  AUTH_PERSIST_KEY,
  clearTokens,
  getActiveStorage,
  setRemember,
  setTokens,
} from "@/lib/token-storage";
import type { User } from "@/types";

/* persist 도 토큰과 같은 저장소를 쓴다 — remember 해제 시 user 스냅샷만 localStorage 에
   남아 "유저는 있는데 토큰은 없는" 반쪽 상태로 복원되는 것을 막는다. */
const authPersistStorage: StateStorage = {
  getItem: (name) => getActiveStorage().getItem(name),
  setItem: (name, value) => {
    const active = getActiveStorage();
    active.setItem(name, value);
    (active === localStorage ? sessionStorage : localStorage).removeItem(name);
  },
  removeItem: (name) => {
    localStorage.removeItem(name);
    sessionStorage.removeItem(name);
  },
};

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** 로그아웃이 진행 중인 동안 true. axios interceptor 가 401 처리(refresh/redirect)를 건너뛰는 가드.
     로그아웃 도중 fly-in 응답으로 새 토큰이 갱신되거나 hard reload 가 트리거되는 race 차단용.
     persist 대상 아님 — 페이지 리로드 시 항상 false 로 시작해야 안전. */
  isLoggingOut: boolean;
  /** remember: 로그인 유지 여부. 생략하면 기존 설정을 그대로 따른다 */
  setAuth: (user: User, access: string, refresh: string, remember?: boolean) => void;
  clearAuth: () => void;
  /** 프로필/설정 변경 후 스토어의 user 정보만 갱신 (토큰 유지) */
  updateUser: (user: User) => void;
  /** axios refresh 인터셉터에서 호출 — 새 토큰 저장, user 유지. refresh는 rotation 시에만 전달 */
  updateTokens: (access: string, refresh?: string) => void;
  /** 로그아웃 시작 — handleLogout 가 cancelQueries 후 이 플래그를 켜고, 끝나면 endLogout 호출 */
  beginLogout: () => void;
  endLogout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoggingOut: false,
      setAuth: (user, accessToken, refreshToken, remember) => {
        /* 토큰을 쓰기 전에 설정을 먼저 반영해야 올바른 저장소로 들어간다 */
        if (remember !== undefined) setRemember(remember);
        setTokens(accessToken, refreshToken);
        /* 유저의 언어 설정을 i18n에 즉시 반영 */
        if (user.language && i18n.language !== user.language) i18n.changeLanguage(user.language);
        /* 사용자 전환 — 이전 사용자의 query cache(workspaces/issues 등)를 모두 비워
           새 사용자에게 stale 데이터가 노출되지 않도록 한다. (계정 전환/재로그인 모두 커버) */
        queryClient.clear();
        set({ user, accessToken, refreshToken });
      },
      clearAuth: () => {
        clearTokens();
        /* 로그아웃 시에도 cache 비움 — 다음 로그인 사용자가 빈/타인 데이터를 받지 않게 */
        queryClient.clear();
        set({ user: null, accessToken: null, refreshToken: null });
      },
      updateUser: (user) => set({ user }),
      updateTokens: (access, refresh) => {
        setTokens(access, refresh);
        set((state) => ({
          accessToken: access,
          refreshToken: refresh ?? state.refreshToken,
        }));
      },
      beginLogout: () => set({ isLoggingOut: true }),
      endLogout: () => set({ isLoggingOut: false }),
    }),
    {
      name: AUTH_PERSIST_KEY,
      storage: createJSONStorage(() => authPersistStorage),
      /* isLoggingOut 은 persist 대상에서 제외 — 새로고침 시 항상 false 로 시작 */
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
