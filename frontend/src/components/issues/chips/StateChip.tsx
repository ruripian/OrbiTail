import type { State } from "@/types";

/** 상태 — 컬러 dot + 이름. */
export function StateChip({ state }: { state: State }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: state.color }} />
      <span className="truncate">{state.name}</span>
    </span>
  );
}
