/**
 * 블록 댓글 사이드 패널 — 스레드 목록, 답글, resolve/reopen, 삭제.
 *
 * 부모(DocumentSpacePage)와의 인터페이스:
 *  - activeThreadId: 어느 스레드가 현재 포커스인지 (에디터에서 마크 클릭 시 전달)
 *  - onActiveThreadChange: 패널에서 스레드 선택 시 호출 — 부모가 에디터 스크롤 담당
 *  - newThread: 새 스레드 생성 중인 경우 { selectedText, resolve } — 인라인 입력 폼 표시
 */

import { useEffect, useRef, useState } from "react";
import { ResizableAside } from "@/components/ui/resizable-aside";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, MessageSquareReply, Trash2, X as XIcon, CornerDownLeft } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/relative-time";
import type { CommentThread } from "@/types";

export interface NewThreadRequest {
  selectedText: string;
  resolve: (threadId: string | null) => void;
}

interface Props {
  workspaceSlug: string;
  spaceId: string;
  docId: string;
  activeThreadId: string | null;
  onActiveThreadChange: (id: string | null) => void;
  newThread: NewThreadRequest | null;
  onNewThreadHandled: () => void;
}

export function CommentsPanel({
  workspaceSlug, spaceId, docId,
  activeThreadId, onActiveThreadChange,
  newThread, onNewThreadHandled,
}: Props) {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<"open" | "resolved">("open");

  const threadsQ = useQuery({
    queryKey: ["doc-threads", docId, tab],
    queryFn: () => documentsApi.threads.list(workspaceSlug, spaceId, docId, tab === "resolved"),
    enabled: !!docId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["doc-threads", docId] });
  };

  const createMutation = useMutation({
    mutationFn: (data: { anchor_text: string; initial_content: string }) =>
      documentsApi.threads.create(workspaceSlug, spaceId, docId, data),
    onSuccess: () => invalidate(),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => documentsApi.threads.resolve(workspaceSlug, spaceId, docId, id),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.threads.delete(workspaceSlug, spaceId, docId, id),
    onSuccess: (_data, id) => {
      invalidate();
      if (activeThreadId === id) onActiveThreadChange(null);
      /* 마크도 DOM에서 제거 — 스레드 삭제 시 연결 사라진 마크는 의미 없음.
         Y.Doc 차원 제거는 별도 훅이 없어 이번 세션에선 미구현. 새로고침 시 재계산. */
    },
  });

  const replyMutation = useMutation({
    mutationFn: (args: { threadId: string; content: string }) =>
      documentsApi.threads.reply(workspaceSlug, spaceId, docId, args.threadId, args.content),
    onSuccess: () => invalidate(),
  });

  /* 새 스레드 인라인 폼 — 버블 메뉴에서 댓글 버튼 누르면 활성화 */
  const [newContent, setNewContent] = useState("");
  const newInputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (newThread) {
      setNewContent("");
      setTab("open");
      setTimeout(() => newInputRef.current?.focus(), 50);
    }
  }, [newThread]);

  const submitNewThread = async () => {
    if (!newThread) return;
    const content = newContent.trim();
    if (!content) return;
    try {
      const thread = await createMutation.mutateAsync({
        anchor_text: newThread.selectedText.slice(0, 500),
        initial_content: content,
      });
      newThread.resolve(thread.id);
      onNewThreadHandled();
    } catch {
      toast.error("댓글 생성 실패");
    }
  };

  const cancelNewThread = () => {
    if (!newThread) return;
    newThread.resolve(null);
    onNewThreadHandled();
  };

  return (
    <ResizableAside
      storageKey="doc_comments_width"
      defaultWidth={320}
      minWidth={320}
      maxWidth={560}
      handleSide="left"
      className="border-l flex flex-col bg-card/30"
    >
      <div className="flex items-center gap-1 px-3 py-2 border-b">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-auto">
          댓글
        </h2>
        <button
          onClick={() => setTab("open")}
          className={cn(
            "text-xs px-2 py-1 rounded-md transition-colors",
            tab === "open" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50",
          )}
        >진행</button>
        <button
          onClick={() => setTab("resolved")}
          className={cn(
            "text-xs px-2 py-1 rounded-md transition-colors",
            tab === "resolved" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50",
          )}
        >해결됨</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 새 스레드 인라인 폼 */}
        {newThread && (
          <div className="p-3 border-b bg-amber-500/5">
            <p className="text-2xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1.5">
              새 댓글
            </p>
            <blockquote className="text-xs text-muted-foreground border-l-2 border-amber-500/60 pl-2 mb-2 line-clamp-3">
              "{newThread.selectedText}"
            </blockquote>
            <textarea
              ref={newInputRef}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitNewThread(); }
                else if (e.key === "Escape") { e.preventDefault(); cancelNewThread(); }
              }}
              rows={3}
              placeholder="댓글을 입력하세요... (Cmd+Enter 전송, Esc 취소)"
              className="w-full text-sm bg-background border rounded-md px-2 py-1.5 outline-none focus:border-primary/60 resize-none"
            />
            <div className="flex justify-end gap-1.5 mt-2">
              <Button variant="ghost" size="sm" className="h-7" onClick={cancelNewThread}>
                취소
              </Button>
              <Button size="sm" className="h-7 gap-1" disabled={!newContent.trim() || createMutation.isPending} onClick={submitNewThread}>
                <CornerDownLeft className="h-3 w-3" />
                등록
              </Button>
            </div>
          </div>
        )}

        {threadsQ.isLoading ? (
          <p className="p-6 text-xs text-muted-foreground text-center">로딩 중...</p>
        ) : (threadsQ.data ?? []).length === 0 ? (
          <p className="p-6 text-xs text-muted-foreground text-center">
            {tab === "open" ? "열린 댓글 스레드가 없습니다" : "해결된 댓글이 없습니다"}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {(threadsQ.data ?? []).map((th) => (
              <ThreadItem
                key={th.id}
                thread={th}
                active={th.id === activeThreadId}
                currentUserId={currentUser?.id ?? null}
                onActivate={() => onActiveThreadChange(th.id)}
                onReply={(content) => replyMutation.mutate({ threadId: th.id, content })}
                onResolve={() => resolveMutation.mutate(th.id)}
                onDelete={() => {
                  if (confirm("이 댓글 스레드를 삭제하시겠습니까?")) deleteMutation.mutate(th.id);
                }}
                replyPending={replyMutation.isPending && replyMutation.variables?.threadId === th.id}
              />
            ))}
          </ul>
        )}
      </div>
    </ResizableAside>
  );
}

/* ────────────────────────────────────────────────────────────── */

function ThreadItem({
  thread, active, currentUserId, onActivate, onReply, onResolve, onDelete, replyPending,
}: {
  thread: CommentThread;
  active: boolean;
  currentUserId: string | null;
  onActivate: () => void;
  onReply: (content: string) => void;
  onResolve: () => void;
  onDelete: () => void;
  replyPending: boolean;
}) {
  const [reply, setReply] = useState("");
  const isCreator = currentUserId && thread.created_by === currentUserId;

  return (
    <li
      onClick={onActivate}
      className={cn(
        "p-3 cursor-pointer transition-colors",
        active ? "bg-amber-500/10" : "hover:bg-accent/30",
      )}
    >
      {/* 앵커 텍스트 스니펫 */}
      <blockquote className="text-2xs text-muted-foreground border-l-2 border-amber-500/50 pl-2 mb-2 line-clamp-2">
        "{thread.anchor_text}"
      </blockquote>

      {/* 댓글 목록 */}
      <ul className="space-y-2">
        {thread.comments.map((c) => (
          <li key={c.id} className="text-sm">
            <div className="flex items-center gap-1.5 mb-0.5">
              {c.author_detail && (
                <AvatarInitials name={c.author_detail.display_name} avatar={c.author_detail.avatar} size="xs" />
              )}
              <span className="text-xs font-medium">{c.author_detail?.display_name || "?"}</span>
              <span className="text-2xs text-muted-foreground">{formatRelativeTime(c.created_at)}</span>
            </div>
            <p className="text-sm whitespace-pre-wrap leading-snug pl-6">{c.content}</p>
          </li>
        ))}
      </ul>

      {/* 답글 입력 + 액션 */}
      {!thread.resolved && (
        <div className="mt-2 pl-6" onClick={(e) => e.stopPropagation()}>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (reply.trim()) { onReply(reply.trim()); setReply(""); }
              }
            }}
            rows={1}
            placeholder="답글..."
            className="w-full text-sm bg-background border rounded-md px-2 py-1 outline-none focus:border-primary/60 resize-none"
          />
          <div className="flex justify-end gap-1 mt-1">
            {reply.trim() && (
              <Button
                size="sm" variant="ghost" className="h-6 gap-1 text-xs"
                disabled={replyPending}
                onClick={() => { onReply(reply.trim()); setReply(""); }}
              >
                <MessageSquareReply className="h-3 w-3" /> 답글
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 하단 툴바 — resolve/reopen/delete */}
      <div className="flex items-center gap-1 mt-2 pl-6" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onResolve}
          className="text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          title={thread.resolved ? "재개" : "해결됨으로 표시"}
        >
          {thread.resolved ? <><XIcon className="h-3 w-3" /> 재개</> : <><Check className="h-3 w-3" /> 해결</>}
        </button>
        {isCreator && (
          <button
            onClick={onDelete}
            className="ml-auto text-2xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
            title="스레드 삭제"
          >
            <Trash2 className="h-3 w-3" /> 삭제
          </button>
        )}
      </div>
    </li>
  );
}
