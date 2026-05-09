import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, Trash2, Reply, X } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { Button } from "@/components/ui/button";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { formatLongDate } from "@/utils/date-format";
import type { IssueComment } from "@/types";

/** 이슈 댓글 탭 — create/delete mutation 자체 소유.
 * 답글은 1단계 트리만 지원 (parent_id 가 있는 댓글에는 답글 버튼 숨김).
 */
interface Props {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  comments: IssueComment[];
  /** 본인 댓글 삭제 권한 분기용 */
  currentUserId: string | undefined;
  readOnly: boolean;
}

interface CommentTreeNode extends IssueComment {
  replies: IssueComment[];
}

/** 평면 댓글 배열을 1단계 트리로 묶어 반환한다. parent 가 가리키는 부모가 목록에 없으면 고아 → 최상위로 승격. */
function buildCommentTree(comments: IssueComment[]): CommentTreeNode[] {
  const byId = new Map<string, CommentTreeNode>();
  const roots: CommentTreeNode[] = [];

  for (const c of comments) {
    if (!c.parent) {
      const node: CommentTreeNode = { ...c, replies: [] };
      byId.set(c.id, node);
      roots.push(node);
    }
  }
  for (const c of comments) {
    if (c.parent) {
      const parent = byId.get(c.parent);
      if (parent) {
        parent.replies.push(c);
      } else {
        // 부모가 사라진 경우(드물게) 최상위로 폴백 — 누락보다 표시가 낫다.
        const orphan: CommentTreeNode = { ...c, replies: [] };
        byId.set(c.id, orphan);
        roots.push(orphan);
      }
    }
  }
  return roots;
}

export function CommentsTab({ workspaceSlug, projectId, issueId, comments, currentUserId, readOnly }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  // 답글 작성 중인 부모 댓글 id — 한 번에 하나만 펼침.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const tree = useMemo(() => buildCommentTree(comments), [comments]);

  const createMutation = useMutation({
    mutationFn: (payload: { comment_html: string; parent?: string | null }) =>
      issuesApi.comments.create(workspaceSlug, projectId, issueId, payload),
    onSuccess: (_data, vars) => {
      if (vars.parent) {
        setReplyText("");
        setReplyTo(null);
      } else {
        setText("");
      }
      qc.invalidateQueries({ queryKey: ["comments", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.commentCreateFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => issuesApi.comments.delete(workspaceSlug, projectId, issueId, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", issueId] }),
    onError: () => toast.error(t("issues.detail.toast.commentDeleteFailed")),
  });

  const submitReply = (parentId: string) => {
    if (!replyText.trim()) return;
    createMutation.mutate({ comment_html: replyText, parent: parentId });
  };

  const renderComment = (comment: IssueComment, isReply: boolean) => (
    <div className="flex gap-3">
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
        {!isReply && !readOnly && (
          <button
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              setReplyTo(replyTo === comment.id ? null : comment.id);
              setReplyText("");
            }}
            title={t("issues.detail.comments.reply")}
          >
            <Reply className="h-3 w-3" />
            {t("issues.detail.comments.reply")}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {tree.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">{t("issues.detail.comments.empty")}</p>
      )}

      {tree.map((node) => (
        <div key={node.id} className="space-y-3">
          {renderComment(node, false)}

          {replyTo === node.id && !readOnly && (
            <div className="ml-11 flex gap-2">
              <textarea
                className="flex-1 text-sm bg-muted/20 border border-border rounded-md px-3 py-2 outline-none resize-none focus:border-primary transition-colors min-h-[60px]"
                value={replyText}
                autoFocus
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={t("issues.detail.comments.replyPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitReply(node.id);
                  if (e.key === "Escape") { setReplyTo(null); setReplyText(""); }
                }}
              />
              <div className="flex flex-col gap-1 self-end">
                <Button
                  size="sm"
                  disabled={!replyText.trim() || createMutation.isPending}
                  onClick={() => submitReply(node.id)}
                  title={t("issues.detail.comments.submit")}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setReplyTo(null); setReplyText(""); }}
                  title={t("common.cancel")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {node.replies.length > 0 && (
            <div className="ml-11 pl-4 border-l border-border space-y-3">
              {node.replies.map((reply) => (
                <div key={reply.id}>{renderComment(reply, true)}</div>
              ))}
            </div>
          )}
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
                createMutation.mutate({ comment_html: text });
              }
            }}
          />
          <Button
            size="sm"
            disabled={!text.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate({ comment_html: text })}
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
