import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Check, Search, ChevronDown } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { User } from "@/types";

/**
 * UserPicker — "사용자 지정"의 단일 재사용 컴포넌트.
 *
 * 이슈 담당자 배정, 프로젝트/팀 멤버 추가, 이벤트 참여자, 문서 스페이스 참여자 등
 * "사람을 검색해서 고른다"는 모든 곳을 하나로 통일한다. (기존 AssigneePicker /
 * MemberMultiSelect / SearchableMemberAdd 3종을 대체)
 *
 * 축:
 *  - mode      : "single"(고르면 닫힘) | "multi"(토글, 열린 채 유지)
 *  - variant   : "field"(테두리 입력 + 칩, 폼용) | "avatars"(아바타 겹침, 인라인 셀용)
 *  - 검색은 항상 노출. lockedIds(해제 불가) / excludeIds(후보 제외) / getBadge(부가 라벨) 지원.
 *
 * 데이터는 PickableUser[] 로 정규화해서 넘긴다. WorkspaceMember/ProjectMember/TeamMember
 * 처럼 member:User 를 감싼 목록은 membersToUsers() 한 줄로 변환.
 */

export type PickableUser = Pick<User, "id" | "display_name" | "email" | "avatar">;

/** member:User 를 감싼 멤버 목록(WorkspaceMember/ProjectMember/TeamMember)을 PickableUser[]로 정규화 */
export function membersToUsers(list: { member: User }[]): PickableUser[] {
  return list.map((m) => m.member);
}

/** 여러 사용자 목록을 id 기준 중복 제거하며 병합 — 후보(멤버) + 이미 선택된 상세(프로젝트에서 빠진 담당자) 합칠 때 */
export function mergeUsers(...lists: (PickableUser[] | null | undefined)[]): PickableUser[] {
  const seen = new Set<string>();
  const out: PickableUser[] = [];
  for (const list of lists) {
    for (const u of list ?? []) {
      if (u && !seen.has(u.id)) { seen.add(u.id); out.push(u); }
    }
  }
  return out;
}

interface UserPickerProps {
  users: PickableUser[];
  /** 선택된 id 배열 — 단일 선택도 배열로 통일([id] 또는 []) */
  value: string[];
  onChange: (ids: string[]) => void;
  mode?: "single" | "multi";
  variant?: "field" | "avatars";
  /** 해제·제거 불가 고정 id(생성자·리더 등) — 표시는 하되 토글 불가 */
  lockedIds?: string[];
  /** 후보 목록에서 아예 제외할 id(이미 팀원 등) */
  excludeIds?: string[];
  /** 각 id의 부가 라벨("(나)", "★") */
  getBadge?: (id: string) => string | null;
  placeholder?: string;
  /** avatars variant 트리거의 ChevronDown 표시 (기본 true) */
  showChevron?: boolean;
  disabled?: boolean;
  /** 트리거 버튼 추가 클래스 */
  className?: string;
}

export function UserPicker({
  users,
  value,
  onChange,
  mode = "multi",
  variant = "field",
  lockedIds = [],
  excludeIds = [],
  getBadge,
  placeholder,
  showChevron = true,
  disabled = false,
  className,
}: UserPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedIds = useMemo(() => value ?? [], [value]);
  const lockedSet = useMemo(() => new Set(lockedIds), [lockedIds]);
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const byId = useMemo(() => {
    const m = new Map<string, PickableUser>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  /* 팝오버가 열리면 검색창에 포커스 */
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  /* 후보 = 전체 - excludeIds */
  const candidates = useMemo(
    () => users.filter((u) => !excludeSet.has(u.id)),
    [users, excludeSet],
  );

  /* 검색 필터 — 이름/이메일 */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (u) =>
        u.display_name.toLowerCase().includes(q) ||
        (u.email?.toLowerCase().includes(q) ?? false),
    );
  }, [candidates, query]);

  const toggle = (id: string) => {
    if (lockedSet.has(id)) return;
    if (mode === "single") {
      onChange([id]);
      setOpen(false);
      setQuery("");
      return;
    }
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  /* 선택된 사용자 — locked 먼저, 그 다음 일반 */
  const selectedUsers = useMemo(() => {
    const locked: PickableUser[] = [];
    const normal: PickableUser[] = [];
    for (const id of selectedIds) {
      const u = byId.get(id);
      if (!u) continue;
      if (lockedSet.has(id)) locked.push(u);
      else normal.push(u);
    }
    return [...locked, ...normal];
  }, [selectedIds, byId, lockedSet]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
      {variant === "avatars" ? (
        /* ── 인라인 아바타 트리거 (테이블/사이드바 셀) ── */
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
          aria-haspopup="menu"
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-muted/60 transition-colors w-full min-h-[28px] overflow-hidden",
            className,
          )}
        >
          {selectedUsers.length === 0 ? (
            <span className="text-muted-foreground/50">—</span>
          ) : (
            <div className="flex items-center gap-1.5 overflow-hidden w-full">
              <div className="flex -space-x-1 shrink-0">
                {selectedUsers.slice(0, 3).map((u) => (
                  <AvatarInitials key={u.id} name={u.display_name} avatar={u.avatar} size="xs" ring title={u.display_name} />
                ))}
                {selectedUsers.length > 3 && (
                  <span className="h-5 w-5 rounded-full bg-muted text-3xs flex items-center justify-center border-2 border-background text-muted-foreground shrink-0">
                    +{selectedUsers.length - 3}
                  </span>
                )}
              </div>
              <span className="truncate flex-1 text-left text-xs font-medium text-foreground">
                {selectedUsers.map((u) => u.display_name).join(", ")}
              </span>
            </div>
          )}
          {showChevron && <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground shrink-0" />}
        </button>
      ) : (
        /* ── 필드 트리거 (폼·다이얼로그) ── */
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex w-full min-h-9 items-center gap-1.5 flex-wrap rounded-md border border-border bg-input/60 px-2 py-1.5 text-sm text-left transition-colors hover:border-primary/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-ring/60 disabled:opacity-50",
            className,
          )}
        >
          {selectedUsers.length === 0 ? (
            <span className="text-muted-foreground px-1">{placeholder ?? t("common.memberAdd")}</span>
          ) : mode === "single" ? (
            <span className="flex items-center gap-2 truncate px-1">
              <AvatarInitials name={selectedUsers[0].display_name} avatar={selectedUsers[0].avatar} size="xs" />
              {selectedUsers[0].display_name}
            </span>
          ) : (
            selectedUsers.map((u) => {
              const isLocked = lockedSet.has(u.id);
              const badge = getBadge?.(u.id);
              return (
                <span
                  key={u.id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                    isLocked ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                  )}
                >
                  {u.display_name}
                  {badge && <span className="text-2xs opacity-70">{badge}</span>}
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggle(u.id); }}
                      className="hover:text-destructive transition-colors"
                      aria-label={t("common.remove")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              );
            })
          )}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
        </button>
      )}
      </PopoverTrigger>

      {/* ── 팝오버 (검색 + 리스트) — body로 portal되어 테이블 overflow 를 탈출 ── */}
      <PopoverContent
        align="start"
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
        style={variant === "field" ? { width: "var(--radix-popover-trigger-width)" } : undefined}
        className={cn(
          "p-0 rounded-lg border glass shadow-lg overflow-hidden",
          variant === "avatars" && "w-56",
        )}
      >
          {/* 검색창 */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("common.searchByNameOrEmail")}
              autoComplete="off"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* 결과 리스트 */}
          <div className="overflow-y-auto py-1" style={{ maxHeight: 240 }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t("common.noSearchResults")}
              </div>
            ) : (
              filtered.map((u) => {
                const isSelected = selectedSet.has(u.id);
                const isLocked = lockedSet.has(u.id);
                const badge = getBadge?.(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggle(u.id)}
                    disabled={isLocked}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors",
                      isLocked ? "opacity-60 cursor-default" : "hover:bg-muted/50 cursor-pointer",
                    )}
                  >
                    {/* 다중 선택은 체크박스, 단일은 트레일링 체크 */}
                    {mode === "multi" && (
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded border shrink-0",
                          isSelected ? "bg-primary border-primary text-primary-foreground" : "border-border",
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                    )}

                    <AvatarInitials name={u.display_name} avatar={u.avatar} size="sm" />

                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{u.display_name}</span>
                        {badge && <span className="text-2xs text-muted-foreground shrink-0">{badge}</span>}
                      </div>
                      {u.email && <div className="text-2xs text-muted-foreground truncate">{u.email}</div>}
                    </div>

                    {mode === "single" && isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {/* 다중 선택 카운트 */}
          {mode === "multi" && (
            <div className="border-t border-border px-3 py-1.5 text-2xs text-muted-foreground flex items-center justify-between">
              <span>{t("common.selectedCount", { count: selectedUsers.length })}</span>
              <span>{filtered.length}/{candidates.length}</span>
            </div>
          )}
      </PopoverContent>
    </Popover>
  );
}
