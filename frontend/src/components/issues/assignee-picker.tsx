import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { cn } from "@/lib/utils";
import type { WorkspaceMember, User } from "@/types";

/**
 * AssigneePicker — 이슈 담당자 멀티셀렉트 드롭다운 (인라인 편집용)
 *
 * 재사용: TableView, TimelineView, IssueDetailPage 등 담당자를 인라인 변경하는 모든 곳
 *
 * 사용:
 *   <AssigneePicker
 *     members={wsMembers}
 *     currentIds={issue.assignees}
 *     currentDetails={issue.assignee_details}
 *     onChange={(ids) => updateMutation.mutate({ assignees: ids })}
 *   />
 */

interface Props {
  members: WorkspaceMember[];
  currentIds: string[];
  /** 현재 담당자 User 상세 목록 — 이름 표시용. 없으면 members에서 조회 */
  currentDetails?: User[] | null;
  onChange: (ids: string[]) => void;
  /** trigger 버튼 추가 클래스 */
  className?: string;
  /** trigger에 ChevronDown 아이콘 표시 (기본 true) */
  showChevron?: boolean;
}

export function AssigneePicker({
  members, currentIds, currentDetails, onChange, className, showChevron = true,
}: Props) {
  /* 담당자 이름을 표시용으로 조회 — currentIds가 undefined면 빈 배열로 방어 */
  const ids = currentIds ?? [];
  const details: User[] = currentDetails ?? members
    .filter((m) => ids.includes(m.member.id))
    .map((m) => m.member);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-muted/60 transition-colors w-full min-h-[28px] overflow-hidden",
            className,
          )}
        >
          {details.length === 0 ? (
            <span className="text-muted-foreground/50">—</span>
          ) : (
            <div className="flex items-center gap-1.5 overflow-hidden w-full">
              <div className="flex -space-x-1 shrink-0">
                {details.slice(0, 3).map((u) => (
                  <AvatarInitials key={u.id} name={u.display_name} size="xs" ring title={u.display_name} />
                ))}
                {details.length > 3 && (
                  <span className="h-5 w-5 rounded-full bg-muted text-3xs flex items-center justify-center border-2 border-background text-muted-foreground shrink-0">
                    +{details.length - 3}
                  </span>
                )}
              </div>
              <span className="truncate flex-1 text-left text-xs font-medium text-foreground">
                {details.map((u) => u.display_name).join(", ")}
              </span>
            </div>
          )}
          {showChevron && <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground shrink-0" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48 rounded-xl p-1.5" onClick={(e) => e.stopPropagation()}>
        {members.map((m) => {
          const selected = ids.includes(m.member.id);
          return (
            <DropdownMenuItem
              key={m.member.id}
              className="gap-2 rounded-lg text-xs cursor-pointer"
              onClick={() => {
                const next = selected
                  ? ids.filter((x) => x !== m.member.id)
                  : [...ids, m.member.id];
                onChange(next);
              }}
            >
              <AvatarInitials name={m.member.display_name} size="xs" />
              <span className="flex-1 truncate">{m.member.display_name}</span>
              {selected && <Check className="h-3 w-3 text-primary shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
