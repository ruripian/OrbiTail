import { cn } from "@/lib/utils";

/**
 * Orbit 메타포 작은 SVG 글리프 모음 (Phase 3.1 — 재설계).
 *
 * 메인 OrbiTailOrbit 의 "행성이 path 위를 따라 도는" 컨셉을 정적으로 단순화.
 * 큰 행성 + 한쪽으로 비스듬히 지나가는 호선 + 호선 위 작은 위성 = "공전 위 정지 사진".
 * (이전 "타원 + 가운데 점" 디자인은 눈동자처럼 보여 교체)
 *
 *  - <OrbitGlyph />        : 행성 1개 + 호선 1개 + 위성 1개. 가장 작은 단위.
 *  - <OrbitAvatar />       : 워크스페이스 아바타. planets 1~3개 = 위성 갯수 (미읽음 등).
 *  - <SprintProgressOrbit />: ratio(0~1) 로 호선 위 위성 위치 보간. 진행률 시각화.
 *
 * 색은 currentColor 상속.
 */

interface OrbitGlyphProps {
  size?: number;
  className?: string;
}

/** 가장 단순한 형태 — 큰 행성 + 비스듬한 호선 + 호선 위 작은 위성. */
export function OrbitGlyph({ size = 36, className }: OrbitGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      {/* 호선(궤도) — 좌상에서 우하로 비스듬히. 행성 뒤에서 앞으로 이어지는 느낌 */}
      <path
        d="M 4 22 Q 14 8, 32 14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.5"
        fill="none"
      />
      {/* 본 행성 — 우하로 살짝 치우쳐 호선과 겹침 */}
      <circle cx="20" cy="22" r="6" fill="currentColor" opacity="0.9" />
      {/* 위성 — 호선 우측 끝점 근처 */}
      <circle cx="32" cy="14" r="1.6" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

interface OrbitAvatarProps {
  /** SVG 컨테이너 size */
  size?: number;
  /** 위성 갯수 — 1~3 권장. unread/active count 등 매핑 */
  planets?: number;
  /** 색상. 기본 currentColor */
  color?: string;
  className?: string;
  /** 접근성 라벨 */
  label?: string;
}

/**
 * 워크스페이스 아바타 — 본 행성 + 호선 + 위성 1~3개.
 * 이전 "타원 + 정렬된 위성" → 눈동자 형태였음. 호선 한 줄 위 균등 배치로 변경.
 */
export function OrbitAvatar({
  size = 32,
  planets = 1,
  color = "currentColor",
  className,
  label,
}: OrbitAvatarProps) {
  const n = Math.max(1, Math.min(3, planets));

  /* 호선 path: 좌하에서 우상으로 완만한 곡선.
     SVG 좌표계상 32x32 viewBox. 행성은 호선 아래쪽에 위치. */
  const ARC_PATH = "M 3 22 Q 12 8, 29 12";
  /* 호선 위 t(0..1) 지점 좌표를 quadratic bezier 공식으로 계산 */
  const arcPoint = (t: number) => {
    const x0 = 3,  y0 = 22;
    const cx = 12, cy = 8;
    const x1 = 29, y1 = 12;
    const it = 1 - t;
    return {
      x: it * it * x0 + 2 * it * t * cx + t * t * x1,
      y: it * it * y0 + 2 * it * t * cy + t * t * y1,
    };
  };
  /* 위성 위치 — n개를 호선 끝쪽에 균등 분포 */
  const tValues =
    n === 1 ? [0.92] :
    n === 2 ? [0.55, 0.92] :
              [0.30, 0.62, 0.92];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={label ? "img" : "presentation"}
      aria-label={label}
      className={cn("shrink-0", className)}
    >
      {/* 호선 */}
      <path
        d={ARC_PATH}
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.45"
        fill="none"
      />
      {/* 본 행성 — 좌측 하단 */}
      <circle cx="14" cy="20" r="5" fill={color} opacity="0.9" />
      {/* 위성들 */}
      {tValues.map((t, i) => {
        const p = arcPoint(t);
        return <circle key={i} cx={p.x} cy={p.y} r="1.5" fill={color} opacity="0.8" />;
      })}
    </svg>
  );
}

interface SprintProgressOrbitProps {
  /** 진행률 0~1. 행성이 호선 시작 → 끝 */
  ratio: number;
  size?: number;
  className?: string;
  trackColor?: string;
  color?: string;
  label?: string;
}

/** 호선 위 행성 1개. ratio 로 위치 보간 — 진행률 시각화용. (디자인 그대로 유지) */
export function SprintProgressOrbit({
  ratio,
  size = 96,
  className,
  trackColor,
  color = "currentColor",
  label,
}: SprintProgressOrbitProps) {
  const r = Math.max(0, Math.min(1, ratio));
  const cx = 48;
  const cy = 60;
  const radius = 40;
  const angle = 180 - r * 180;
  const px = cx + radius * Math.cos((angle * Math.PI) / 180);
  const py = cy - radius * Math.sin((angle * Math.PI) / 180);

  return (
    <svg
      width={size}
      height={size * (72 / 96)}
      viewBox="0 0 96 72"
      fill="none"
      role={label ? "img" : "presentation"}
      aria-label={label}
      className={cn("shrink-0", className)}
    >
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke={trackColor ?? color}
        strokeWidth="1.5"
        opacity="0.2"
      />
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={`${r * Math.PI * radius} ${(1 - r) * Math.PI * radius + 1}`}
      />
      <circle cx={px} cy={py} r="4.5" fill={color} />
      <circle cx={px} cy={py} r="1.6" fill="white" opacity="0.85" />
    </svg>
  );
}
