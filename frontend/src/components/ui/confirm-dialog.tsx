import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import { Button } from "./button";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void;
  loading?: boolean;
  /** 알림(alert)처럼 되돌릴 게 없는 경우 취소 버튼을 감춘다. */
  hideCancel?: boolean;
}

export function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel, cancelLabel,
  variant = "default", onConfirm, loading, hideCancel,
}: Props) {
  const { t } = useTranslation();
  const isDanger = variant === "destructive";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {isDanger && (
              <div className="mt-0.5 h-9 w-9 rounded-full flex items-center justify-center bg-destructive/15 shrink-0">
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{description}</p>
              )}
            </div>
          </div>
        </DialogHeader>
        <div className="flex justify-end gap-2 mt-2">
          {!hideCancel && (
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              {cancelLabel ?? t("common.cancel")}
            </Button>
          )}
          <Button
            variant={isDanger ? "destructive" : "default"}
            onClick={() => { onConfirm(); }}
            disabled={loading}
          >
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
