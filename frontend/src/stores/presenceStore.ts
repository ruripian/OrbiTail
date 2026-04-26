/**
 * Presence store — 워크스페이스에 현재 접속 중인 사용자 목록 (PASS10).
 *
 * useWebSocket 이 서버의 presence.update 이벤트를 수신하면 setUsers 호출.
 * PresenceStack 컴포넌트가 이 store 를 구독해 TopBar 우측에 아바타 stack 렌더.
 */
import { create } from "zustand";

export interface PresenceUser {
  id: string;
  display_name: string;
  avatar: string | null;
}

interface PresenceState {
  users: PresenceUser[];
  setUsers: (users: PresenceUser[]) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  users: [],
  setUsers: (users) => set({ users }),
  clear: () => set({ users: [] }),
}));
