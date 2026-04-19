import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { adminApi } from "@/api/admin";
import { useAuthStore } from "@/stores/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatLongDate, formatTime } from "@/utils/date-format";
import type { AuditAction } from "@/types";

const ACTIONS: (AuditAction | "all")[] = [
  "all",
  "superuser_grant", "superuser_revoke",
  "user_approve", "user_suspend", "user_unsuspend", "user_delete",
  "workspace_create", "workspace_delete", "workspace_owner",
];

const ACTION_TONE: Record<AuditAction, string> = {
  superuser_grant:  "text-amber-600 border-amber-500/30 bg-amber-500/10",
  superuser_revoke: "text-amber-600 border-amber-500/30 bg-amber-500/5",
  user_approve:     "text-emerald-600 border-emerald-500/30 bg-emerald-500/10",
  user_suspend:     "text-orange-600 border-orange-500/30 bg-orange-500/10",
  user_unsuspend:   "text-emerald-600 border-emerald-500/30 bg-emerald-500/10",
  user_delete:      "text-destructive border-destructive/30 bg-destructive/10",
  workspace_create: "text-blue-600 border-blue-500/30 bg-blue-500/10",
  workspace_delete: "text-destructive border-destructive/30 bg-destructive/10",
  workspace_owner:  "text-violet-600 border-violet-500/30 bg-violet-500/10",
};

export function AdminAuditLogPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  if (!user?.is_superuser) {
    return <p className="text-sm text-muted-foreground">{t("admin.common.superOnly")}</p>;
  }

  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");

  const {
    data,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["admin_audit", actionFilter],
    queryFn: ({ pageParam = 1 }) =>
      adminApi.listAudit({
        ...(actionFilter !== "all" ? { action: actionFilter } : {}),
        page: pageParam,
      }),
    getNextPageParam: (lastPage) => {
      if (!lastPage.next) return undefined;
      const url = new URL(lastPage.next);
      return Number(url.searchParams.get("page"));
    },
    initialPageParam: 1,
  });

  const logs = data?.pages.flatMap((p) => p.results) ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold">{t("admin.audit.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("admin.audit.desc")}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ACTIONS.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={actionFilter === a ? "default" : "outline"}
            onClick={() => setActionFilter(a)}
            className="h-7 text-xs"
          >
            {t(`admin.audit.action.${a}`)}
          </Button>
        ))}
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("admin.audit.empty")}
          </div>
        ) : (
          <>
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-lg border bg-card p-3 shadow-sm flex items-start gap-3"
            >
              <Badge
                variant="outline"
                className={`shrink-0 text-[10px] ${ACTION_TONE[log.action] ?? ""}`}
              >
                {t(`admin.audit.action.${log.action}`)}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-tight">
                  <span className="font-medium">{log.actor_label || t("admin.audit.system")}</span>
                  <span className="text-muted-foreground mx-1.5">→</span>
                  <span className="truncate">{log.target_label}</span>
                </p>
                {log.metadata && Object.keys(log.metadata).length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                    {Object.entries(log.metadata)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <div className="text-xs text-muted-foreground shrink-0 text-right tabular-nums">
                <div>{formatLongDate(log.created_at)}</div>
                <div>{formatTime(log.created_at)}</div>
              </div>
            </div>
          ))}
          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : null}
                {t("admin.pagination.loadMore")}
              </Button>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}
