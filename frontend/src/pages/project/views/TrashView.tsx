/**
 * 휴지통 뷰 — 소프트 삭제된 이슈 + 복구/영구삭제 (PASS5-B: RestorableListView 베이스).
 * 30일 후 자동 영구 삭제 (백엔드 Celery 태스크).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { issuesApi } from "@/api/issues";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { RestorableListView, type Column, type Action } from "@/components/views/RestorableListView";
import { PriorityChip } from "@/components/issues/chips/PriorityChip";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types";

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

  const daysLeft = (deletedAt: string) => {
    const elapsed = Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000);
    return Math.max(TRASH_RETENTION_DAYS - elapsed, 0);
  };

  const columns: Column<Issue>[] = [
    {
      id: "title",
      label: t("issues.table.cols.title"),
      width: "flex-1",
      render: (i) => (
        <div className="flex items-center gap-2">
          <span className="text-2xs text-muted-foreground font-mono shrink-0">{i.sequence_id}</span>
          <span className="text-sm truncate">{i.title}</span>
        </div>
      ),
    },
    {
      id: "priority",
      label: t("issues.table.cols.priority"),
      width: "w-20",
      align: "center",
      render: (i) => <PriorityChip priority={i.priority} />,
    },
    {
      id: "daysLeft",
      label: t("views.trash.autoDelete"),
      width: "w-28",
      align: "center",
      render: (i) => {
        const remaining = i.deleted_at ? daysLeft(i.deleted_at) : TRASH_RETENTION_DAYS;
        return (
          <span className={cn("text-xs font-medium", remaining <= 7 ? "text-destructive" : "text-muted-foreground")}>
            {t("views.trash.daysLeft", { count: remaining })}
          </span>
        );
      },
    },
  ];

  const actions: Action<Issue>[] = [
    {
      id: "restore",
      label: t("views.trash.restore"),
      icon: <RotateCcw className="h-3 w-3" />,
      variant: "outline",
      onClick: (i) => restoreMutation.mutate(i.id),
      disabled: () => restoreMutation.isPending,
    },
    {
      id: "purge",
      label: t("views.trash.purge"),
      icon: <Trash2 className="h-3 w-3" />,
      variant: "destructive",
      onClick: (i) => purgeMutation.mutate(i.id),
      disabled: () => purgeMutation.isPending,
      visible: () => Boolean(perms.can_purge),
      confirmMessage: t("views.trash.purgeConfirm"),
    },
  ];

  return (
    <RestorableListView<Issue>
      rows={deletedIssues}
      isLoading={isLoading}
      rowKey={(i) => i.id}
      columns={columns}
      actions={actions}
      actionsWidth="w-44"
      hint={t("views.trash.retentionNotice", { days: TRASH_RETENTION_DAYS })}
      emptyState={{
        icon: <Trash2 className="h-10 w-10" />,
        title: t("views.trash.empty"),
        description: t("views.trash.emptyDescription"),
      }}
    />
  );
}
