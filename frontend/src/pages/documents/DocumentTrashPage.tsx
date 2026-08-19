/**
 * 휴지통 — 스페이스에서 삭제된 문서를 되살리거나 완전히 지우는 전용 화면.
 *
 * 설정 안의 한 섹션이 아니라 독립 화면으로 둔다. 문서를 되찾는 일은 "설정을 바꾸는 일"이 아니라
 * 탐색기처럼 목록을 훑고 고르는 작업이라, 조작 방식도 탐색기와 같게 맞춘다(선택 → 실행).
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, FileText, FolderOpen, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";

export default function DocumentTrashPage() {
  const { t } = useTranslation();
  const { workspaceSlug, spaceId } = useParams<{ workspaceSlug: string; spaceId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { data: trashed = [], isLoading } = useQuery({
    queryKey: ["space-trash", workspaceSlug, spaceId],
    queryFn: () => documentsApi.spaces.trash.list(workspaceSlug!, spaceId!),
    enabled: !!workspaceSlug && !!spaceId,
  });

  /* 미리보기 — 목록에는 본문이 없으므로 열 때 단건으로 받는다 */
  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ["space-trash-doc", workspaceSlug, spaceId, previewId],
    queryFn: () => documentsApi.spaces.trash.get(workspaceSlug!, spaceId!, previewId!),
    enabled: !!previewId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["space-trash", workspaceSlug, spaceId] });
    qc.invalidateQueries({ queryKey: ["documents", workspaceSlug, spaceId] });
    setSelected(new Set());
  };

  const restore = useMutation({
    mutationFn: (ids: string[]) => documentsApi.spaces.trash.restore(workspaceSlug!, spaceId!, ids),
    onSuccess: (r) => { invalidate(); setPreviewId(null); toast.success(`${r.restored}개 복구됨`); },
    onError: (e) => toast.error(apiErrorMessage(e, "복구 실패")),
  });

  const purge = useMutation({
    mutationFn: (ids?: string[]) => documentsApi.spaces.trash.purge(workspaceSlug!, spaceId!, ids),
    onSuccess: () => { invalidate(); setPreviewId(null); toast.success("영구 삭제됨"); },
    onError: (e) => toast.error(apiErrorMessage(e, "삭제 실패")),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const confirmPurge = (ids?: string[]) => {
    const label = ids ? `${ids.length}개 문서를` : "휴지통 전체를";
    if (window.confirm(`${label} 영구 삭제할까요? 되돌릴 수 없습니다.`)) purge.mutate(ids);
  };

  const allSelected = trashed.length > 0 && selected.size === trashed.length;
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
        <Button
          variant="ghost" size="sm" className="h-8 text-xs gap-1.5"
          onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}`)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          스페이스로
        </Button>

        <div className="w-px h-5 bg-border" />

        <div className="flex items-baseline gap-2 flex-1 min-w-0">
          <h1 className="text-sm font-semibold">휴지통</h1>
          <span className="text-2xs text-muted-foreground">
            {trashed.length}개
            {selected.size > 0 && ` · ${selected.size}개 선택`}
          </span>
        </div>

        {selected.size > 0 && (
          <>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => restore.mutate(Array.from(selected))}>
              <RotateCcw className="h-3.5 w-3.5" />
              선택 복원
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => confirmPurge(Array.from(selected))}
            >
              <Trash2 className="h-3.5 w-3.5" />
              선택 삭제
            </Button>
          </>
        )}
        {trashed.length > 0 && selected.size === 0 && (
          <Button
            size="sm" variant="ghost"
            className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => confirmPurge()}
          >
            <Trash2 className="h-3.5 w-3.5" />
            비우기
          </Button>
        )}
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-2 max-w-wide mx-auto">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}
          </div>
        ) : trashed.length === 0 ? (
          <EmptyState
            icon={<Trash2 className="h-10 w-10" />}
            title="휴지통이 비어 있습니다"
            description="삭제한 문서가 여기 모입니다. 영구 삭제하기 전까지는 언제든 되살릴 수 있습니다."
          />
        ) : (
          <div className="max-w-wide mx-auto rounded-xl border overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/20 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(trashed.map((d) => d.id)))}
                className="h-3.5 w-3.5 accent-primary"
                aria-label="전체 선택"
              />
              <span className="flex-1">{t("documents.name")}</span>
              <span className="w-36">삭제한 사람</span>
              <span className="w-32">삭제일</span>
              <span className="w-20 text-right">작업</span>
            </div>

            {trashed.map((doc) => (
              <div
                key={doc.id}
                onClick={() => setPreviewId(doc.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 border-b last:border-0 cursor-pointer transition-colors",
                  selected.has(doc.id) ? "bg-primary/10" : "hover:bg-accent/30",
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(doc.id)}
                  onChange={() => toggle(doc.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 accent-primary"
                  aria-label={`${doc.title} 선택`}
                />
                {doc.is_folder
                  ? <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                  : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <span className="flex-1 text-sm truncate">{doc.title}</span>

                <span className="w-36 flex items-center gap-1.5 min-w-0">
                  {doc.deleted_by_detail ? (
                    <>
                      <AvatarInitials
                        name={doc.deleted_by_detail.display_name || doc.deleted_by_detail.email}
                        avatar={doc.deleted_by_detail.avatar}
                        size="xs"
                      />
                      <span className="text-xs truncate">
                        {doc.deleted_by_detail.display_name || doc.deleted_by_detail.email}
                      </span>
                    </>
                  ) : (
                    /* deleted_by 를 도입하기 전에 지워진 문서는 기록이 없다 */
                    <span className="text-xs text-muted-foreground/60">기록 없음</span>
                  )}
                </span>

                <span className="w-32 text-xs text-muted-foreground">{fmt(doc.deleted_at)}</span>

                <div className="w-20 flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => restore.mutate([doc.id])}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                    title="복원"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => confirmPurge([doc.id])}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="영구 삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 미리보기 — 복구할지 판단하려면 내용을 봐야 한다. 읽기 전용. */}
      <Dialog open={!!previewId} onOpenChange={(v) => !v && setPreviewId(null)}>
        <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-8">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{preview?.title ?? "미리보기"}</span>
            </DialogTitle>
          </DialogHeader>

          {previewLoading || !preview ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {preview.deleted_by_detail?.display_name ?? "알 수 없음"} 님이 {fmt(preview.deleted_at)}에 삭제
              </p>
              <div className="flex-1 overflow-y-auto rounded-lg border bg-card p-5">
                {preview.is_folder ? (
                  <p className="text-sm text-muted-foreground">폴더입니다. 복원하면 안에 있던 문서도 함께 돌아옵니다.</p>
                ) : preview.content_html ? (
                  <article
                    className="doc-editor"
                    dangerouslySetInnerHTML={{ __html: preview.content_html }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">내용이 없는 문서입니다.</p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => confirmPurge([preview.id])}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  영구 삭제
                </Button>
                <Button onClick={() => restore.mutate([preview.id])}>
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                  복원
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
