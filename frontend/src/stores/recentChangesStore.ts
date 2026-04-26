/**
 * 최근 변경 이슈 store (Phase 3.4 — WebSocket pulse strip).
 *
 * 다른 사용자가 이슈를 변경하면 useWebSocket이 markChanged()를 호출.
 * 5초간 해당 issueId가 "최근 변경" 상태로 유지되고, IssueRow/보드 카드는
 * data-recently-changed 속성을 받아 좌측 strip + 펄스 애니메이션을 표시.
 *
 * 5초 후 자동으로 store에서 제거 → 컴포넌트 리렌더 → strip 자연스럽게 사라짐.
 */

import { create } from "zustand";

const TTL_MS = 5_000;

interface RecentEntry {
  /** 변경자 색상(hsl/hex/css color) — strip 색상으로 사용. 미상이면 var(--accent) fallback */
  color?: string;
  /** 만료 timestamp (ms) — 이 시점까지 strip 유지 */
  expiresAt: number;
}

interface RecentChangesState {
  /** issueId → RecentEntry */
  recent: Record<string, RecentEntry>;
  /** WebSocket 이벤트 수신 시 호출 */
  markChanged: (issueId: string, color?: string) => void;
  /** 컴포넌트가 selector로 호출 */
  isRecent: (issueId: string) => boolean;
  /** strip 색상 (없으면 undefined → CSS fallback) */
  getColor: (issueId: string) => string | undefined;
}

export const useRecentChangesStore = create<RecentChangesState>((set, get) => ({
  recent: {},

  markChanged: (issueId, color) => {
    const expiresAt = Date.now() + TTL_MS;
    set((s) => ({ recent: { ...s.recent, [issueId]: { color, expiresAt } } }));
    // 만료 시각에 정확히 제거 — 단일 setTimeout, 갱신될 때마다 새 timer 생기지만 관리 비용 낮음.
    setTimeout(() => {
      const entry = get().recent[issueId];
      if (!entry || entry.expiresAt > Date.now()) return;
      set((s) => {
        const next = { ...s.recent };
        delete next[issueId];
        return { recent: next };
      });
    }, TTL_MS + 50);
  },

  isRecent: (issueId) => {
    const entry = get().recent[issueId];
    return !!entry && entry.expiresAt > Date.now();
  },

  getColor: (issueId) => get().recent[issueId]?.color,
}));
