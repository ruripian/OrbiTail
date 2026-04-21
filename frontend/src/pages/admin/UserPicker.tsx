import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, Search } from "lucide-react";

import { adminApi } from "@/api/admin";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 관리자 페이지 공통 사용자 선택 드롭다운.
 * - 검색 입력 → /auth/admin/users/?search=... 로 디바운스 조회
 * - 선택된 id 상태는 부모가 보관 (controlled)
 */
export function UserPicker({
  value,
  onChange,
  excludeId,
  placeholder,
}: {
  value:       string | null;
  onChange:    (id: string | null) => void;
  excludeId?:  string;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const h = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(h);
  }, [query]);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin_user_picker", debounced],
    queryFn: () =>
      adminApi.listUsers({ search: debounced || undefined }).then((r) => r.results),
  });

  const visible = excludeId ? users.filter((u) => u.id !== excludeId) : users;
  const selected = visible.find((u) => u.id === value) ?? users.find((u) => u.id === value);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-8 h-9"
          placeholder={placeholder ?? t("admin.common.searchUserPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="max-h-48 overflow-y-auto border rounded-md bg-background divide-y">
        {isLoading ? (
          <div className="flex justify-center py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            {t("admin.common.noUsersFound")}
          </div>
        ) : (
          visible.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => onChange(u.id === value ? null : u.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                u.id === value ? "bg-primary/10 text-foreground" : "hover:bg-muted/60",
              )}
            >
              <div className="h-7 w-7 shrink-0 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                {u.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium leading-tight">{u.display_name}</p>
                <p className="truncate text-xs text-muted-foreground leading-tight">{u.email}</p>
              </div>
            </button>
          ))
        )}
      </div>
      {selected && (
        <p className="text-xs text-muted-foreground">
          {t("admin.common.selected")}: <span className="font-medium">{selected.email}</span>
        </p>
      )}
    </div>
  );
}
