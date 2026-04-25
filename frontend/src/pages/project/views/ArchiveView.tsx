/**
 * 보관함 뷰 — 보관된 이슈 읽기 전용 테이블 (계층 구조) + 복원/삭제
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Archive, RotateCcw, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/date-format";
import { PriorityGlyph } from "@/components/ui/priority-glyph";
import { EmptyState } from "@/components/ui/empty-state";
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

  /* 계층 구조: 최상위 이슈만 (parent가 없거나 parent가 보관되지 않은 경우) */
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

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading...</div>;
  }

  if (allArchived.length === 0) {
    return (
      <EmptyState
        icon={<Archive className="h-10 w-10" />}
        title={t("views.archive.empty")}
        description={t("views.archive.emptyDescription")}
      />
    );
  }

  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("views.archive.description")}
      </p>

      <div className="rounded-xl border overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-b bg-muted/20 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <span className="w-16">{t("issues.table.cols.id")}</span>
          <span className="flex-1">{t("issues.table.cols.title")}</span>
          <span className="w-20 text-center">{t("issues.table.cols.priority")}</span>
          <span className="w-20 text-center">{t("issues.table.cols.state")}</span>
          <span className="w-24 text-center">{t("views.archive.archivedDate")}</span>
          <span className="w-40" />
        </div>

        {topLevel.map((issue) => (
          <ArchivedIssueRow
            key={issue.id}
            issue={issue}
            depth={0}
            childrenMap={childrenMap}
            onIssueClick={onIssueClick}
            onRestore={(id) => unarchiveMutation.mutate(id)}
            onDelete={(id) => {
              if (window.confirm(t("issues.detail.deleteConfirm"))) deleteMutation.mutate(id);
            }}
            restorePending={unarchiveMutation.isPending}
            deletePending={deleteMutation.isPending}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

/* ── 계층 행 컴포넌트 ── */

function ArchivedIssueRow({
  issue, depth, childrenMap, onIssueClick, onRestore, onDelete, restorePending, deletePending, t,
}: {
  issue: Issue;
  depth: number;
  childrenMap: Map<string, Issue[]>;
  onIssueClick?: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  restorePending: boolean;
  deletePending: boolean;
  t: (key: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = childrenMap.get(issue.id) ?? [];
  const hasChildren = children.length > 0;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-4 px-4 py-3 border-b last:border-0 hover:bg-muted/10 transition-colors",
          depth > 0 && "bg-muted/5",
        )}
      >
        <span className="text-2xs text-muted-foreground font-mono w-16 shrink-0">
          {issue.sequence_id}
        </span>

        <div
          className="flex-1 min-w-0 flex items-center gap-1.5 cursor-pointer"
          style={{ paddingLeft: depth * 24 }}
          onClick={() => onIssueClick?.(issue.id)}
        >
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="p-0.5 rounded hover:bg-muted/60 shrink-0"
            >
              {expanded
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              }
            </button>
          )}
          {!hasChildren && <span className="w-[18px] shrink-0" />}
          <span className="text-sm truncate">{issue.title}</span>
        </div>

        <span
          className="w-20 inline-flex items-center justify-center gap-1.5 text-xs font-medium"
          style={{ color: `var(--priority-${issue.priority})` }}
        >
          <PriorityGlyph priority={issue.priority} size={10} />
          {issue.priority === "none" ? "—" : issue.priority}
        </span>

        <span className="w-20 text-center">
          {issue.state_detail && (
            <span className="inline-flex items-center gap-1 text-xs">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: issue.state_detail.color }} />
              <span className="truncate">{issue.state_detail.name}</span>
            </span>
          )}
        </span>

        <span className="w-24 text-center text-xs text-muted-foreground">
          {issue.archived_at ? formatDate(issue.archived_at.split("T")[0]) : "—"}
        </span>

        <div className="w-40 flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {depth === 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onRestore(issue.id)}
                disabled={restorePending}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                {t("views.archive.restore")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => onDelete(issue.id)}
                disabled={deletePending}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {expanded && children.map((child) => (
        <ArchivedIssueRow
          key={child.id}
          issue={child}
          depth={depth + 1}
          childrenMap={childrenMap}
          onIssueClick={onIssueClick}
          onRestore={onRestore}
          onDelete={onDelete}
          restorePending={restorePending}
          deletePending={deletePending}
          t={t}
        />
      ))}
    </>
  );
}
