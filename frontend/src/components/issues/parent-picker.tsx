import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Check, X, Search, GitBranch } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types";

/**
 * ParentPicker — 이슈 상위(parent) 이슈 선택 드롭다운
 *
 * 동작:
 *  - 같은 프로젝트의 모든 이슈 중에서 상위 이슈를 선택
 *  - 자기 자신 + 조상 체인은 선택지에서 제외 (순환 방지)
 *  - 검색 입력으로 제목 필터링
 *  - "제거" 옵션으로 parent = null 설정
 *
 * 사용:
 *   <ParentPicker
 *     issues={projectIssues}
 *     currentIssueId={issue.id}
 *     excludeIds={ancestorIds}
 *     currentParentId={issue.parent}
 *     refPrefix="OUR"
 *     onChange={(id) => updateMutation.mutate({ parent: id })}
 *   />
 */

interface Props {
  issues:          Issue[];
  /** 현재 편집 중인 이슈 id (자기 자신 선택 방지) */
  currentIssueId:  string;
  /** 선택 불가 id 집합 (조상/후손 순환 방지). currentIssueId는 자동 포함 */
  excludeIds?:     string[];
  currentParentId: string | null | undefined;
  /** 참조 prefix (예: "OUR") */
  refPrefix:       string;
  onChange:        (parentId: string | null) => void;
  className?:      string;
}

export function ParentPicker({
  issues, currentIssueId, excludeIds = [], currentParentId, refPrefix, onChange, className,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const excludeSet = useMemo(() => {
    const s = new Set(excludeIds);
    s.add(currentIssueId);
    return s;
  }, [excludeIds, currentIssueId]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues
      .filter((i) => !excludeSet.has(i.id))
      .filter((i) => (q ? i.title.toLowerCase().includes(q) || String(i.sequence_id).includes(q) : true))
      .slice(0, 50); // 성능 보호: 최대 50개
  }, [issues, excludeSet, query]);

  const current = currentParentId ? issues.find((i) => i.id === currentParentId) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs border border-border hover:bg-muted/60 transition-colors w-full min-h-[30px]",
            className,
          )}
        >
          <GitBranch className={cn("h-3.5 w-3.5 shrink-0", current ? "text-foreground" : "text-muted-foreground/40")} />
          {current ? (
            <span className="flex items-center gap-1.5 flex-1 overflow-hidden text-left">
              <span className="font-mono text-2xs text-muted-foreground/60 shrink-0">
                {refPrefix}-{current.sequence_id}
              </span>
              <span className="truncate">{current.title}</span>
            </span>
          ) : (
            <span className="flex-1 text-left text-muted-foreground/50">{t("issues.picker.none")}</span>
          )}
          <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 rounded-xl p-1.5" onClick={(e) => e.stopPropagation()}>
        {/* 검색 입력 */}
        <div className="relative mb-1 px-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("issues.picker.searchPlaceholder")}
            className="w-full rounded-md border border-border bg-input/40 pl-7 pr-2 py-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-ring/60"
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>

        {/* 제거 옵션 */}
        <DropdownMenuItem
          className="gap-2 rounded-lg text-xs cursor-pointer"
          onClick={() => onChange(null)}
        >
          <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <span className="flex-1 text-muted-foreground">{t("issues.picker.none")}</span>
          {!currentParentId && <Check className="h-3 w-3 text-primary shrink-0" />}
        </DropdownMenuItem>

        {/* 후보 목록 */}
        <div className="max-h-64 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-2 text-center">
              {t("issues.picker.noResults")}
            </p>
          ) : (
            candidates.map((iss) => (
              <DropdownMenuItem
                key={iss.id}
                className="gap-2 rounded-lg text-xs cursor-pointer"
                onClick={() => onChange(iss.id)}
              >
                <span className="font-mono text-2xs text-muted-foreground/60 shrink-0">
                  {refPrefix}-{iss.sequence_id}
                </span>
                <span className="flex-1 truncate">{iss.title}</span>
                {currentParentId === iss.id && <Check className="h-3 w-3 text-primary shrink-0" />}
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
