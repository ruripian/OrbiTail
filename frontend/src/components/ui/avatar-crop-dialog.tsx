import { useState, useCallback } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageSrc: string;
  /** 서버 업로드를 위한 최종 출력 크기 (px). 원형이지만 정사각 Blob 으로 저장. */
  outputSize?: number;
  onConfirm: (blob: Blob) => void;
  isPending?: boolean;
}

export function AvatarCropDialog({
  open,
  onOpenChange,
  imageSrc,
  outputSize = 512,
  onConfirm,
  isPending,
}: Props) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pixelArea, setPixelArea] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: Area, px: Area) => {
    setPixelArea(px);
  }, []);

  const handleConfirm = async () => {
    if (!pixelArea) return;
    const blob = await cropImage(imageSrc, pixelArea, rotation, outputSize);
    onConfirm(blob);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-base">
            {t("settings.profile.crop.title", "프로필 사진 편집")}
          </DialogTitle>
        </DialogHeader>

        {/* 크롭 영역 — 원형 overlay. restrictPosition=false 로 회전 시 자동 줌 방지
            (원형 크롭 영역의 크기는 항상 고정, 이미지를 자유롭게 움직일 수 있음) */}
        <div className="relative w-full h-80 bg-black/40">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={1}
            cropShape="round"
            showGrid={false}
            restrictPosition={false}
            minZoom={0.5}
            maxZoom={3}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
          />
          {/* 우측 상단 현재 각도 표시 */}
          <div className="absolute top-2 right-2 rounded-md bg-black/60 text-white text-[10px] tabular-nums px-2 py-1 leading-none">
            {Math.round(rotation)}°
          </div>
        </div>

        {/* 줌 / 회전 슬라이더 + 회전 스냅 버튼 */}
        <div className="px-5 space-y-3 pt-3">
          <label className="flex items-center gap-3 text-xs">
            <span className="w-10 text-muted-foreground shrink-0">
              {t("settings.profile.crop.zoom", "확대")}
            </span>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="w-10 text-right text-muted-foreground tabular-nums text-2xs">
              {zoom.toFixed(2)}×
            </span>
          </label>
          <label className="flex items-center gap-3 text-xs">
            <span className="w-10 text-muted-foreground shrink-0">
              {t("settings.profile.crop.rotation", "회전")}
            </span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <button
              type="button"
              onClick={() => setRotation(0)}
              className="w-10 text-right text-2xs text-primary hover:underline tabular-nums"
              title={t("settings.profile.crop.resetRotation", "회전 초기화")}
            >
              0°
            </button>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border mt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t("common.cancel", "취소")}
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!pixelArea || isPending}>
            {isPending
              ? t("settings.profile.avatarUploading", "업로드 중...")
              : t("settings.profile.crop.apply", "적용")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── 이미지 크롭 유틸 ────────────────────────────────────
 * pixelArea 기준으로 원본 이미지에서 해당 영역을 잘라내고,
 * 회전을 적용한 뒤 outputSize px 정사각 Blob 으로 리샘플링.
 * 프론트는 cropShape="round" 로 원형을 보여주지만, 업로드 파일은 투명 PNG 대신
 * 정사각 JPEG 으로 저장 — 서버/CSS 에서 border-radius: 50% 처리가 이미 되어 있음.
 */
async function cropImage(
  src: string,
  area: Area,
  rotation: number,
  outputSize: number,
): Promise<Blob> {
  const image = await loadImage(src);
  const safe = Math.max(image.width, image.height) * 2;

  // 회전을 위한 임시 캔버스 (중앙 기준 회전)
  const rotatedCanvas = document.createElement("canvas");
  rotatedCanvas.width = safe;
  rotatedCanvas.height = safe;
  const rctx = rotatedCanvas.getContext("2d")!;
  rctx.translate(safe / 2, safe / 2);
  rctx.rotate((rotation * Math.PI) / 180);
  rctx.drawImage(image, -image.width / 2, -image.height / 2);

  // rotated 좌표계에서 원본 좌표로 매핑
  const offsetX = safe / 2 - image.width / 2;
  const offsetY = safe / 2 - image.height / 2;

  const out = document.createElement("canvas");
  out.width = outputSize;
  out.height = outputSize;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(
    rotatedCanvas,
    offsetX + area.x,
    offsetY + area.y,
    area.width,
    area.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.92,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
