/**
 * 커버 이미지 편집 다이얼로그
 *
 * - 신규 업로드/변경: 파일 선택 → CoverView 미리보기에서 zoom·높이·드래그로 위치 조정 → 저장
 * - 기존 커버 재조정: 동일 다이얼로그
 *
 * 미리보기와 실제 표시 모두 CoverView 컴포넌트 사용 → 동일 공식 → WYSIWYG.
 * offsetX/Y는 컨테이너 크기에 독립적인 "이미지 좌표(%)" — 다이얼로그/표시 컨테이너 너비가 달라도 같은 의미.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { CoverView } from "./CoverView";

export interface CoverEditValues {
  file?: File;
  offsetX: number;
  offsetY: number;
  zoom: number;
  height: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUrl?: string | null;
  initialOffsetX?: number;
  initialOffsetY?: number;
  initialZoom?: number;
  initialHeight?: number;
  onSave: (values: CoverEditValues) => Promise<void> | void;
  onRemove?: () => Promise<void> | void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const HEIGHT_MIN = 120;
const HEIGHT_MAX = 480;

export function CoverEditDialog({
  open, onOpenChange, currentUrl,
  initialOffsetX = 50, initialOffsetY = 50, initialZoom = 1.0, initialHeight = 208,
  onSave, onRemove,
}: Props) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl ?? null);
  const [offsetX, setOffsetX] = useState(initialOffsetX);
  const [offsetY, setOffsetY] = useState(initialOffsetY);
  const [zoom, setZoom] = useState(initialZoom);
  const [height, setHeight] = useState(initialHeight);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setPreviewUrl(currentUrl ?? null);
    setOffsetX(initialOffsetX);
    setOffsetY(initialOffsetY);
    setZoom(initialZoom);
    setHeight(initialHeight);
  }, [open, currentUrl, initialOffsetX, initialOffsetY, initialZoom, initialHeight]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onPickFile = (f: File) => {
    if (f.size > MAX_FILE_SIZE) { toast.error(t("documents.cover.tooLarge")); return; }
    if (!f.type.startsWith("image/")) { toast.error(t("documents.cover.notImage")); return; }
    setFile(f);
    setOffsetX(50); setOffsetY(50); setZoom(1.0);
  };

  const handleSave = async () => {
    if (!previewUrl) { toast.error(t("documents.cover.selectImage")); return; }
    setSaving(true);
    try {
      await onSave({
        file: file ?? undefined,
        offsetX: Math.round(offsetX),
        offsetY: Math.round(offsetY),
        zoom: Math.round(zoom * 100) / 100,
        height: Math.round(height),
      });
      onOpenChange(false);
    } catch {
      toast.error(t("documents.cover.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!onRemove) return;
    if (!window.confirm(t("documents.cover.removeConfirm"))) return;
    setSaving(true);
    try { await onRemove(); onOpenChange(false); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            {t("documents.cover.title")}
          </h2>
        </div>

        {!previewUrl ? (
          <FilePicker onFile={onPickFile} />
        ) : (
          <>
            <CoverView
              url={previewUrl}
              offsetX={offsetX}
              offsetY={offsetY}
              zoom={zoom}
              height={height}
              draggable
              onOffsetChange={(x, y) => { setOffsetX(x); setOffsetY(y); }}
              className="rounded-lg"
            >
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/50 text-white text-2xs pointer-events-none">
                {t("documents.cover.dragHint")}
              </div>
            </CoverView>

            {/* 확대 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t("documents.cover.zoom")}</Label>
                <span className="text-2xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
              </div>
              <input type="range" min={1.0} max={3.0} step={0.05} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-primary" />
            </div>

            {/* 높이 — 표시 영역의 높이만 결정. 원본 이미지/이동 가능 영역과 무관. */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t("documents.cover.height")}</Label>
                <span className="text-2xs tabular-nums text-muted-foreground">{height}px</span>
              </div>
              <input type="range" min={HEIGHT_MIN} max={HEIGHT_MAX} step={4} value={height}
                onChange={(e) => setHeight(Number(e.target.value))} className="w-full accent-primary" />
            </div>

            <FilePicker compact onFile={onPickFile} />
          </>
        )}

        <div className="flex items-center justify-between pt-2">
          <div>
            {currentUrl && onRemove && (
              <Button variant="ghost" size="sm" onClick={handleRemove} disabled={saving}
                className="text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                {t("common.remove")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>{t("common.cancel")}</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !previewUrl}>
              {saving ? t("documents.cover.saving") : t("documents.cover.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilePicker({ onFile, compact = false }: { onFile: (f: File) => void; compact?: boolean }) {
  const { t } = useTranslation();
  const inputId = "cover-file-" + Math.random().toString(36).slice(2, 8);
  return (
    <label
      htmlFor={inputId}
      className={
        compact
          ? "flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          : "flex flex-col items-center justify-center gap-2 h-44 rounded-lg border-2 border-dashed border-border hover:border-primary/60 hover:bg-muted/30 cursor-pointer transition-colors"
      }
    >
      <Upload className={compact ? "h-3.5 w-3.5" : "h-6 w-6 text-muted-foreground"} />
      <span className={compact ? "" : "text-sm text-muted-foreground"}>
        {compact ? t("documents.cover.pickOther") : t("documents.cover.pickHint")}
      </span>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
