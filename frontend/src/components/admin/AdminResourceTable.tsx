import { type ReactNode, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PaginatedResponse } from "@/types";

/** Radix Select 는 빈 문자열을 placeholder 용으로 예약하므로 "전체"에 별도 sentinel 이 필요하다. */
const ALL = "__all__";

export interface AdminColumn<T> {
  key:        string;
  label:      string;
  render:     (row: T) => ReactNode;
  /** 서버 ordering 파라미터 값. 없으면 이 컬럼은 정렬할 수 없다(백엔드 화이트리스트와 일치시킬 것). */
  sortKey?:   string;
  align?:     "left" | "right";
  className?: string;
}

export type AdminFilter =
  | { key: string; label: string; type: "text" }
  | { key: string; label: string; type: "date" }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[] };

interface Props<T> {
  /** react-query 캐시 키의 접두 — 필터/정렬 상태가 자동으로 뒤에 붙는다. */
  queryKey:      unknown[];
  fetchPage:     (params: Record<string, string | number>) => Promise<PaginatedResponse<T>>;
  columns:       AdminColumn<T>[];
  rowKey:        (row: T) => string;
  filters?:      AdminFilter[];
  /** 초기 정렬. 미지정이면 서버 기본값(-created_at)에 맡긴다. */
  initialOrdering?: string;
  emptyTitle:    string;
  emptyDescription?: string;
  emptyIcon?:    ReactNode;
  enabled?:      boolean;
}

/**
 * 관리자 콘솔 목록 표준 테이블.
 *
 * 서버 페이지네이션 · 서버 정렬 · 필터 · 총 건수를 한 곳에서 제공한다.
 * 각 탭은 컬럼과 필터만 선언하면 되고, 특히 **총 건수를 항상 노출**하기 때문에
 * 결과가 잘렸는지 사용자가 모르는 상태가 생기지 않는다(구 첨부 검색의 200개 하드컷 문제).
 */
export function AdminResourceTable<T>({
  queryKey, fetchPage, columns, rowKey, filters = [],
  initialOrdering, emptyTitle, emptyDescription, emptyIcon, enabled = true,
}: Props<T>) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [ordering, setOrdering] = useState<string | undefined>(initialOrdering);

  /* 빈 값은 쿼리에서 아예 빼서 "필터 없음"과 "빈 문자열 필터"가 구분되게 한다. */
  const activeParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value) activeParams[key] = value;
  }

  const query = useInfiniteQuery({
    queryKey: [...queryKey, activeParams, ordering],
    queryFn: ({ pageParam = 1 }) =>
      fetchPage({
        ...activeParams,
        ...(ordering ? { ordering } : {}),
        page: pageParam as number,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.next ? Number(new URL(lastPage.next).searchParams.get("page")) : undefined,
    initialPageParam: 1,
    enabled,
  });

  const rows = query.data?.pages.flatMap((page) => page.results) ?? [];
  const total = query.data?.pages[0]?.count ?? 0;

  const toggleSort = (sortKey?: string) => {
    if (!sortKey) return;
    setOrdering((prev) => (prev === sortKey ? `-${sortKey}` : sortKey));
  };

  const sortIcon = (sortKey?: string) => {
    if (!sortKey) return null;
    if (ordering === sortKey) return <ArrowUp className="h-3 w-3" />;
    if (ordering === `-${sortKey}`) return <ArrowDown className="h-3 w-3" />;
    return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
  };

  const setValue = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-3">
      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((filter) => {
            if (filter.type === "text") {
              return (
                <div key={filter.key} className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-8 h-8 w-64"
                    placeholder={filter.label}
                    value={values[filter.key] ?? ""}
                    onChange={(e) => setValue(filter.key, e.target.value)}
                  />
                </div>
              );
            }
            if (filter.type === "date") {
              return (
                <div key={filter.key} className="w-40">
                  <DatePicker
                    value={values[filter.key] ?? null}
                    onChange={(date) => setValue(filter.key, date ?? "")}
                    placeholder={filter.label}
                  />
                </div>
              );
            }
            return (
              <Select
                key={filter.key}
                value={values[filter.key] || ALL}
                onValueChange={(next) => setValue(filter.key, next === ALL ? "" : next)}
              >
                <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs">
                  <SelectValue placeholder={filter.label} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{filter.label}</SelectItem>
                  {filter.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}
          {query.isFetching && !query.isFetchingNextPage && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      )}

      {/* 총 건수 — 표시된 건수와 전체 건수를 항상 함께 보여준다. */}
      {!query.isLoading && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("admin.pagination.showing", { shown: rows.length, total })}
        </p>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        {query.isLoading ? (
          <div className="py-12 flex justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground bg-muted/30">
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={cn(
                        "px-3 py-2 font-medium",
                        column.align === "right" ? "text-right" : "text-left",
                      )}
                    >
                      {column.sortKey ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column.sortKey)}
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-foreground transition-colors",
                            column.align === "right" && "flex-row-reverse",
                          )}
                        >
                          {column.label}
                          {sortIcon(column.sortKey)}
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={rowKey(row)} className="border-b last:border-0 hover:bg-accent/30">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "px-3 py-2.5 align-top",
                          column.align === "right" && "text-right",
                          column.className,
                        )}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {t("admin.pagination.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
