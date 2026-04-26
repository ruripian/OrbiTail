import { cn } from "@/lib/utils";

/**
 * Orbit 메타포의 작은 SVG 글리프 모음 (Phase 3.1).
 *
 * 큰 OrbiTailOrbit 컴포넌트(브랜드 모먼트용)와 달리 정적·작고 가벼움.
 *  - <OrbitGlyph />        : 단일 타원 + 점 1개, 어디든 inline 사용
 *  - <OrbitAvatar />       : 워크스페이스 아바타 (행성 갯수로 미읽음 등 표현)
 *  - <SprintProgressOrbit />: ratio(0~1)로 호선 위 행성 위치, 진행률 시각화
 *
 * 색은 모두 currentColor — 부모의 text-* 색상을 상속받는다.
 */

interface OrbitGlyphProps {
  size?: number;
  className?: string;
}

/** 가장 단순한 형태 — 타원 + 점 1개. EmptyState 등에서 사용. */
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
      <ellipse
        cx="18" cy="18" rx="15" ry="6"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.5"
        transform="rotate(-22 18 18)"
      />
      <circle cx="18" cy="18" r="5" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

interface OrbitAvatarProps {
  /** SVG 컨테이너 size */
  size?: number;
  /** 행성 갯수 — 1~3 권장. unread/active count 등을 매핑 */
  planets?: number;
  /** 행성 색상. 기본 currentColor (부모 text-*) */
  color?: string;
  className?: string;
  /** 접근성 라벨 — 지정하면 role="img" */
  label?: string;
}

/**
 * 워크스페이스 아바타. 작은 궤도 + 1~3개 행성.
 * 알림이 있으면 행성 수 늘려 시각 신호.
 */
export function OrbitAvatar({
  size = 32,
  planets = 1,
  color = "currentColor",
  className,
  label,
}: OrbitAvatarProps) {
  const n = Math.max(1, Math.min(3, planets));
  // 행성 위치 (degrees, 0=오른쪽). n에 따라 균등 분포.
  const angles = n === 1 ? [25] : n === 2 ? [25, 205] : [10, 130, 250];
  const cx = 16;
  const cy = 16;
  const rx = 13;
  const ry = 5;
  const tilt = -22; // 궤도 기울기

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
      <ellipse
        cx={cx} cy={cy} rx={rx} ry={ry}
        fill="none"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.45"
        transform={`rotate(${tilt} ${cx} ${cy})`}
      />
      {/* 중심 행성 */}
      <circle cx={cx} cy={cy} r="4" fill={color} opacity="0.9" />
      {/* 위성 행성들 */}
      {angles.map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const tiltRad = (tilt * Math.PI) / 180;
        // 타원 점 → 기울기 적용
        const ex = Math.cos(rad) * rx;
        const ey = Math.sin(rad) * ry;
        const x = cx + ex * Math.cos(tiltRad) - ey * Math.sin(tiltRad);
        const y = cy + ex * Math.sin(tiltRad) + ey * Math.cos(tiltRad);
        return <circle key={i} cx={x} cy={y} r="1.6" fill={color} opacity="0.85" />;
      })}
    </svg>
  );
}

interface SprintProgressOrbitProps {
  /** 진행률 0~1. 행성이 호선의 시작에서 끝까지 이동 */
  ratio: number;
  size?: number;
  className?: string;
  /** 호선 색상 */
  trackColor?: string;
  /** 행성/완료된 호선 색상. 기본 currentColor */
  color?: string;
  label?: string;
}

/**
 * 호선 위에 행성 1개. 진행률 시각화.
 * Sprint burndown의 컴팩트 변형이나 dashboard 진행 카드에 사용.
 */
export function SprintProgressOrbit({
  ratio,
  size = 96,
  className,
  trackColor,
  color = "currentColor",
  label,
}: SprintProgressOrbitProps) {
  const r = Math.max(0, Math.min(1, ratio));
  // 반원호 — 좌→우. ratio=0이면 시작(왼쪽), 1이면 끝(오른쪽).
  // path: M 8 60 A 40 40 0 0 1 88 60 (반원 위쪽)
  const cx = 48;
  const cy = 60;
  const radius = 40;
  // 행성 위치: 반원호상 angle = 180° → 0° 사이 보간
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
      {/* 전체 호 (track) */}
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke={trackColor ?? color}
        strokeWidth="1.5"
        opacity="0.2"
      />
      {/* 진행된 호 (progress) — stroke-dasharray로 비율만 그림 */}
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        // 호 길이 = π × radius. dasharray로 비율 표현.
        strokeDasharray={`${r * Math.PI * radius} ${(1 - r) * Math.PI * radius + 1}`}
      />
      {/* 행성 */}
      <circle cx={px} cy={py} r="4.5" fill={color} />
      <circle cx={px} cy={py} r="1.6" fill="white" opacity="0.85" />
    </svg>
  );
}
