/**
 * 커버 이미지 렌더러 — 다이얼로그 미리보기 / 문서 페이지 표시 공용.
 *
 * 모델:
 *   - 원본 이미지를 손상 없이 그대로 사용.
 *   - 컨테이너(width × height) 안에 이미지를 "cover baseline × zoom" 크기로 배치.
 *     baseScale = max(containerW/naturalW, containerH/naturalH) * zoom
 *       (zoom=1 이면 정확히 object-fit:cover와 동일 — 컨테이너를 완벽히 채우되 한 축은 잘림)
 *   - offsetX/offsetY ∈ [0, 100]: 이미지의 "어느 지점(%)"이 컨테이너 중앙에 오도록 할지.
 *     → 컨테이너 크기에 독립적인 의미. 다이얼로그 미리보기와 실제 표시가 일관.
 *
 * 경계 자동 클램프:
 *   - displayW = naturalW * baseScale, displayH = naturalH * baseScale
 *   - 이미지가 컨테이너를 덮도록 강제:
 *       offsetX ∈ [50*W/displayW, 100 - 50*W/displayW]   (displayW > W 일 때)
 *       offsetY ∈ [50*H/displayH, 100 - 50*H/displayH]   (displayH > H 일 때)
 *     한 축이 정확히 W/H에 맞으면 그 축은 50 고정.
 *
 * 드래그:
 *   - draggable=true 이면 pointer로 끌어 offsetX/Y 변경. 1px 이동 = 100/displayW(H) %.
 *   - 변경은 onOffsetChange(x, y) 로 부모에 위임.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  url: string;
  offsetX: number;
  offsetY: number;
  zoom: number;
  height: number;
  className?: string;
  style?: CSSProperties;
  draggable?: boolean;
  /** 드래그 또는 경계 밖 값 들어왔을 때 보정된 값을 부모에 통지. */
  onOffsetChange?: (x: number, y: number) => void;
  /** 오버레이(편집 버튼 등) */
  children?: ReactNode;
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

interface Measures {
  natural: { w: number; h: number } | null;
  containerW: number;
}

function computeBounds(containerW: number, containerH: number, natural: { w: number; h: number } | null, zoom: number) {
  if (!natural || !containerW) return { minX: 50, maxX: 50, minY: 50, maxY: 50, displayW: 0, displayH: 0 };
  const baseScale = Math.max(containerW / natural.w, containerH / natural.h) * zoom;
  const displayW = natural.w * baseScale;
  const displayH = natural.h * baseScale;
  const sx = displayW > containerW ? 50 * containerW / displayW : 50;
  const sy = displayH > containerH ? 50 * containerH / displayH : 50;
  return { minX: sx, maxX: 100 - sx, minY: sy, maxY: 100 - sy, displayW, displayH };
}

export function CoverView({
  url, offsetX, offsetY, zoom, height,
  className, style, draggable, onOffsetChange, children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<Measures>({ natural: null, containerW: 0 });

  /* 컨테이너 너비 관찰 — 높이 바뀔 때나 창 크기 바뀔 때 재측정 */
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setM((p) => ({ ...p, containerW: el.clientWidth }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const b = computeBounds(m.containerW, height, m.natural, zoom);
  /* 외부에서 들어온 offset이 경계 밖이면 즉시 내부적으로 클램프하고 부모에게 통지 */
  useEffect(() => {
    if (!m.natural || !m.containerW || !onOffsetChange) return;
    const cx = clamp(offsetX, b.minX, b.maxX);
    const cy = clamp(offsetY, b.minY, b.maxY);
    if (Math.abs(cx - offsetX) > 0.01 || Math.abs(cy - offsetY) > 0.01) {
      onOffsetChange(cx, cy);
    }
    // 의존성: bounds 변경 시점만 (zoom/height/natural/containerW 변화).
    // offsetX/Y는 의존성에서 제외 — 부모 보정 루프 방지.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.minX, b.maxX, b.minY, b.maxY, m.natural, m.containerW]);

  /* 표시 위치 계산 — 항상 경계 내로 안전하게 보이도록 즉시 클램프 값을 사용 */
  const viewX = clamp(offsetX, b.minX, b.maxX);
  const viewY = clamp(offsetY, b.minY, b.maxY);
  const imgStyle: CSSProperties = (m.natural && m.containerW)
    ? {
        position: "absolute",
        width:  b.displayW,
        height: b.displayH,
        left:   m.containerW / 2 - (viewX / 100) * b.displayW,
        top:    height / 2        - (viewY / 100) * b.displayH,
        maxWidth: "none",
        maxHeight: "none",
        userSelect: "none",
        pointerEvents: "none",
      }
    : { opacity: 0 };

  /* 드래그 — 1px = 100/displayW(%) 변화. displayW 없으면 노-옵. */
  const dragRef = useRef<{ sx: number; sy: number; sox: number; soy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable || !onOffsetChange || !m.natural || !m.containerW) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, sox: viewX, soy: viewY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !onOffsetChange) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    /* 우로 끌면(dx>0) 더 좌측 이미지 중앙 오게 → offsetX 감소 */
    let nx = dragRef.current.sox - (dx / Math.max(1, b.displayW)) * 100;
    let ny = dragRef.current.soy - (dy / Math.max(1, b.displayH)) * 100;
    nx = clamp(nx, b.minX, b.maxX);
    ny = clamp(ny, b.minY, b.maxY);
    onOffsetChange(nx, ny);
  };
  const onPointerEnd = () => { dragRef.current = null; };

  return (
    <div
      ref={containerRef}
      data-cover-container
      className={cn(
        "relative bg-muted overflow-hidden",
        draggable && "cursor-grab active:cursor-grabbing select-none",
        className,
      )}
      style={{ height, ...style }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <img
        src={url}
        alt=""
        data-cover-img
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          setM((p) => ({ ...p, natural: { w: img.naturalWidth, h: img.naturalHeight } }));
        }}
        style={imgStyle}
      />
      {children}
    </div>
  );
}
