/**
 * 공개 공유 링크 다이얼로그 — 토글로 활성/해제, URL 복사, 만료일 옵션.
 * enable/disable 모두 편집 권한 필요. 서버가 권한 거부하면 해당 에러 토스트.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, ExternalLink, Share2 } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceSlug: string;
  spaceId: string;
  docId: string;
}

export function ShareDialog({ open, onOpenChange, workspaceSlug, spaceId, docId }: Props) {
  const qc = useQueryClient();
  const [expiresAt, setExpiresAt] = useState<string>(""); // datetime-local string

  const q = useQuery({
    queryKey: ["doc-share", docId],
    queryFn: () => documentsApi.share.get(workspaceSlug, spaceId, docId),
    enabled: open,
  });

  const enableMutation = useMutation({
    mutationFn: (exp: string | null) =>
      documentsApi.share.enable(workspaceSlug, spaceId, docId, exp),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc-share", docId] });
      toast.success("공유 링크가 활성화되었습니다");
    },
    onError: () => toast.error("공유 링크 활성화 실패 — 편집 권한을 확인해주세요"),
  });

  const disableMutation = useMutation({
    mutationFn: () => documentsApi.share.disable(workspaceSlug, spaceId, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc-share", docId] });
      toast.success("공유 링크가 해제되었습니다");
    },
  });

  const enabled = q.data?.enabled;
  const url = q.data?.url;

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success("링크가 복사되었습니다");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            공개 공유 링크
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">로딩 중...</p>
          ) : enabled ? (
            <>
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground">공유 URL</label>
                <div className="flex gap-1">
                  <input
                    readOnly
                    value={url || ""}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 text-xs font-mono bg-muted/40 border rounded-md px-2 py-1.5 outline-none"
                  />
                  <Button size="sm" variant="outline" className="h-8 gap-1" onClick={copy} title="복사">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <a
                    href={url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex h-8 px-2 items-center justify-center rounded-md border hover:bg-muted/60 transition-colors"
                    title="새 탭에서 열기"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="text-2xs text-muted-foreground mt-1">
                  로그인 없이 이 링크로 누구나 문서를 읽을 수 있습니다 (편집 불가).
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground">만료일 (선택)</label>
                <div className="flex gap-1">
                  <input
                    type="datetime-local"
                    value={expiresAt || (q.data?.expires_at ? q.data.expires_at.slice(0, 16) : "")}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="flex-1 text-xs bg-background border rounded-md px-2 py-1.5 outline-none focus:border-primary/60"
                  />
                  <Button
                    size="sm" variant="outline" className="h-8"
                    onClick={() => enableMutation.mutate(expiresAt ? new Date(expiresAt).toISOString() : null)}
                  >
                    적용
                  </Button>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 border-t">
                <p className="text-xs text-muted-foreground">
                  {q.data?.expires_at
                    ? `만료: ${new Date(q.data.expires_at).toLocaleString()}`
                    : "만료 없음"}
                </p>
                <Button
                  size="sm" variant="outline"
                  onClick={() => disableMutation.mutate()}
                  disabled={disableMutation.isPending}
                >
                  공유 해제
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">
                이 문서는 현재 공개되어 있지 않습니다.
              </p>
              <Button
                onClick={() => enableMutation.mutate(null)}
                disabled={enableMutation.isPending}
                className="gap-2"
              >
                <Share2 className="h-4 w-4" />
                {enableMutation.isPending ? "활성화 중..." : "공유 링크 생성"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
