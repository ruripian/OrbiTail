import { ChevronDown, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PRIORITY_LABEL_KEY,
  PRIORITY_LIST,
  type Priority,
} from "@/constants/priority";
import { PriorityGlyph } from "@/components/ui/priority-glyph";
import { cn } from "@/lib/utils";

/**
 * PriorityPicker — 이슈 우선순위 선택 드롭다운 (인라인 편집용)
 *
 * 재사용: TableView, TimelineView 등 우선순위를 인라인 변경하는 모든 곳
 *
 * Phase 2.1 — 색만으로 식별하기 어려운 5종을 PriorityGlyph(형태 시그널)로 표시.
 *   색은 var(--priority-X) 토큰을 통해 워크스페이스 커스텀 색에 동기화.
 */

interface Props {
  currentPriority: Priority;
  onChange: (p: Priority) => void;
  className?: string;
}

export function PriorityPicker({ currentPriority, onChange, className }: Props) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-muted/60 transition-colors w-full",
            className,
          )}
          style={{ color: `var(--priority-${currentPriority})` }}
        >
          <PriorityGlyph priority={currentPriority} size={12} />
          <span>{t(PRIORITY_LABEL_KEY[currentPriority])}</span>
          <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground/60 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-40 rounded-xl p-1.5" onClick={(e) => e.stopPropagation()}>
        {PRIORITY_LIST.map((p) => (
          <DropdownMenuItem
            key={p}
            className="gap-2 rounded-lg text-xs cursor-pointer"
            onClick={() => onChange(p)}
            style={{ color: `var(--priority-${p})` }}
          >
            <PriorityGlyph priority={p} size={12} />
            <span>{t(PRIORITY_LABEL_KEY[p])}</span>
            {currentPriority === p && <Check className="h-3 w-3 ml-auto text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
