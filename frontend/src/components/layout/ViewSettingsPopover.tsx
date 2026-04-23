import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useViewSettings, FONT_SANS_LABELS, FONT_MONO_LABELS } from "@/lib/view-settings";
import { Type, RotateCcw } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 보기 설정 다이얼로그 — TopBar 등에서 controlled로 열고 닫음. 변경 즉시 :root 적용 + 백엔드 저장. */
export function ViewSettingsPopover({ open, onOpenChange }: Props) {
  const { fontScale, fontFamily, fontMono, setFontScale, setFontFamily, setFontMono, reset } = useViewSettings();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-80 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Type className="h-4 w-4" />
            보기 설정
          </div>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors"
            title="기본값으로"
          >
            <RotateCcw className="h-3 w-3" />
            기본값
          </button>
        </div>

        {/* 글자 크기 슬라이더 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">글자 크기</Label>
            <span className="text-2xs text-muted-foreground tabular-nums">{Math.round(fontScale * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.8}
            max={1.4}
            step={0.05}
            value={fontScale}
            onChange={(e) => setFontScale(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-3xs text-muted-foreground">
            <span>작게</span>
            <span>기본</span>
            <span>크게</span>
          </div>
        </div>

        {/* 본문 글꼴 */}
        <div className="space-y-1.5">
          <Label className="text-xs">본문 글꼴</Label>
          <Select value={fontFamily} onValueChange={(v) => setFontFamily(v as typeof fontFamily)}>
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_SANS_LABELS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 코드 글꼴 */}
        <div className="space-y-1.5">
          <Label className="text-xs">코드 글꼴</Label>
          <Select value={fontMono} onValueChange={(v) => setFontMono(v as typeof fontMono)}>
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_MONO_LABELS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-3xs text-muted-foreground pt-1">변경 즉시 적용됩니다. 다른 기기에서도 동일하게 보입니다.</p>
      </DialogContent>
    </Dialog>
  );
}
