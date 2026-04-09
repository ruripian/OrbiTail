import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  FileText, Image, Mic, Video, Camera, Pen, Palette as PaletteIcon, Music,
  /* UI용 */
  Palette, LayoutGrid, X,
  type LucideIcon,
} from "lucide-react";

/**
 * OrbiTail 전용 아이콘 선택기 — lucide 아이콘 48개 + 색상 10개
 *
 * 저장 형식(icon_prop JSON):
 *   { type: "lucide", name: "Box", color: "#5E6AD2" }
 *
 * 글라스모피즘 디자인, 카테고리별 아이콘 그룹, 실시간 미리보기
 */

export interface IconProp {
  type: "lucide";
  name: string;
  color: string;
}

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
    icons: { FileText, Image: Image, Mic, Video, Camera, Pen, Palette: PaletteIcon, Music },
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

const DEFAULT_ICON: IconProp = { type: "lucide", name: "Box", color: COLORS[0] };

/** icon_prop JSON → IconProp 안전 파싱 (잘못된 값이면 기본값 반환) */
export function parseIconProp(value: Record<string, unknown> | null | undefined): IconProp {
  if (!value || typeof value !== "object") return DEFAULT_ICON;
  const name = typeof value.name === "string" && ICON_NAMES.includes(value.name)
    ? value.name
    : DEFAULT_ICON.name;
  const color = typeof value.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(value.color)
    ? value.color
    : DEFAULT_ICON.color;
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
  const Icon = ICON_MAP[icon.name] ?? Box;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg ${className}`}
      style={{
        backgroundColor: icon.color + "22",
        color: icon.color,
        width: size + 16,
        height: size + 16,
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
  const CurrentIcon = ICON_MAP[current.name] ?? Box;
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  /* 팝오버 방향: 아래로 열기 vs 위로 열기 */
  const [openUp, setOpenUp] = useState(false);
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setOpenUp(spaceBelow < 400 && rect.top > 400);
  }, [open]);

  /* 바깥 클릭 시 닫기 */
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  /* 사이즈별 버튼 픽셀 */
  const triggerSize = size === "sm" ? 32 : size === "md" ? 48 : 64;
  const iconSize = size === "sm" ? 16 : size === "md" ? 24 : 32;

  return (
    <div ref={containerRef} className="relative inline-block" style={{ zIndex: open ? 9999 : undefined }}>
      {/* 트리거 버튼 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-center rounded-2xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-md ${
          open ? "border-primary shadow-md" : "border-border hover:border-primary/60"
        }`}
        style={{
          backgroundColor: current.color + "1F",
          color: current.color,
          width: triggerSize,
          height: triggerSize,
        }}
        aria-label={t("iconPicker.selectIcon")}
      >
        <CurrentIcon size={iconSize} strokeWidth={2.25} />
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
          <div className="relative px-4 pt-3 pb-2">
            <div
              className="absolute inset-0 opacity-[0.06]"
              style={{ background: `radial-gradient(ellipse at 30% 50%, ${current.color}, transparent 70%)` }}
            />
            <div className="relative flex items-center gap-3">
              <div
                className="inline-flex items-center justify-center rounded-xl shrink-0 transition-all duration-300"
                style={{
                  backgroundColor: current.color + "20",
                  color: current.color,
                  width: 40,
                  height: 40,
                  boxShadow: `0 0 16px ${current.color}30`,
                }}
              >
                <CurrentIcon size={20} strokeWidth={2} />
              </div>
              <div className="flex flex-col min-w-0 gap-0.5">
                <span className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {t("iconPicker.preview")}
                </span>
                <span className="text-sm font-semibold truncate">{current.name}</span>
                <div
                  className="h-1 w-12 rounded-full mt-0.5"
                  style={{ backgroundColor: current.color + "60" }}
                />
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

          <div className="px-4 pt-2 pb-2">
            <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2.5">
              <Palette className="h-3 w-3" />
              {t("iconPicker.color")}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLORS.map((c) => {
                const selected = current.color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onChange({ ...current, color: c })}
                    className={`relative h-6 w-6 rounded-full transition-all duration-200 hover:scale-110 flex items-center justify-center ${
                      selected ? "ring-2 ring-offset-2 ring-offset-background" : "hover:shadow-lg"
                    }`}
                    style={{
                      backgroundColor: c,
                      ringColor: selected ? c : undefined,
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
                    const selected = name === current.name;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => onChange({ ...current, name })}
                        className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 ${
                          selected
                            ? "scale-110 border-transparent"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:scale-105"
                        }`}
                        style={selected ? {
                          backgroundColor: current.color + "20",
                          color: current.color,
                          boxShadow: `0 0 0 1.5px ${current.color}50, 0 2px 8px ${current.color}20`,
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
        </div>
      )}
    </div>
  );
}
