import { ChevronDown, Check, Box, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectIcon } from "@/components/ui/project-icon-picker";
import { cn } from "@/lib/utils";
import type { Category } from "@/types";

/**
 * CategoryPicker — 이슈 카테고리 단일 선택 드롭다운 (인라인 편집용)
 *
 * 재사용: TableView, IssueDetailPage 등 카테고리를 인라인 변경하는 모든 곳
 *
 * 사용:
 *   <CategoryPicker
 *     categories={projectCategories}
 *     currentId={issue.category}
 *     onChange={(id) => updateMutation.mutate({ category: id })}
 *   />
 */

interface Props {
  categories:   Pick<Category, "id" | "name" | "icon_prop">[];
  currentId: string | null | undefined;
  onChange:  (categoryId: string | null) => void;
  className?: string;
  /** 하위 이슈는 상위의 모듈을 따라가므로 비활성화할 수 있음 */
  disabled?: boolean;
  disabledReason?: string;
}

export function CategoryPicker({ categories, currentId, onChange, className, disabled, disabledReason }: Props) {
  const { t } = useTranslation();
  const cur = currentId ? categories.find((m) => m.id === currentId) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          onClick={(e) => e.stopPropagation()}
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-muted/60 transition-colors w-full min-h-[28px]",
            disabled && "opacity-60 cursor-not-allowed hover:bg-transparent",
            className,
          )}
        >
          {cur ? (
            <ProjectIcon value={cur.icon_prop} size={12} className="!w-4 !h-4" />
          ) : (
            <Box className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
          )}
          <span className={cn("truncate flex-1 text-left", !cur && "text-muted-foreground/40")}>
            {cur?.name ?? "—"}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48 rounded-xl p-1.5" onClick={(e) => e.stopPropagation()}>
        {/* 없음 옵션 */}
        <DropdownMenuItem
          className="gap-2 rounded-lg text-xs cursor-pointer"
          onClick={() => onChange(null)}
        >
          <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <span className="flex-1 text-muted-foreground">{t("issues.picker.none")}</span>
          {!currentId && <Check className="h-3 w-3 text-primary shrink-0" />}
        </DropdownMenuItem>

        {categories.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-1.5">{t("issues.picker.noModules")}</p>
        ) : (
          categories.map((m) => (
            <DropdownMenuItem
              key={m.id}
              className="gap-2 rounded-lg text-xs cursor-pointer"
              onClick={() => onChange(m.id)}
            >
              <ProjectIcon value={m.icon_prop} size={12} className="!w-4 !h-4" />
              <span className="flex-1 truncate">{m.name}</span>
              {currentId === m.id && <Check className="h-3 w-3 text-primary shrink-0" />}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
