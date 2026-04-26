/**
 * Presence store — scope 별 접속 중 사용자 목록.
 *
 * scope key 예시:
 *   - null              : 워크스페이스 전역 (현재 UI 사용 안 함, 호환용)
 *   - "project:<id>"    : 프로젝트 페이지 단위 presence
 *   - "document:<id>"   : 문서 단위 (Yjs awareness 가 별도라 일반적으로 사용 안 함)
 *
 * useWebSocket 이 서버 presence.update 수신 시 setScopeUsers 호출.
 * PresenceStack 컴포넌트가 scope 키로 구독해 표시.
 */
import { create } from "zustand";

export interface PresenceUser {
  id: string;
  display_name: string;
  avatar: string | null;
}

interface PresenceState {
  /* scope key("project:<id>" 등) → 접속자 배열. null scope 는 "global" 키로 저장. */
  byScope: Record<string, PresenceUser[]>;
  setScopeUsers: (scope: string | null, users: PresenceUser[]) => void;
  /** 호환 — 기존 setUsers 는 전역 scope 로 매핑 */
  setUsers: (users: PresenceUser[]) => void;
  /** 호환 */
  users: PresenceUser[];
  clear: () => void;
}

const GLOBAL_KEY = "__global__";

export const usePresenceStore = create<PresenceState>((set, get) => ({
  byScope: {},
  users: [],
  setScopeUsers: (scope, users) =>
    set((s) => ({
      byScope: { ...s.byScope, [scope ?? GLOBAL_KEY]: users },
      users: scope ? s.users : users,
    })),
  setUsers: (users) => get().setScopeUsers(null, users),
  clear: () => set({ byScope: {}, users: [] }),
}));

/* 빈 배열 stable reference — 매 렌더마다 새 [] 를 반환하면 zustand 가 변경으로 보고
   무한 리렌더(React #185) 가 발생한다. */
const EMPTY: PresenceUser[] = [];

/** 특정 scope 의 사용자만 셀렉트. */
export function selectScopeUsers(scope: string | null) {
  return (s: PresenceState) => s.byScope[scope ?? GLOBAL_KEY] ?? EMPTY;
}
