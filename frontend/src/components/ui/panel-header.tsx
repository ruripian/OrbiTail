import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  /** 제목 우측, 닫기 전 위치 액션 */
  actions?: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

/** 문서/이슈 우측 패널 공통 헤더 — 제목 + 액션 + 닫기 */
export function PanelHeader({ title, actions, onClose, className }: Props) {
  return (
    <div className={cn("flex items-center justify-between px-3 h-11 border-b shrink-0", className)}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="flex items-center gap-1">
        {actions}
        {onClose && (
          <button
            onClick={onClose}
            className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
