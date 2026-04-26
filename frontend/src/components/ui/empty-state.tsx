import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { OrbitGlyph } from "./orbit-glyph";

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
        {icon ?? <OrbitGlyph size={44} />}
      </div>
      <div className="space-y-1.5 max-w-sm">
        {/* Phase 3.2 — display serif (Fraunces fallback Georgia) */}
        <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      {cta && <div className="pt-1">{cta}</div>}
    </div>
  );
}

