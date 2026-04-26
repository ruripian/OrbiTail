import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * EmptyState — 리스트/뷰가 비어있을 때 보여주는 표준 패턴 (Phase 2.7).
 *
 * 기본 아이콘은 작은 정적 SVG 행성(Orbit 메타포 재사용). 페이지/리스트별
 * 분위기에 맞는 lucide 아이콘을 props로 주입할 수 있다.
 *
 * 사용:
 *   <EmptyState title="요청이 없습니다" description="새 요청을 받으면 여기에 표시됩니다" />
 *   <EmptyState icon={<FileText />} title="..." cta={<Button>...</Button>} />
 */
export interface EmptyStateProps {
  /** 상단 아이콘 영역. undefined면 기본 OrbitGlyph */
  icon?: ReactNode;
  title: string;
  description?: string;
  cta?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, cta, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center px-6 py-12 gap-4", className)}>
      <div className="text-muted-foreground/70">
        {icon ?? <OrbitGlyph />}
      </div>
      <div className="space-y-1.5 max-w-sm">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      {cta && <div className="pt-1">{cta}</div>}
    </div>
  );
}

/** 작은 정적 행성 — 큰 OrbitTail 애니메이션의 "조용한" variant */
function OrbitGlyph() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden>
      {/* outer orbit ring */}
      <ellipse
        cx="22" cy="22" rx="18" ry="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.5"
        transform="rotate(-20 22 22)"
      />
      {/* planet */}
      <circle cx="22" cy="22" r="6" fill="currentColor" opacity="0.85" />
      {/* moon */}
      <circle cx="36" cy="18" r="2" fill="currentColor" opacity="0.7" />
    </svg>
  );
}
