import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import {
  /* 개발 */
  Box, Code, Terminal, Cpu, Database, Server, GitBranch, Bug,
  /* 인프라 */
  Globe, Shield, Cloud, Wifi, HardDrive, Monitor, Smartphone, Lock,
  /* 비즈니스 */
  Briefcase, Target, Flag, Trophy, TrendingUp, BarChart3, PieChart, DollarSign,
  /* 일반 */
  Rocket, Zap, Star, Heart, Bookmark, Tag, Hash, Activity,
  Compass, Layers, Package, Folder, Grid3x3, Feather, Lightbulb, Sparkles,
  /* 콘텐츠 */
  FileText, Image as ImageIcon, Mic, Video, Camera, Pen, Palette as PaletteIcon, Music,
  /* UI용 */
  Palette, LayoutGrid, X, Upload,
  type LucideIcon,
} from "lucide-react";
import { AvatarCropDialog } from "@/components/ui/avatar-crop-dialog";
import { iconsApi } from "@/api/icons";

/**
 * OrbiTail 전용 아이콘 선택기 — lucide 48개 + 색상 10개 + 사용자 지정 이미지
 *
 * 저장 형식(icon_prop JSON):
 *   기본:   { type: "lucide", name: "Box", color: "#5E6AD2" }
 *   커스텀: { type: "image",  url: "/media/icons/xxxxxxxxxxxx.jpg" }
 *
 * 글라스모피즘 디자인, 카테고리별 아이콘 그룹, 실시간 미리보기
 */

export type IconProp =
  | { type: "lucide"; name: string; color: string }
  | { type: "image"; url: string };

/** 카테고리별 아이콘 — 총 48개 */
const ICON_CATEGORIES = [
  {
    key: "dev",
    icons: { Box, Code, Terminal, Cpu, Database, Server, GitBranch, Bug },
  },
  {
    key: "infra",
    icons: { Globe, Shield, Cloud, Wifi, HardDrive, Monitor, Smartphone, Lock },
  },
  {
    key: "biz",
    icons: { Briefcase, Target, Flag, Trophy, TrendingUp, BarChart3, PieChart, DollarSign },
  },
  {
    key: "general",
    icons: { Rocket, Zap, Star, Heart, Bookmark, Tag, Hash, Activity },
  },
  {
    key: "creative",
    icons: { Compass, Layers, Package, Folder, Grid3x3, Feather, Lightbulb, Sparkles },
  },
  {
    key: "content",
    icons: { FileText, Image: ImageIcon, Mic, Video, Camera, Pen, Palette: PaletteIcon, Music },
  },
] as const;

/** 전체 아이콘 맵 (평탄화) */
const ICON_MAP: Record<string, LucideIcon> = {};
for (const cat of ICON_CATEGORIES) {
  Object.assign(ICON_MAP, cat.icons);
}
const ICON_NAMES = Object.keys(ICON_MAP);

/** 색상 팔레트 — 10개 */
const COLORS = [
  "#5E6AD2", // 인디고
  "#3B82F6", // 블루
  "#06B6D4", // 시안
  "#26B55E", // 그린
  "#84CC16", // 라임
  "#F0AD4E", // 앰버
  "#F97316", // 오렌지
  "#D94F4F", // 레드
  "#A855F7", // 퍼플
  "#64748B", // 슬레이트
];

const DEFAULT_LUCIDE: { type: "lucide"; name: string; color: string } = {
  type: "lucide",
  name: "Box",
  color: COLORS[0],
};

/** icon_prop JSON → IconProp 안전 파싱 (잘못된 값이면 기본값 반환) */
export function parseIconProp(value: Record<string, unknown> | null | undefined): IconProp {
  if (!value || typeof value !== "object") return DEFAULT_LUCIDE;

  // 사용자 지정 이미지
  if (value.type === "image" && typeof value.url === "string" && value.url.length > 0) {
    return { type: "image", url: value.url };
  }

  // lucide (기본/레거시 — type 생략된 경우도 lucide 로 취급)
  const name = typeof value.name === "string" && ICON_NAMES.includes(value.name)
    ? value.name
    : DEFAULT_LUCIDE.name;
  const color = typeof value.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(value.color)
    ? value.color
    : DEFAULT_LUCIDE.color;
  return { type: "lucide", name, color };
}

/** 저장된 icon_prop을 화면에 렌더링 — 어디서든 재사용 가능 (사이드바, 카드, 헤더 등) */
export function ProjectIcon({
  value,
  size = 20,
  className = "",
}: {
  value: Record<string, unknown> | null | undefined;
  size?: number;
  className?: string;
}) {
  const icon = parseIconProp(value);
  const box = size + 16;

  if (icon.type === "image") {
    return (
      <span
        className={`inline-flex items-center justify-center overflow-hidden rounded-lg bg-muted ${className}`}
        style={{ width: box, height: box }}
      >
        <img src={icon.url} alt="" className="w-full h-full object-cover" />
      </span>
    );
  }

  const Icon = ICON_MAP[icon.name] ?? Box;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg ${className}`}
      style={{
        backgroundColor: icon.color + "22",
        color: icon.color,
        width: box,
        height: box,
      }}
    >
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

interface ProjectIconPickerProps {
  /** 현재 값(icon_prop JSON). null이면 기본값 사용 */
  value: Record<string, unknown> | null | undefined;
  /** 사용자가 아이콘/색을 바꾸면 호출됨 — 항상 완전한 IconProp 전달 */
  onChange: (next: IconProp) => void;
  /** 트리거 버튼 사이즈 — 기본 대형(생성 폼용) */
  size?: "sm" | "md" | "lg";
}

export function ProjectIconPicker({ value, onChange, size = "lg" }: ProjectIconPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = parseIconProp(value);
  // lucide 기본값 — current 가 image 일 때도 lucide 탭에서 편집할 수 있도록 보조 상태 유지
  const lucideSnapshot: { type: "lucide"; name: string; color: string } =
    current.type === "lucide"
      ? current
      : { type: "lucide", name: "Box", color: COLORS[0] };
  const CurrentLucideIcon = ICON_MAP[lucideSnapshot.name] ?? Box;
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // 탭: "lucide" (기본) / "image" (사용자 지정)
  const [tab, setTab] = useState<"lucide" | "image">(current.type === "image" ? "image" : "lucide");
  useEffect(() => {
    // 외부에서 value 가 바뀌면 탭도 맞춰줌
    setTab(current.type === "image" ? "image" : "lucide");
  }, [current.type]);

  // 사용자 지정 이미지 업로드 플로우 — 파일 선택 → 크롭 다이얼로그 → 업로드
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  const uploadMutation = useMutation({
    mutationFn: (blob: Blob) => iconsApi.upload(blob),
    onSuccess: (res) => {
      setCropSrc(null);
      onChange({ type: "image", url: res.url });
      toast.success(t("iconPicker.uploaded", "아이콘이 업로드되었습니다."));
    },
    onError: () => toast.error(t("iconPicker.uploadFailed", "아이콘 업로드에 실패했습니다.")),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("iconPicker.notImage", "이미지 파일만 업로드할 수 있습니다."));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("iconPicker.tooLarge", "5MB 이하 이미지만 업로드할 수 있습니다."));
      return;
    }
    setCropSrc(URL.createObjectURL(file));
  };

  /* 팝오버 방향: 아래로 열기 vs 위로 열기 */
  const [openUp, setOpenUp] = useState(false);
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setOpenUp(spaceBelow < 400 && rect.top > 400);
  }, [open]);

  /* 바깥 클릭 시 닫기 — 단 크롭 다이얼로그가 열려있으면 유지 */
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (cropSrc) return; // 크롭 다이얼로그 상호작용 중엔 팝오버 유지
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, cropSrc]);

  /* 사이즈별 버튼 픽셀 */
  const triggerSize = size === "sm" ? 32 : size === "md" ? 48 : 64;
  const iconSize = size === "sm" ? 16 : size === "md" ? 24 : 32;

  return (
    <div ref={containerRef} className="relative inline-block" style={{ zIndex: open ? 9999 : undefined }}>
      {/* 트리거 버튼 — 현재 아이콘 타입에 맞게 렌더 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-center overflow-hidden rounded-2xl border-2 transition-all duration-base hover:scale-105 hover:shadow-md ${
          open ? "border-primary shadow-md" : "border-border hover:border-primary/60"
        }`}
        style={{
          backgroundColor: current.type === "lucide" ? current.color + "1F" : undefined,
          color: current.type === "lucide" ? current.color : undefined,
          width: triggerSize,
          height: triggerSize,
        }}
        aria-label={t("iconPicker.selectIcon")}
      >
        {current.type === "image" ? (
          <img src={current.url} alt="" className="w-full h-full object-cover" />
        ) : (
          <CurrentLucideIcon size={iconSize} strokeWidth={2.25} />
        )}
      </button>

      {/* 팝오버 — portal 미사용, absolute 배치로 Dialog inert 문제 회피 */}
      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 w-[320px] rounded-xl border border-border shadow-2xl overflow-hidden"
          style={{
            [openUp ? "bottom" : "top"]: triggerSize + 4,
            zIndex: 9999,
            background: "var(--glass-bg)",
            boxShadow: "0 24px 48px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.06) inset",
          }}
          role="dialog"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* ── 헤더: 현재 미리보기 + 닫기 ── */}
          <div className="relative px-4 pt-3 pb-2">
            <div
              className="absolute inset-0 opacity-[0.06]"
              style={{
                background: `radial-gradient(ellipse at 30% 50%, ${
                  current.type === "lucide" ? current.color : "#888"
                }, transparent 70%)`,
              }}
            />
            <div className="relative flex items-center gap-3">
              <div
                className="inline-flex items-center justify-center overflow-hidden rounded-xl shrink-0 transition-all duration-slow"
                style={{
                  backgroundColor: current.type === "lucide" ? current.color + "20" : undefined,
                  color: current.type === "lucide" ? current.color : undefined,
                  width: 40,
                  height: 40,
                  boxShadow: current.type === "lucide" ? `0 0 16px ${current.color}30` : undefined,
                }}
              >
                {current.type === "image" ? (
                  <img src={current.url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <CurrentLucideIcon size={20} strokeWidth={2} />
                )}
              </div>
              <div className="flex flex-col min-w-0 gap-0.5">
                <span className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {t("iconPicker.preview")}
                </span>
                <span className="text-sm font-semibold truncate">
                  {current.type === "image"
                    ? t("iconPicker.customImage", "사용자 지정")
                    : current.name}
                </span>
                {current.type === "lucide" && (
                  <div
                    className="h-1 w-12 rounded-full mt-0.5"
                    style={{ backgroundColor: current.color + "60" }}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* ── 탭 ── */}
          <div className="flex items-center gap-1 px-4 pb-2 border-b border-border/40">
            <button
              type="button"
              onClick={() => setTab("lucide")}
              className={`flex-1 text-2xs font-semibold uppercase tracking-widest py-1.5 rounded transition-colors ${
                tab === "lucide"
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground/60 hover:text-foreground"
              }`}
            >
              {t("iconPicker.tabDefault", "기본")}
            </button>
            <button
              type="button"
              onClick={() => setTab("image")}
              className={`flex-1 text-2xs font-semibold uppercase tracking-widest py-1.5 rounded transition-colors ${
                tab === "image"
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground/60 hover:text-foreground"
              }`}
            >
              {t("iconPicker.tabImage", "사용자 지정")}
            </button>
          </div>

          {/* ── 기본 아이콘 탭 ── */}
          {tab === "lucide" && (
            <>
              <div className="px-4 pt-2 pb-2">
                <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2.5">
                  <Palette className="h-3 w-3" />
                  {t("iconPicker.color")}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {COLORS.map((c) => {
                    const selected = lucideSnapshot.color === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => onChange({ type: "lucide", name: lucideSnapshot.name, color: c })}
                        className={`relative h-6 w-6 rounded-full transition-all duration-base hover:scale-110 flex items-center justify-center ${
                          selected ? "ring-2 ring-offset-2 ring-offset-background" : "hover:shadow-lg"
                        }`}
                        style={{
                          backgroundColor: c,
                          ...(selected ? { ["--tw-ring-color" as any]: c } : {}),
                        }}
                        aria-label={`${c}`}
                      >
                        {selected && (
                          <svg className="h-3.5 w-3.5 text-white drop-shadow-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mx-4 h-px bg-border/40" />

              <div className="px-4 pt-2 pb-3 max-h-[240px] overflow-y-auto space-y-2">
                {ICON_CATEGORIES.map((cat) => (
                  <div key={cat.key}>
                    <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest text-muted-foreground/40 mb-1.5">
                      <LayoutGrid className="h-2.5 w-2.5" />
                      {t(`iconPicker.category.${cat.key}`)}
                    </p>
                    <div className="grid grid-cols-8 gap-1.5">
                      {Object.entries(cat.icons).map(([name, Icon]) => {
                        const selected = current.type === "lucide" && name === current.name;
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => onChange({ type: "lucide", name, color: lucideSnapshot.color })}
                            className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-fast ${
                              selected
                                ? "scale-110 border-transparent"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:scale-105"
                            }`}
                            style={selected ? {
                              backgroundColor: lucideSnapshot.color + "20",
                              color: lucideSnapshot.color,
                              boxShadow: `0 0 0 1.5px ${lucideSnapshot.color}50, 0 2px 8px ${lucideSnapshot.color}20`,
                            } : undefined}
                            title={name}
                          >
                            <Icon size={15} strokeWidth={2} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── 사용자 지정 이미지 탭 ── */}
          {tab === "image" && (
            <div className="px-4 py-4 space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
              {current.type === "image" ? (
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-xl overflow-hidden bg-muted shrink-0 ring-1 ring-border">
                    <img src={current.url} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-primary hover:underline text-left"
                      disabled={uploadMutation.isPending}
                    >
                      {t("iconPicker.replace", "이미지 교체")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ type: "lucide", name: lucideSnapshot.name, color: lucideSnapshot.color })
                      }
                      className="text-xs text-muted-foreground hover:text-destructive text-left"
                    >
                      {t("iconPicker.removeImage", "기본 아이콘으로 되돌리기")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending}
                  className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border hover:border-primary/60 hover:bg-muted/20 transition-colors py-6 text-xs text-muted-foreground"
                >
                  <Upload size={18} />
                  <span>
                    {uploadMutation.isPending
                      ? t("iconPicker.uploading", "업로드 중...")
                      : t("iconPicker.uploadHint", "이미지 선택 (PNG/JPG, 5MB 이하)")}
                  </span>
                </button>
              )}
              <p className="text-2xs text-muted-foreground/60 leading-relaxed">
                {t(
                  "iconPicker.imageHint",
                  "이미지는 정사각으로 크롭되며, 사용하는 위치에 따라 자동으로 모양(원형/둥근 사각)이 적용됩니다.",
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 크롭 다이얼로그 (팝오버 외부 — 전역 모달) ── */}
      {cropSrc && (
        <AvatarCropDialog
          open={!!cropSrc}
          onOpenChange={(o) => {
            if (!o) setCropSrc(null);
          }}
          imageSrc={cropSrc}
          isPending={uploadMutation.isPending}
          onConfirm={(blob) => uploadMutation.mutate(blob)}
        />
      )}
    </div>
  );
}
