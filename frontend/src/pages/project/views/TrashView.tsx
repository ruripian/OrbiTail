/**
 * 휴지통 뷰 — 소프트 삭제된 이슈 목록 + 복구
 * 30일 후 자동 영구 삭제 (백엔드 Celery 태스크)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Trash2, RotateCcw } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* 우선순위 색상 */
const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-500", high: "text-orange-500", medium: "text-yellow-500", low: "text-blue-500", none: "text-muted-foreground",
};

const TRASH_RETENTION_DAYS = 30;

interface Props {
  workspaceSlug: string;
  projectId: string;
}

export function TrashView({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const { perms } = useProjectPerms();
  const qc = useQueryClient();

  const { data: deletedIssues = [], isLoading } = useQuery({
    queryKey: ["issues-trash", workspaceSlug, projectId],
    queryFn: () => issuesApi.listDeleted(workspaceSlug, projectId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["issues-trash", workspaceSlug, projectId] });
    qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
  };

  const restoreMutation = useMutation({
    mutationFn: (issueId: string) => issuesApi.restore(workspaceSlug, projectId, issueId),
    onSuccess: () => { invalidate(); toast.success(t("views.trash.restored")); },
  });

  const purgeMutation = useMutation({
    mutationFn: (issueId: string) => issuesApi.hardDelete(workspaceSlug, projectId, issueId),
    onSuccess: () => { invalidate(); toast.success(t("views.trash.purged")); },
  });

  /* 잔여 일수 계산 */
  const daysLeft = (deletedAt: string) => {
    const elapsed = Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000);
    return Math.max(TRASH_RETENTION_DAYS - elapsed, 0);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading...</div>;
  }

  if (deletedIssues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <Trash2 className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">{t("views.trash.empty")}</p>
        <p className="text-xs">{t("views.trash.emptyDescription")}</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {/* 안내 문구 */}
      <p className="text-xs text-muted-foreground">
        {t("views.trash.retentionNotice", { days: TRASH_RETENTION_DAYS })}
      </p>

      <div className="rounded-xl border overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-b bg-muted/20 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <span className="flex-1">{t("issues.table.cols.title")}</span>
          <span className="w-20 text-center">{t("issues.table.cols.priority")}</span>
          <span className="w-28 text-center">{t("views.trash.autoDelete")}</span>
          <span className="w-44" />
        </div>

        {/* 이슈 목록 */}
        {deletedIssues.map((issue) => {
          const remaining = issue.deleted_at ? daysLeft(issue.deleted_at) : TRASH_RETENTION_DAYS;
          return (
            <div
              key={issue.id}
              className="flex items-center gap-4 px-4 py-3 border-b last:border-0 hover:bg-muted/10 transition-colors"
            >
              {/* 제목 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-2xs text-muted-foreground font-mono shrink-0">
                    {issue.sequence_id}
                  </span>
                  <span className="text-sm truncate">{issue.title}</span>
                </div>
              </div>

              {/* 우선순위 */}
              <span className={cn("w-20 text-center text-xs font-medium", PRIORITY_COLORS[issue.priority] ?? "text-muted-foreground")}>
                {issue.priority === "none" ? "—" : issue.priority}
              </span>

              {/* 잔여 일수 */}
              <span className={cn(
                "w-28 text-center text-xs font-medium",
                remaining <= 7 ? "text-destructive" : "text-muted-foreground"
              )}>
                {t("views.trash.daysLeft", { count: remaining })}
              </span>

              {/* 복구/영구삭제 버튼 */}
              <div className="w-44 flex items-center justify-end gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => restoreMutation.mutate(issue.id)}
                  disabled={restoreMutation.isPending}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  {t("views.trash.restore")}
                </Button>
                {perms.can_purge && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      if (window.confirm(t("views.trash.purgeConfirm"))) {
                        purgeMutation.mutate(issue.id);
                      }
                    }}
                    disabled={purgeMutation.isPending}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    {t("views.trash.purge")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
