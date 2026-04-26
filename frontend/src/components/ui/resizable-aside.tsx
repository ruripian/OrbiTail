import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** localStorage 키 — 사용자별 너비 영구 저장 */
  storageKey: string;
  /** 기본/최소 너비(px). 현재 디자인의 너비를 minWidth로 두고 그 이상부터 확대 가능. */
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  /** 핸들 위치 — "left": 사이드가 우측에 위치(border-l), 핸들은 좌측 가장자리. "right": 사이드가 좌측(border-r), 핸들은 우측 가장자리. */
  handleSide: "left" | "right";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  /** ARIA — 시각 장애인용 */
  ariaLabel?: string;
}

/** 드래그로 너비 조절되는 사이드 패널. 각 사용 위치마다 storageKey를 다르게 줘서 독립 저장. */
export function ResizableAside({
  storageKey, defaultWidth, minWidth, maxWidth = 720, handleSide,
  className, style, children, ariaLabel,
}: Props) {
  const min = minWidth ?? defaultWidth;
  const [width, setWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem(storageKey));
    return Number.isFinite(v) && v >= min && v <= maxWidth ? v : defaultWidth;
  });
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ref = dragRef.current;
    if (!ref) return;
    const dx = e.clientX - ref.startX;
    /* 핸들이 좌측이면 좌측으로 끌수록 폭 확장(=dx 음수면 +) */
    const delta = handleSide === "left" ? -dx : dx;
    const next = Math.max(min, Math.min(maxWidth, ref.startW + delta));
    setWidth(next);
  };
  const onPointerEnd = () => {
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <aside
      className={cn("relative shrink-0 h-full", className)}
      style={{ width, ...style }}
      aria-label={ariaLabel}
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="패널 너비 조정"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className={cn(
          "absolute top-0 bottom-0 w-1.5 cursor-col-resize z-10 group",
          handleSide === "left" ? "-left-0.5" : "-right-0.5",
        )}
      >
        {/* 시각 표시 — 호버/드래그 시 살짝 보이는 라인 */}
        <div className={cn(
          "absolute top-0 bottom-0 w-px bg-primary/0 group-hover:bg-primary/40 transition-colors",
          handleSide === "left" ? "left-1/2" : "left-1/2",
        )} />
      </div>
    </aside>
  );
}
