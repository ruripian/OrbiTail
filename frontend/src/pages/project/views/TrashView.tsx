/**
 * 휴지통 뷰 — 소프트 삭제된 이슈 + 복구/영구삭제 (PASS5-B: RestorableListView 베이스).
 * 30일 후 자동 영구 삭제 (백엔드 Celery 태스크).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Trash2, RotateCcw, FileText, Paperclip, Download } from "lucide-react";
import { toast } from "sonner";
import { issuesApi } from "@/api/issues";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { RestorableListView, type Column, type Action } from "@/components/views/RestorableListView";
import { PriorityChip } from "@/components/issues/chips/PriorityChip";
import { cn } from "@/lib/utils";
import type { Issue, IssueAttachment } from "@/types";

const TRASH_RETENTION_DAYS = 30;

interface Props {
  workspaceSlug: string;
  projectId: string;
}

export function TrashView({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"issues" | "attachments">("issues");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-4 pt-3 border-b border-border shrink-0">
        <TabButton active={tab === "issues"} onClick={() => setTab("issues")} icon={<FileText className="h-3.5 w-3.5" />}>
          {t("views.trash.tabs.issues", "이슈")}
        </TabButton>
        <TabButton active={tab === "attachments"} onClick={() => setTab("attachments")} icon={<Paperclip className="h-3.5 w-3.5" />}>
          {t("views.trash.tabs.attachments", "첨부파일")}
        </TabButton>
      </div>

      <div className="flex-1 min-h-0">
        {tab === "issues"
          ? <IssuesTrash workspaceSlug={workspaceSlug} projectId={projectId} />
          : <AttachmentsTrash workspaceSlug={workspaceSlug} projectId={projectId} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 -mb-px transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function IssuesTrash({ workspaceSlug, projectId }: Props) {
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

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentsTrash({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const { perms } = useProjectPerms();
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["attachments-trash", workspaceSlug, projectId],
    queryFn: () => issuesApi.attachments.listDeleted(workspaceSlug, projectId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["attachments-trash", workspaceSlug, projectId] });
    qc.invalidateQueries({ queryKey: ["attachments"] });
  };

  const restoreMutation = useMutation({
    mutationFn: (id: string) => issuesApi.attachments.restore(workspaceSlug, projectId, id),
    onSuccess: () => { invalidate(); toast.success(t("views.trash.restored")); },
  });
  const purgeMutation = useMutation({
    mutationFn: (id: string) => issuesApi.attachments.hardDelete(workspaceSlug, projectId, id),
    onSuccess: () => { invalidate(); toast.success(t("views.trash.purged")); },
  });

  const daysLeft = (deletedAt?: string | null) => {
    if (!deletedAt) return TRASH_RETENTION_DAYS;
    const elapsed = Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000);
    return Math.max(TRASH_RETENTION_DAYS - elapsed, 0);
  };

  const columns: Column<IssueAttachment>[] = [
    {
      id: "filename",
      label: t("issues.detail.attachments.upload"),
      width: "flex-1",
      render: (a) => (
        <div className="flex items-center gap-2 min-w-0">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm truncate">{a.filename}</span>
          <span className="text-2xs text-muted-foreground shrink-0">{formatBytes(a.size)}</span>
        </div>
      ),
    },
    {
      id: "issue",
      label: t("issues.table.cols.title"),
      width: "w-64",
      render: (a) => (
        <span className="text-xs text-muted-foreground truncate block">
          {a.issue_sequence_id ? `#${a.issue_sequence_id} ` : ""}{a.issue_title ?? ""}
        </span>
      ),
    },
    {
      id: "daysLeft",
      label: t("views.trash.autoDelete"),
      width: "w-28",
      align: "center",
      render: (a) => {
        const remaining = daysLeft(a.deleted_at);
        return (
          <span className={cn("text-xs font-medium", remaining <= 7 ? "text-destructive" : "text-muted-foreground")}>
            {t("views.trash.daysLeft", { count: remaining })}
          </span>
        );
      },
    },
  ];

  const actions: Action<IssueAttachment>[] = [
    {
      id: "download",
      label: t("issues.detail.attachments.download"),
      icon: <Download className="h-3 w-3" />,
      variant: "outline",
      onClick: (a) => {
        const link = document.createElement("a");
        link.href = a.file;
        link.target = "_blank";
        link.rel = "noopener";
        link.download = a.filename;
        link.click();
      },
    },
    {
      id: "restore",
      label: t("views.trash.restore"),
      icon: <RotateCcw className="h-3 w-3" />,
      variant: "outline",
      onClick: (a) => restoreMutation.mutate(a.id),
      disabled: () => restoreMutation.isPending,
    },
    {
      id: "purge",
      label: t("views.trash.purge"),
      icon: <Trash2 className="h-3 w-3" />,
      variant: "destructive",
      onClick: (a) => purgeMutation.mutate(a.id),
      disabled: () => purgeMutation.isPending,
      visible: () => Boolean(perms.can_purge),
      confirmMessage: t("views.trash.purgeConfirm"),
    },
  ];

  return (
    <RestorableListView<IssueAttachment>
      rows={items}
      isLoading={isLoading}
      rowKey={(a) => a.id}
      columns={columns}
      actions={actions}
      actionsWidth="w-60"
      hint={t("views.trash.retentionNotice", { days: TRASH_RETENTION_DAYS })}
      emptyState={{
        icon: <Trash2 className="h-10 w-10" />,
        title: t("views.trash.empty"),
        description: t("views.trash.emptyDescription"),
      }}
    />
  );
}
