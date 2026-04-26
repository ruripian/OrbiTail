import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, Trash2 } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { Button } from "@/components/ui/button";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { formatLongDate } from "@/utils/date-format";
import type { IssueComment } from "@/types";

/** PASS5-D — Comments tab. create/delete mutation 자체 소유. */
interface Props {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  comments: IssueComment[];
  /** 본인 댓글 삭제 권한 분기용 */
  currentUserId: string | undefined;
  readOnly: boolean;
}

export function CommentsTab({ workspaceSlug, projectId, issueId, comments, currentUserId, readOnly }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState("");

  const createMutation = useMutation({
    mutationFn: () => issuesApi.comments.create(workspaceSlug, projectId, issueId, { comment_html: text }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["comments", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.commentCreateFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => issuesApi.comments.delete(workspaceSlug, projectId, issueId, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", issueId] }),
    onError: () => toast.error(t("issues.detail.toast.commentDeleteFailed")),
  });

  return (
    <div className="space-y-5">
      {comments.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">{t("issues.detail.comments.empty")}</p>
      )}

      {comments.map((comment) => (
        <div key={comment.id} className="flex gap-3">
          <AvatarInitials name={comment.actor_detail?.display_name} avatar={comment.actor_detail?.avatar} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium">{comment.actor_detail?.display_name}</span>
              <span className="text-xs text-muted-foreground">{formatLongDate(comment.created_at)}</span>
              {comment.actor === currentUserId && (
                <button
                  className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => deleteMutation.mutate(comment.id)}
                  title={t("common.delete")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
            <p className="text-sm whitespace-pre-wrap">{comment.comment_html}</p>
          </div>
        </div>
      ))}

      {!readOnly && (
        <div className="flex gap-2 pt-1">
          <textarea
            className="flex-1 text-sm bg-muted/20 border border-border rounded-md px-3 py-2 outline-none resize-none focus:border-primary transition-colors min-h-[72px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("issues.detail.comments.placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) {
                createMutation.mutate();
              }
            }}
          />
          <Button
            size="sm"
            disabled={!text.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="self-end"
            title={t("issues.detail.comments.submit")}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
