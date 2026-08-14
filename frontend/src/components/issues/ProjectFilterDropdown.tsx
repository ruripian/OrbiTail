import { useTranslation } from "react-i18next";
import { Check, FolderOpen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectIcon } from "@/components/ui/project-icon-picker";
import { cn } from "@/lib/utils";

/**
 * ProjectFilterDropdown — 다중 프로젝트 통합 뷰의 프로젝트 필터
 *
 * 재사용: 워크스페이스 홈, 마이 캘린더, 마이 그래프 등 여러 프로젝트를 한 화면에 모으는 모든 곳
 *
 * selected 시맨틱:
 *   null      = 전체 표시(필터 없음)
 *   Set<id>   = 명시적으로 선택된 프로젝트만
 * 전부 선택된 Set 은 내부에서 null 로 정규화한다 — "전체" 상태를 표현하는 방법을 하나로 유지해
 * 호출부가 localStorage 에 저장할 때도 같은 규칙을 따르도록 하기 위함.
 *
 * 사용:
 *   <ProjectFilterDropdown
 *     projects={uniqueProjects}
 *     selected={selectedProjects}
 *     onChange={setSelectedProjects}
 *   />
 */

export interface ProjectFilterItem {
  id: string;
  name: string;
  icon_prop?: Record<string, unknown> | null;
}

interface Props {
  /** 필터 후보 — 화면에 실제 등장한 프로젝트만 넘긴다 */
  projects: ProjectFilterItem[];
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
  align?: "start" | "end";
  /** 트리거 버튼 추가 클래스 (높이 등) */
  className?: string;
}

export function ProjectFilterDropdown({ projects, selected, onChange, align = "start", className }: Props) {
  const { t } = useTranslation();

  /* 필터할 대상이 하나뿐이면 필터가 의미 없다 */
  if (projects.length <= 1) return null;

  const toggle = (id: string) => {
    /* null(전체)에서 첫 토글 시 — 그 항목만 빼고 나머지 다 선택된 Set 으로 시작 */
    const base = selected ?? new Set(projects.map((p) => p.id));
    const next = new Set(base);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next.size === projects.length ? null : next);
  };

  const label = t("projectFilter.label", "프로젝트");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t("projectFilter.title", "프로젝트 필터")}
          className={cn(
            "h-7 px-2.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition-colors",
            selected === null
              ? "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
              : "bg-primary/10 border-primary/40 text-primary",
            className,
          )}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {selected === null ? label : `${label} ${selected.size}/${projects.length}`}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-72 overflow-y-auto w-56">
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onChange(null); }} className="text-xs">
          {t("projectFilter.selectAll", "전체 선택")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onChange(new Set()); }} className="text-xs">
          {t("projectFilter.clearAll", "전체 해제")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={(e) => { e.preventDefault(); toggle(p.id); }}
            className="text-xs gap-2 cursor-pointer"
          >
            <span className="shrink-0">
              <ProjectIcon value={p.icon_prop} size={10} box={16} />
            </span>
            <span className="truncate flex-1">{p.name || p.id.slice(0, 6)}</span>
            {(selected === null || selected.has(p.id)) && <Check className="h-3 w-3 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
