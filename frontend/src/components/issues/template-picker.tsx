import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileText, Plus, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { issuesApi } from "@/api/issues";
import { TemplateManageDialog } from "./template-manage-dialog";
import { cn } from "@/lib/utils";
import type { IssueTemplate } from "@/types";

/**
 * PASS4-3bis — TemplatePicker.
 *
 * IssueCreateDialog 안 상단에 노출되는 작은 picker. 템플릿 선택 시 onApply 가
 * 폼 필드를 미리 채운다. footer 의 "관리" 클릭 시 TemplateManageDialog 가 열린다.
 *
 * 검색은 옵션 — 템플릿이 보통 5개 이내라 단순 list 로 충분. 10개 초과 시 검색 필드 추가 검토.
 */
interface Props {
  workspaceSlug: string;
  projectId: string;
  onApply: (tmpl: IssueTemplate) => void;
  className?: string;
}

export function TemplatePicker({ workspaceSlug, projectId, onApply, className }: Props) {
  const { t } = useTranslation();
  const [manageOpen, setManageOpen] = useState(false);
  const [appliedName, setAppliedName] = useState<string | null>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ["templates", workspaceSlug, projectId],
    queryFn: () => issuesApi.templates.list(workspaceSlug, projectId),
  });

  const handleSelect = (tmpl: IssueTemplate) => {
    onApply(tmpl);
    setAppliedName(tmpl.name);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${t("issues.create.template", "템플릿")}: ${appliedName ?? "—"}`}
            aria-haspopup="menu"
            className={cn(
              "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/60 transition-colors text-foreground",
              className,
            )}
          >
            <FileText className="h-3 w-3 text-muted-foreground" />
            <span className="truncate max-w-[160px]">
              {appliedName ?? t("issues.create.template", "템플릿")}
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {templates.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center">
              {t("issues.templates.empty")}
            </div>
          ) : (
            templates.map((tmpl: IssueTemplate) => (
              <DropdownMenuItem
                key={tmpl.id}
                onClick={() => handleSelect(tmpl)}
                className="gap-2 cursor-pointer"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{tmpl.name}</div>
                  {tmpl.title_template && (
                    <div className="text-2xs text-muted-foreground truncate">{tmpl.title_template}</div>
                  )}
                </div>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setManageOpen(true)} className="gap-2 cursor-pointer text-primary">
            {templates.length === 0 ? (
              <>
                <Plus className="h-3.5 w-3.5" />
                {t("issues.templates.create")}
              </>
            ) : (
              <>
                <Settings className="h-3.5 w-3.5" />
                {t("issues.templates.manage", "템플릿 관리")}
              </>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TemplateManageDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
      />
    </>
  );
}
