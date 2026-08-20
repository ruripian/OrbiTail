import { useTranslation } from "react-i18next";
import { ChevronDown, Check, Circle, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
 *
 * 필드 전환까지 맡기려면 isField / onSelectField 를 함께 넘긴다.
 * 필드는 "상태 없는 상위 분류"라 상태와 상호 배타이므로, 별도 버튼을 두지 않고
 * 상태 목록의 한 항목으로 제공해 전환 경로를 하나로 통일한다.
 */

interface Props {
  states: State[];
  currentStateId: string | null | undefined;
  /** 현재 state의 상세 정보 (이름/색상 표시용). 없으면 states에서 찾음 */
  currentState?: Pick<State, "name" | "color" | "group"> | null;
  onChange: (stateId: string) => void;
  /** trigger 버튼 추가 클래스 */
  className?: string;
  /** 이 이슈가 필드인지 */
  isField?: boolean;
  /** 주면 목록 끝에 "필드" 항목이 추가된다. 없으면 상태만 고를 수 있다.
   *  상태를 고르면 서버가 is_field 를 해제한다(IssueSerializer.update) — 별도 요청 불필요. */
  onSelectField?: () => void;
}

export function StatePicker({
  states,
  currentStateId,
  currentState,
  onChange,
  className,
  isField = false,
  onSelectField,
}: Props) {
  const { t } = useTranslation();
  /* currentState가 없으면 states 배열에서 조회 */
  const cur = currentState ?? states.find((s) => s.id === currentStateId) ?? null;

  const TriggerIcon = isField ? Sparkles : getStateIcon(cur?.group);
  const triggerColor = isField ? "hsl(var(--primary))" : (cur?.color ?? "#9ca3af");
  const triggerLabel = isField ? t("issues.field.label") : (cur?.name ?? "—");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          aria-label={`${t("issues.detail.meta.state")}: ${triggerLabel}`}
          aria-haspopup="menu"
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-muted/60 transition-colors w-full",
            className,
          )}
        >
          <TriggerIcon className="h-3.5 w-3.5 shrink-0" style={{ color: triggerColor }} />
          <span className="truncate">{triggerLabel}</span>
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
              {!isField && currentStateId === s.id && <Check className="h-3 w-3 ml-auto text-primary" />}
            </DropdownMenuItem>
          );
        })}

        {onSelectField && (
          <>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              className="gap-2 rounded-lg text-xs cursor-pointer"
              onClick={onSelectField}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              {t("issues.field.label")}
              <span className="text-2xs text-muted-foreground/70">{t("issues.field.hint")}</span>
              {isField && <Check className="h-3 w-3 ml-auto text-primary" />}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
