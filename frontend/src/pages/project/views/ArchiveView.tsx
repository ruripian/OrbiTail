/**
 * 보관함 뷰 — 보관된 이슈 + 복원/삭제 (PASS5-B: RestorableListView 베이스 사용).
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { issuesApi } from "@/api/issues";
import { formatDate } from "@/utils/date-format";
import { RestorableListView, type Column, type Action } from "@/components/views/RestorableListView";
import { PriorityChip } from "@/components/issues/chips/PriorityChip";
import { StateChip } from "@/components/issues/chips/StateChip";
import type { Issue } from "@/types";

interface Props {
  workspaceSlug: string;
  projectId: string;
  onIssueClick?: (issueId: string) => void;
  issueFilter?: Record<string, string>;
}

export function ArchiveView({ workspaceSlug, projectId, onIssueClick, issueFilter }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: allArchived = [], isLoading } = useQuery({
    queryKey: ["issues-archive", workspaceSlug, projectId, issueFilter],
    queryFn: () => issuesApi.listArchived(workspaceSlug, projectId, issueFilter),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["issues-archive", workspaceSlug, projectId] });
    qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
  };

  const unarchiveMutation = useMutation({
    mutationFn: (issueId: string) => issuesApi.unarchive(workspaceSlug, projectId, issueId),
    onSuccess: () => { invalidate(); toast.success(t("views.archive.restored")); },
  });
  const deleteMutation = useMutation({
    mutationFn: (issueId: string) => issuesApi.delete(workspaceSlug, projectId, issueId),
    onSuccess: () => { invalidate(); toast.success(t("issues.table.deleted")); },
  });

  /* 계층 — 최상위만 표시, 자식은 expand 시. */
  const archivedIds = useMemo(() => new Set(allArchived.map((i) => i.id)), [allArchived]);
  const topLevel = useMemo(
    () => allArchived.filter((i) => !i.parent || !archivedIds.has(i.parent)),
    [allArchived, archivedIds],
  );
  const childrenMap = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of allArchived) {
      if (issue.parent && archivedIds.has(issue.parent)) {
        const list = map.get(issue.parent) ?? [];
        list.push(issue);
        map.set(issue.parent, list);
      }
    }
    return map;
  }, [allArchived, archivedIds]);

  const columns: Column<Issue>[] = [
    {
      id: "id",
      label: t("issues.table.cols.id"),
      width: "w-16",
      render: (i) => (
        <span className="text-2xs text-muted-foreground font-mono shrink-0">{i.sequence_id}</span>
      ),
    },
    {
      id: "title",
      label: t("issues.table.cols.title"),
      width: "flex-1",
      render: (i) => <span className="text-sm truncate">{i.title}</span>,
    },
    {
      id: "priority",
      label: t("issues.table.cols.priority"),
      width: "w-20",
      align: "center",
      render: (i) => <PriorityChip priority={i.priority} />,
    },
    {
      id: "state",
      label: t("issues.table.cols.state"),
      width: "w-20",
      align: "center",
      render: (i) => i.state_detail ? <StateChip state={i.state_detail} /> : null,
    },
    {
      id: "date",
      label: t("views.archive.archivedDate"),
      width: "w-24",
      align: "center",
      render: (i) => (
        <span className="text-xs text-muted-foreground">
          {i.archived_at ? formatDate(i.archived_at.split("T")[0]) : "—"}
        </span>
      ),
    },
  ];

  const actions: Action<Issue>[] = [
    {
      id: "restore",
      label: t("views.archive.restore"),
      icon: <RotateCcw className="h-3 w-3" />,
      variant: "outline",
      onClick: (i) => unarchiveMutation.mutate(i.id),
      disabled: () => unarchiveMutation.isPending,
    },
    {
      id: "delete",
      label: t("views.archive.delete"),
      icon: <Trash2 className="h-3 w-3" />,
      variant: "destructive",
      showLabel: false,
      onClick: (i) => deleteMutation.mutate(i.id),
      disabled: () => deleteMutation.isPending,
      confirmMessage: t("issues.detail.deleteConfirm"),
    },
  ];

  return (
    <RestorableListView<Issue>
      rows={topLevel}
      isLoading={isLoading}
      rowKey={(i) => i.id}
      columns={columns}
      actions={actions}
      actionsWidth="w-40"
      hint={t("views.archive.description")}
      emptyState={{
        icon: <Archive className="h-10 w-10" />,
        title: t("views.archive.empty"),
        description: t("views.archive.emptyDescription"),
      }}
      hierarchy={{
        childrenOf: (i) => childrenMap.get(i.id) ?? [],
        canExpand:  (i) => (childrenMap.get(i.id)?.length ?? 0) > 0,
      }}
      onRowClick={onIssueClick ? (i) => onIssueClick(i.id) : undefined}
    />
  );
}
