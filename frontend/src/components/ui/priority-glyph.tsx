import { cn } from "@/lib/utils";
import { PRIORITY_SHAPE, type Priority, type PriorityShape } from "@/constants/priority";

/**
 * PriorityGlyph — 색 + 형태로 5종 우선순위를 식별하는 SVG 글리프.
 *
 * Phase 2.1 — 단일 hue 그라디언트만으로는 5종 구분이 약해서
 * shape(diamond/triangle/circle/ring/dot)을 함께 렌더한다.
 * 색은 var(--priority-*) 토큰을 통해 워크스페이스별 커스터마이즈에 동기화된다.
 */
interface PriorityGlyphProps {
  priority: Priority;
  /** SVG 외곽 size in px. default 12 */
  size?: number;
  className?: string;
  /** aria-label override — 지정하면 role="img"로 노출 */
  label?: string;
}

export function PriorityGlyph({ priority, size = 12, className, label }: PriorityGlyphProps) {
  const shape = PRIORITY_SHAPE[priority];
  const color = `var(--priority-${priority})`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      role={label ? "img" : "presentation"}
      aria-label={label}
      className={cn("shrink-0", className)}
    >
      <Shape shape={shape} color={color} />
    </svg>
  );
}

function Shape({ shape, color }: { shape: PriorityShape; color: string }) {
  switch (shape) {
    case "diamond":
      return <path d="M6 1 L11 6 L6 11 L1 6 Z" fill={color} />;
    case "triangle":
      return <path d="M6 1.5 L11 10 L1 10 Z" fill={color} />;
    case "circle":
      return <circle cx="6" cy="6" r="4.5" fill={color} />;
    case "ring":
      return <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeWidth="1.5" />;
    case "dot":
      return (
        <circle
          cx="6"
          cy="6"
          r="4"
          fill="none"
          stroke={color}
          strokeWidth="1"
          strokeDasharray="1.5 1.5"
        />
      );
  }
}
