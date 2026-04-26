import { useTranslation } from "react-i18next";
import { ChevronDown, Check, Circle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getStateIcon } from "@/constants/state-icons";
import { cn } from "@/lib/utils";
import type { State } from "@/types";

/**
 * StatePicker — 이슈 상태 선택 드롭다운 (인라인 편집용)
 *
 * 재사용: TableView, TimelineView 등 이슈 상태를 인라인 변경하는 모든 곳
 *
 * 사용:
 *   <StatePicker
 *     states={states}
 *     currentStateId={issue.state}
 *     currentState={issue.state_detail}
 *     onChange={(id) => updateMutation.mutate({ state: id })}
 *   />
 */

interface Props {
  states: State[];
  currentStateId: string | null | undefined;
  /** 현재 state의 상세 정보 (이름/색상 표시용). 없으면 states에서 찾음 */
  currentState?: Pick<State, "name" | "color" | "group"> | null;
  onChange: (stateId: string) => void;
  /** trigger 버튼 추가 클래스 */
  className?: string;
}

export function StatePicker({ states, currentStateId, currentState, onChange, className }: Props) {
  const { t } = useTranslation();
  /* currentState가 없으면 states 배열에서 조회 */
  const cur = currentState ?? states.find((s) => s.id === currentStateId) ?? null;
  const StateIcon = getStateIcon(cur?.group);
  const color = cur?.color ?? "#9ca3af";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          aria-label={`${t("issues.detail.meta.state")}: ${cur?.name ?? "—"}`}
          aria-haspopup="menu"
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-muted/60 transition-colors w-full",
            className,
          )}
        >
          <StateIcon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
          <span className="truncate">{cur?.name ?? "—"}</span>
          <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground/60 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48 rounded-xl p-1.5" onClick={(e) => e.stopPropagation()}>
        {states.map((s) => {
          const Icon = getStateIcon(s.group) ?? Circle;
          return (
            <DropdownMenuItem
              key={s.id}
              className="gap-2 rounded-lg text-xs cursor-pointer"
              onClick={() => onChange(s.id)}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: s.color }} />
              {s.name}
              {currentStateId === s.id && <Check className="h-3 w-3 ml-auto text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
