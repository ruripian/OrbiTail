import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, Trash2, Reply, X } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import type { MentionItem } from "@/components/editor/MentionList";
import { formatLongDate } from "@/utils/date-format";
import type { IssueComment } from "@/types";

/* tiptap 의 "빈" 상태는 보통 <p></p>. 단순 trim 만으로는 비어 보이는 입력이 통과되므로
 * 빈 태그/<br>/공백을 모두 걷어내고 잔여가 있는지로 판단. */
function isEditorEmpty(html: string): boolean {
  return !html.replace(/<p>\s*<\/p>/g, "").replace(/<br\s*\/?>/g, "").trim();
}

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

  /* 댓글 RichEditor 의 이미지 드롭/붙여넣기 → IssueAttachment 업로드.
   * - source="from_comment" 로 마킹해 첨부탭이 출처 배지로 구분
   * - invalidate 는 여기서 안 함: 사용자 멘탈모델상 "댓글을 등록해야 첨부탭에 반영" → createMutation onSuccess 에서 invalidate
   * - 반환된 file URL 을 에디터에 인라인 삽입 (base64 회피)
   * - 실패 시 throw — RichTextEditor 가 alert 처리
   * - 알려진 한계: 업로드 후 댓글 취소하면 첨부는 DB 에 남음(orphan). 추후 cleanup 별도. */
  const handleImageUpload = async (file: File): Promise<string> => {
    const att = await issuesApi.attachments.upload(workspaceSlug, projectId, issueId, file, "from_comment");
    return att.file;
  };

  /* 멘션 후보 — 같은 queryKey 의 캐시 (IssueDetailPage 가 이미 로드) 를 재사용해 추가 요청 없음. */
  const { data: projectMembers = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug, projectId),
  });
  const mentionItems = useMemo<MentionItem[]>(
    () => projectMembers.map((pm) => ({
      id: pm.member.id,
      display_name: pm.member.display_name,
      avatar: pm.member.avatar,
    })),
    [projectMembers],
  );

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
      // 댓글 등록 시점에 첨부탭 동기화 — 작성 중 이미지 업로드는 backend 에 즉시 들어가지만
      // 사용자 멘탈모델은 "등록해야 첨부에 반영" 이라 invalidate 를 여기로 모음.
      qc.invalidateQueries({ queryKey: ["attachments", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.commentCreateFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => issuesApi.comments.delete(workspaceSlug, projectId, issueId, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", issueId] }),
    onError: () => toast.error(t("issues.detail.toast.commentDeleteFailed")),
  });

  const submitReply = (parentId: string) => {
    if (isEditorEmpty(replyText)) return;
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
        {/* comment_html 은 RichTextEditor 가 sanitize 한 HTML. dangerouslySetInnerHTML 사용 안전 가정. */}
        <div
          className="text-sm prose prose-sm dark:prose-invert max-w-none break-words"
          dangerouslySetInnerHTML={{ __html: comment.comment_html }}
        />
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
            /* 답글 컴포저 — 입력창 + 하단 액션 행. Send/취소를 옆 column 이 아닌 본문 아래에 배치해 시각 거리 단축. */
            <div
              className="ml-11"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitReply(node.id);
                if (e.key === "Escape") { setReplyTo(null); setReplyText(""); }
              }}
            >
              <RichTextEditor
                content={replyText}
                onChange={setReplyText}
                placeholder={t("issues.detail.comments.replyPlaceholder")}
                showToolbar
                showHeadings={false}
                mentionItems={mentionItems}
                onImageUpload={handleImageUpload}
                minHeight="60px"
                autoFocus
              />
              <div className="flex justify-end gap-1 mt-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setReplyTo(null); setReplyText(""); }}
                  title={t("common.cancel")}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  disabled={isEditorEmpty(replyText) || createMutation.isPending}
                  onClick={() => submitReply(node.id)}
                  title={t("issues.detail.comments.submit")}
                >
                  <Send className="h-3.5 w-3.5 mr-1" />
                  {t("issues.detail.comments.submit")}
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
        /* 본 댓글 컴포저 — Send 를 입력창 하단 우측에 배치. Ctrl/Cmd+Enter 단축키 유지. */
        <div
          className="pt-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !isEditorEmpty(text)) {
              createMutation.mutate({ comment_html: text });
            }
          }}
        >
          <RichTextEditor
            content={text}
            onChange={setText}
            placeholder={t("issues.detail.comments.placeholder")}
            showToolbar
            showHeadings={false}
            mentionItems={mentionItems}
            onImageUpload={handleImageUpload}
            minHeight="72px"
          />
          <div className="flex justify-end mt-1.5">
            <Button
              size="sm"
              disabled={isEditorEmpty(text) || createMutation.isPending}
              onClick={() => createMutation.mutate({ comment_html: text })}
              title={t("issues.detail.comments.submit")}
            >
              <Send className="h-3.5 w-3.5 mr-1" />
              {t("issues.detail.comments.submit")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
