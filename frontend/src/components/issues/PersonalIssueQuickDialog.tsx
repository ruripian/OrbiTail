/**
 * PersonalIssueQuickDialog — 단발성 이슈 빠른 생성 다이얼로그 (마이 페이지 전용).
 *
 * 정책:
 *   - 단발성 이슈는 Project.kind=personal 컨테이너에 자동 귀속 (backend lazy 생성)
 *   - 빠른 폼 — 제목 + 우선순위 + 시작/마감일 + 팀 공유 토글 만 노출
 *   - 디테일 편집(라벨/하위/연결문서/댓글)은 생성 후 IssueDialog 에서
 *
 * 재사용성:
 *   - "+ 이슈" 진입점이 늘어나면 (ex. 사이드바 단축, command palette) 그대로 호출 가능
 *   - workspaceSlug 만 알면 됨 — 프로젝트 선택 UI 없음
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users, UserX } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { PriorityPicker } from "@/components/issues/priority-picker";
import { cn } from "@/lib/utils";
import { meApi } from "@/api/me";
import { useIssueDialogStore } from "@/stores/issueDialogStore";
import type { Priority } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  /** 셀에서 호출 시 기본 마감일 자동 설정 */
  defaultDueDate?: string;
}

export function PersonalIssueQuickDialog({
  open, onOpenChange, workspaceSlug, defaultDueDate,
}: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const openIssueDialog = useIssueDialogStore((s) => s.openIssue);

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [sharedWithTeam, setSharedWithTeam] = useState(true);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setPriority("none");
      setStartDate(null);
      setDueDate(null);
      setSharedWithTeam(true);
      return;
    }
    if (defaultDueDate) setDueDate(defaultDueDate);
  }, [open, defaultDueDate]);

  const createMutation = useMutation({
    mutationFn: () => meApi.issues.create(workspaceSlug, {
      title: title.trim(),
      priority,
      start_date: startDate,
      due_date: dueDate,
      shared_with_team: sharedWithTeam,
    }),
    onSuccess: (issue) => {
      qc.invalidateQueries({ queryKey: ["me", "issues"] });
      onOpenChange(false);
      toast.success(t("me.personalIssue.created", "단발성 이슈가 생성되었습니다"));
      // 생성 직후 상세 다이얼로그 자동 오픈 — 추가 편집(설명/하위/연결문서) 흐름으로 자연 연결.
      if (issue.workspace_slug) {
        openIssueDialog(issue.workspace_slug, issue.project, issue.id);
      }
    },
    onError: () => toast.error(t("me.personalIssue.createFailed", "이슈 생성에 실패했습니다")),
  });

  const submit = () => {
    if (!title.trim()) return;
    createMutation.mutate();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>{t("me.personalIssue.title", "단발성 이슈")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="personal-issue-title">{t("me.personalIssue.fields.title", "제목")}</Label>
            <Input
              id="personal-issue-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("me.personalIssue.fields.titlePlaceholder", "할 일을 입력하세요")}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("issues.detail.meta.startDate", "시작일")}</Label>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                placeholder={t("datePicker.placeholder", "날짜 선택")}
                className="border border-border rounded-md bg-input/60"
                hintDate={dueDate}
                hintMode="after"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("issues.detail.meta.dueDate", "마감일")}</Label>
              <DatePicker
                value={dueDate}
                onChange={setDueDate}
                placeholder={t("datePicker.placeholder", "날짜 선택")}
                className="border border-border rounded-md bg-input/60"
                hintDate={startDate}
                hintMode="before"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t("issues.detail.meta.priority", "우선순위")}</Label>
            <PriorityPicker
              currentPriority={priority}
              onChange={setPriority}
              className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
            />
          </div>

          {/* 팀 공유 토글 — 기본 ON (사용자 결정).
              false 면 본인 캘린더에만 표시되고 팀 캘린더에서 차단됨. */}
          <div className="space-y-1">
            <Label>{t("issues.detail.meta.teamShare", "팀 공유")}</Label>
            <button
              type="button"
              onClick={() => setSharedWithTeam((v) => !v)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors",
                sharedWithTeam
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50",
              )}
            >
              {sharedWithTeam ? (
                <>
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 text-left">
                    {t("issues.detail.meta.sharedWithTeam", "팀 캘린더에 표시")}
                  </span>
                </>
              ) : (
                <>
                  <UserX className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 text-left">
                    {t("issues.detail.meta.notSharedWithTeam", "본인만 보기")}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel", "취소")}
          </Button>
          <Button onClick={submit} disabled={!title.trim() || createMutation.isPending}>
            {createMutation.isPending
              ? t("common.creating", "생성 중...")
              : t("common.create", "생성")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
