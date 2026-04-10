/**
 * 글로벌 Undo 스택 — 모든 페이지에서 Cmd/Ctrl+Z로 마지막 작업 되돌리기.
 *
 * 사용 패턴:
 *   1) mutation onSuccess에서 push() 호출
 *   2) push 시 undo 콜백을 함께 등록 — 콜백은 역연산을 수행 (이전 값으로 되돌리기 등)
 *   3) Cmd/Ctrl+Z → 가장 최근 항목을 pop 하여 undo 콜백 실행
 *
 * 구현 노트:
 *   - 스택은 메모리 전용. 새로고침/페이지 이동 시 사라짐 (의도적 — 시간이 지난 변경을
 *     되돌리는 것은 위험하고 캐시/네트워크 일관성 보장이 어려움).
 *   - 최대 50개 항목 유지. 초과 시 오래된 것 부터 drop.
 */

import { create } from "zustand";

export interface UndoEntry {
  /** 사용자에게 보여줄 짧은 라벨 (예: "이슈 상태 변경") */
  label: string;
  /** 실제 역연산 수행 — async 가능. 성공 여부는 undo 자체에서 toast 처리 */
  undo: () => void | Promise<void>;
  /** 등록된 시각 (ms) — 최근순 정렬용 */
  ts: number;
}

interface UndoState {
  stack: UndoEntry[];
  push: (entry: Omit<UndoEntry, "ts">) => void;
  popAndRun: () => Promise<UndoEntry | null>;
  clear: () => void;
}

const MAX_STACK = 50;

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  push: (entry) => {
    set((s) => {
      const next = [...s.stack, { ...entry, ts: Date.now() }];
      if (next.length > MAX_STACK) next.splice(0, next.length - MAX_STACK);
      return { stack: next };
    });
  },
  popAndRun: async () => {
    const stack = get().stack;
    if (stack.length === 0) return null;
    const top = stack[stack.length - 1];
    set({ stack: stack.slice(0, -1) });
    try {
      await top.undo();
    } catch {
      /* undo 실패는 호출자가 처리 (이미 stack에서 제거됨) */
    }
    return top;
  },
  clear: () => set({ stack: [] }),
}));
