/**
 * 이슈를 다른 프로젝트로 옮기기.
 *
 * 옮기면 무엇이 바뀌는지 먼저 보여 준다 — 번호가 바뀌고 스프린트·카테고리가 풀리는 걸 모르고 옮기면
 * "이슈가 사라졌다"로 느껴진다. 값 맞추기(상태·라벨)는 서버가 한다(IssueMoveView).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";

import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Issue } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  projectId: string;
  issue: Issue;
  subIssueCount: number;
  onMoved: (issue: Issue, targetProjectId: string) => void;
}

export function MoveIssueDialog({ open, onOpenChange, workspaceSlug, projectId, issue, subIssueCount, onMoved }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [targetId, setTargetId] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", workspaceSlug, { member_only: "true" }],
    queryFn: () => projectsApi.list(workspaceSlug, { member_only: "true" }),
    enabled: open,
  });
  /* 편집할 수 있는 프로젝트로만 옮길 수 있다 — 읽기 전용(10) 멤버인 곳은 고를 필요가 없다 */
  const candidates = projects.filter((p) => p.id !== projectId && (p.user_role ?? 0) >= 15);

  const move = useMutation({
    mutationFn: (target: string) => issuesApi.move(workspaceSlug, projectId, issue.id, target),
    onSuccess: (data, target) => {
      qc.invalidateQueries({ queryKey: ["issues"] });
      toast.success(t("issues.move.moved", { identifier: `${data.issue.project_identifier}-${data.issue.sequence_id}` }));
      onOpenChange(false);
      setTargetId(null);
      onMoved(data.issue, target);
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("issues.move.failed"))),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setTargetId(null); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("issues.move.title")}</DialogTitle>
        </DialogHeader>

        <p className="text-sm truncate">{issue.title}</p>

        <div className="max-h-64 overflow-y-auto rounded-md border">
          {isLoading ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t("issues.move.loading")}</p>
          ) : candidates.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t("issues.move.noTargets")}</p>
          ) : (
            candidates.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setTargetId(p.id)}
                aria-pressed={targetId === p.id}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                  targetId === p.id ? "bg-primary/10 text-foreground" : "hover:bg-accent",
                )}
              >
                <span className="w-12 shrink-0 font-mono text-2xs text-muted-foreground">{p.identifier}</span>
                <span className="truncate">{p.name}</span>
              </button>
            ))
          )}
        </div>

        <ul className="space-y-1 text-2xs text-muted-foreground">
          {subIssueCount > 0 && <li>• {t("issues.move.noteSubIssues", { count: subIssueCount })}</li>}
          <li>• {t("issues.move.noteNumber")}</li>
          <li>• {t("issues.move.noteValues")}</li>
          <li>• {t("issues.move.noteKept")}</li>
        </ul>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button disabled={!targetId || move.isPending} onClick={() => targetId && move.mutate(targetId)}>
            {t("issues.move.submit")}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
