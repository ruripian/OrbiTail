import { PriorityGlyph } from "@/components/ui/priority-glyph";
import type { Priority } from "@/types";

/** 우선순위 — glyph + 텍스트. var(--priority-*) 토큰 사용 (workspace brand color 동기화). */
export function PriorityChip({ priority }: { priority: Priority }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium"
      style={{ color: `var(--priority-${priority})` }}
    >
      <PriorityGlyph priority={priority} size={10} />
      {priority === "none" ? "—" : priority}
    </span>
  );
}
