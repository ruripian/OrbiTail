/**
 * 공개 공유 링크 다이얼로그 — 토글로 활성/해제, URL 복사, 만료일 옵션.
 * enable/disable 모두 편집 권한 필요. 서버가 권한 거부하면 해당 에러 토스트.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      toast.success(t("documents.shareLink.enabled"));
    },
    onError: () => toast.error(t("documents.shareLink.enableFailed")),
  });

  const disableMutation = useMutation({
    mutationFn: () => documentsApi.share.disable(workspaceSlug, spaceId, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc-share", docId] });
      toast.success(t("documents.shareLink.disabled"));
    },
  });

  const enabled = q.data?.enabled;
  const url = q.data?.url;

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success(t("documents.shareLink.copied"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            {t("documents.shareLink.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("common.loading")}</p>
          ) : enabled ? (
            <>
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground">{t("documents.shareLink.urlLabel")}</label>
                <div className="flex gap-1">
                  <input
                    readOnly
                    value={url || ""}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 text-xs font-mono bg-muted/40 border rounded-md px-2 py-1.5 outline-none"
                  />
                  <Button size="sm" variant="outline" className="h-8 gap-1" onClick={copy} title={t("documents.shareLink.copy")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <a
                    href={url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex h-8 px-2 items-center justify-center rounded-md border hover:bg-muted/60 transition-colors"
                    title={t("documents.shareLink.openNewTab")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="text-2xs text-muted-foreground mt-1">
                  {t("documents.shareLink.notice")}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground">{t("documents.shareLink.expiryLabel")}</label>
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
                    {t("documents.shareLink.apply")}
                  </Button>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 border-t">
                <p className="text-xs text-muted-foreground">
                  {q.data?.expires_at
                    ? t("documents.shareLink.expiresAt", { at: new Date(q.data.expires_at).toLocaleString() })
                    : t("documents.shareLink.noExpiry")}
                </p>
                <Button
                  size="sm" variant="outline"
                  onClick={() => disableMutation.mutate()}
                  disabled={disableMutation.isPending}
                >
                  {t("documents.shareLink.disable")}
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">
                {t("documents.shareLink.notShared")}
              </p>
              <Button
                onClick={() => enableMutation.mutate(null)}
                disabled={enableMutation.isPending}
                className="gap-2"
              >
                <Share2 className="h-4 w-4" />
                {enableMutation.isPending ? t("documents.shareLink.enabling") : t("documents.shareLink.enable")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
