/**
 * 선택한 여러 이슈를 다른 프로젝트로 한 번에 옮기기.
 *
 * MoveIssueDialog(단일) 와 같은 경고를 보여 준다 — 번호가 새로 매겨지고 스프린트·카테고리가
 * 풀리는 걸 모르고 옮기면 "이슈가 사라졌다"로 느껴진다. 되돌릴 수 없는 작업이라 실행취소가 없고,
 * 그래서 드롭다운이 아니라 확인 대화상자를 거친다.
 *
 * issueIds 는 선택의 **최상위만** 받는다. 서버가 하위 이슈까지 함께 옮기므로
 * 자식까지 넘기면 두 번째 호출이 실패한다 (TableView 의 selectionRoots 참고).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";

import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  projectId: string;
  /** 선택의 최상위 이슈 id 들 — 실제로 move 를 호출할 대상 */
  issueIds: string[];
  /** 사용자가 선택한 전체 개수(하위 포함) — 안내 문구용 */
  selectedCount: number;
  onMoved: () => void;
}

export function BulkMoveIssuesDialog({
  open, onOpenChange, workspaceSlug, projectId, issueIds, selectedCount, onMoved,
}: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [targetId, setTargetId] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", workspaceSlug, { member_only: "true" }],
    queryFn: () => projectsApi.list(workspaceSlug, { member_only: "true" }),
    enabled: open,
  });
  /* 편집할 수 있는 프로젝트로만 옮길 수 있다 — 서버도 양쪽 can_edit 를 요구한다 */
  const candidates = projects.filter((p) => p.id !== projectId && (p.user_role ?? 0) >= 15);

  const move = useMutation({
    mutationFn: async (target: string) => {
      /* 한 건이 실패해도 멈추지 않는다 — 대량 선택에서 하나 때문에 전체가 막히면 곤란하다 */
      const results = await Promise.allSettled(
        issueIds.map((id) => issuesApi.move(workspaceSlug, projectId, id, target)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { failed, target };
    },
    onSuccess: async ({ failed, target }) => {
      await qc.refetchQueries({ queryKey: ["issues"], type: "active" });
      const targetName = candidates.find((p) => p.id === target)?.name ?? "";
      if (failed > 0) {
        toast.warning(t("issues.bulk.movedPartial", { count: failed }));
      } else {
        toast.success(t("issues.bulk.moved", { count: selectedCount, project: targetName }));
      }
      onOpenChange(false);
      setTargetId(null);
      onMoved();
    },
    onError: () => toast.error(t("issues.move.failed")),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setTargetId(null); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("issues.move.title")}</DialogTitle>
        </DialogHeader>

        <p className="text-sm">{t("issues.bulk.selected", { count: selectedCount })}</p>

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
          <li>• {t("issues.bulk.moveNoteUndo")}</li>
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
