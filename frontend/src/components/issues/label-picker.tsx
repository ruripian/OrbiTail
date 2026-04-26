import { ChevronDown, Check, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Label } from "@/types";

/**
 * LabelPicker — 이슈 라벨 다중 선택 드롭다운 (인라인 편집용)
 *
 * 재사용: TableView, IssueDetailPage 등 라벨을 인라인 변경하는 모든 곳
 *
 * 사용:
 *   <LabelPicker
 *     labels={labels}
 *     currentIds={issue.label}
 *     currentDetails={issue.label_details}
 *     onChange={(ids) => updateMutation.mutate({ label: ids })}
 *   />
 */

interface Props {
  labels:          Label[];
  currentIds:      string[];
  /** 표시용 상세 — 없으면 labels에서 조회 */
  currentDetails?: Label[] | null;
  onChange:        (ids: string[]) => void;
  className?:      string;
}

export function LabelPicker({ labels, currentIds, currentDetails, onChange, className }: Props) {
  const { t } = useTranslation();
  const details: Label[] =
    currentDetails ?? labels.filter((l) => currentIds.includes(l.id));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`${t("issues.detail.meta.label")} (${details.length})`}
          aria-haspopup="menu"
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-muted/60 transition-colors w-full min-h-[28px] overflow-hidden",
            className,
          )}
        >
          {details.length === 0 ? (
            <>
              <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
              <span className="text-muted-foreground/40 flex-1 text-left">—</span>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-1 flex-1 overflow-hidden">
              {details.slice(0, 2).map((l) => (
                <span
                  key={l.id}
                  className="rounded-full px-2 py-0.5 text-2xs leading-none shrink-0"
                  style={{ background: l.color + "22", color: l.color }}
                >
                  {l.name}
                </span>
              ))}
              {details.length > 2 && (
                <span className="text-muted-foreground text-2xs shrink-0">
                  +{details.length - 2}
                </span>
              )}
            </div>
          )}
          <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground/60 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48 rounded-xl p-1.5" onClick={(e) => e.stopPropagation()}>
        {labels.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-1.5">{t("issues.picker.noLabels")}</p>
        ) : (
          labels.map((l) => {
            const selected = currentIds.includes(l.id);
            return (
              <DropdownMenuItem
                key={l.id}
                className="gap-2 rounded-lg text-xs cursor-pointer"
                onSelect={(e) => {
                  /* onSelect는 기본으로 닫는데, 다중 선택을 위해 닫힘 방지 */
                  e.preventDefault();
                  const next = selected
                    ? currentIds.filter((id) => id !== l.id)
                    : [...currentIds, l.id];
                  onChange(next);
                }}
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                <span className="flex-1 truncate">{l.name}</span>
                {selected && <Check className="h-3 w-3 text-primary shrink-0" />}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
