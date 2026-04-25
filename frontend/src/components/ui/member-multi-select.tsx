import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Check, Search, ChevronDown } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";

/**
 * 멤버 멀티셀렉트 — 검색 가능한 팝오버 기반 선택기.
 *
 * 100~200명 워크스페이스에서도 유효하게 동작하도록 설계:
 *  - 트리거: 선택된 인원 칩 표시 + "멤버 추가" 버튼
 *  - 팝오버: 검색창 + 스크롤 가능한 체크리스트(가상화는 미적용 — 200명까지는 충분)
 *  - `lockedIds`로 지정된 항목은 제거/해제 불가(프로젝트 생성자·리더 등)
 *
 * 재사용 가능: CreateProjectPage, IssueDetail assignees, MembersPage add 등에서 활용 가능.
 */

export interface MemberOption {
  id: string;
  name: string;
  email?: string;
  avatar?: string | null;
}

interface Props {
  options: MemberOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** 제거·해제할 수 없는 고정 id들(생성자·리더 등). 표시는 하되 체크 해제 불가 */
  lockedIds?: string[];
  /** 각 id에 대한 부가 라벨(예: "(나)", "★ 리더") */
  getBadge?: (id: string) => string | null;
  placeholder?: string;
  /** 팝오버 내부 리스트 최대 높이 */
  maxHeight?: number;
}

export function MemberMultiSelect({
  options,
  selectedIds,
  onChange,
  lockedIds = [],
  getBadge,
  placeholder,
  maxHeight = 240,
}: Props) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("common.memberAdd");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lockedSet = useMemo(() => new Set(lockedIds), [lockedIds]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  /* 바깥 클릭 시 닫기 */
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  /* 팝오버가 열리면 검색창에 포커스 */
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  /* 검색 필터 */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.email?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  const toggle = (id: string) => {
    if (lockedSet.has(id)) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  /* 선택된 항목들 — lockedIds 먼저, 그 다음 일반 선택 */
  const selectedOptions = useMemo(() => {
    const locked: MemberOption[] = [];
    const normal: MemberOption[] = [];
    for (const o of options) {
      if (!selectedSet.has(o.id)) continue;
      if (lockedSet.has(o.id)) locked.push(o);
      else normal.push(o);
    }
    return [...locked, ...normal];
  }, [options, selectedSet, lockedSet]);

  return (
    <div ref={containerRef} className="relative">
      {/* 트리거 — 선택된 칩 표시 + 추가 버튼 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-h-9 items-center gap-1.5 flex-wrap rounded-md border border-border bg-input/60 px-2 py-1.5 text-sm text-left transition-colors hover:border-primary/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-ring/60"
      >
        {selectedOptions.length === 0 ? (
          <span className="text-muted-foreground px-1">{resolvedPlaceholder}</span>
        ) : (
          selectedOptions.map((o) => {
            const isLocked = lockedSet.has(o.id);
            const badge = getBadge?.(o.id);
            return (
              <span
                key={o.id}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  isLocked ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                }`}
              >
                {o.name}
                {badge && <span className="text-2xs opacity-70">{badge}</span>}
                {!isLocked && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggle(o.id); }}
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

      {/* 팝오버 — 검색 + 스크롤 리스트 */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 rounded-lg border glass shadow-lg overflow-hidden">
          {/* 검색창 */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("common.searchByNameOrEmail")}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
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
          <div
            className="overflow-y-auto py-1"
            style={{ maxHeight: `${maxHeight}px` }}
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t("common.noSearchResults")}
              </div>
            ) : (
              filtered.map((o) => {
                const isSelected = selectedSet.has(o.id);
                const isLocked = lockedSet.has(o.id);
                const badge = getBadge?.(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    disabled={isLocked}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors ${
                      isLocked
                        ? "opacity-60 cursor-default"
                        : "hover:bg-muted/50 cursor-pointer"
                    }`}
                  >
                    {/* 체크 상태 */}
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-border"
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>

                    {/* 아바타 */}
                    <AvatarInitials name={o.name} avatar={o.avatar} size="sm" />

                    {/* 이름/이메일 */}
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{o.name}</span>
                        {badge && (
                          <span className="text-2xs text-muted-foreground shrink-0">{badge}</span>
                        )}
                      </div>
                      {o.email && (
                        <div className="text-2xs text-muted-foreground truncate">{o.email}</div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* 하단 카운트 */}
          <div className="border-t border-border px-3 py-1.5 text-2xs text-muted-foreground flex items-center justify-between">
            <span>{t("common.selectedCount", { count: selectedOptions.length })}</span>
            <span>{filtered.length}/{options.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}
