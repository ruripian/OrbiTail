/**
 * OrbiTailOrbit — 로고 path 기반 궤도 행성 애니메이션
 *
 * 사용처: 로그인 페이지 배경, 홈 대시보드 중앙
 * 색상: 테마 CSS 변수(--primary) — currentColor 사용
 * 접근성: data-motion="minimal" 시 정지
 *
 * Props:
 *   size     — SVG 컨테이너 max-width (기본 800px)
 *   strokeW  — path stroke 두께 (기본 5)
 *   offsetY  — 수직 이동 (양수 = 아래, 기본 0)
 *   position — fixed(전체 화면) / absolute(부모 기준)
 */

import { useMotion } from "@/lib/motion-provider";

/** 로고에서 추출한 외곽 path (엣지만) */
const PATHS = {
  edge1:
    "M1019.15,248.06c22.67-7.81,44.88-16.99,67.48-25.03,156.91-55.81,334.02-102.64,500.02-119.98,88.5-9.24,240.85-15.79,317.82,33.19,103.46,65.83-13.09,194.28-70.3,248.33-93.83,88.65-217.16,164.86-329.34,228.66-130.09,73.98-276.43,147.63-416.42,200.58-79.04,29.9-132.84,30.62-212.77,2.27-106.2-37.67-195.6-110.1-274.46-188.52l123.29-64.4c55.18,48.23,114.87,98.82,183.72,126.38,58.31,23.34,89.4,17.27,145.96-4.99,29.51-11.61,59.59-24.62,88.69-37.31,85.72-37.37,170.39-77.71,252.33-122.67,1.08-.76,1.01-1.7.95-2.88-.33-6.63-2.06-16.12-3.23-22.88-12.81-73.69-46.21-143.51-95.7-199.24l-91.38,26.25c-52.57-32.26-109.49-58.89-169.84-73.09-4.57-1.08-9.88-1.52-14.23-2.77-1.14-.33-2.41-.38-2.59-1.9Z",
  edge2:
    "M1326.56,488.65c3.4,3.63,8.84,8.23,11.6,11.89.65.86,1.36,1.01.99,2.5-8.57,3.74-16.65,9.1-24.98,13.53-33,17.55-67.21,33.27-101.38,48.33-28.72-27.72-58.86-54.35-91.32-77.67-44.34-31.86-110.47-71.27-166.82-65.18-38.89,4.2-82.51,25.14-118.48,40.52-98.03,41.94-193.66,89.34-286.6,141.47,4.06,55.58,21.01,110.83,47.4,159.68,5.52,10.21,12.43,19.81,17.18,30.32-46.33,12.73-93.59,21.79-141.01,29.58-25.64-45.65-42.36-96.2-52.49-147.57-46.63,30.14-93.9,59.35-138.42,92.58-35.01,26.13-76.88,59.04-102.5,94.5-2.46,3.41-10.04,13.27-8.12,16.92,2.95,5.62,29.37,9.33,36.03,10,36.12,3.64,71.11,1.44,107-1,144.13-9.79,289.47-40.25,425.83-86.81,51.84,31.15,108.68,57.7,167.66,72.32,4.55,1.13,9.3,2.27,14.02,2.49.34,2.51-.08,1.57-1.41,2.09-164,63.25-351.44,118.81-526.21,140.79-95.79,12.05-239.78,19.72-328.74-21.02-157.05-71.92,6.56-232.72,82.88-295.84,157.77-130.47,364.58-236.52,550.8-321.2,55.25-25.13,116.82-53.82,174.16-72.84,171.52-56.9,340.74,60.04,452.93,179.62Z",
  edge3:
    "M1527.15,654.06c-16.61,103.49-61.41,202.37-130.48,281.01-157.09,178.84-405.1,240.5-628.5,153.47-45.5-17.72-89.94-41.84-129.01-70.99,63.65-15.85,126.53-34.78,188.51-56.1,198.62,79.99,415.08-8.78,516.01-192.37,4-7.27,8.17-19.24,12.63-25.37,3.4-4.67,24.58-12.55,31.21-15.79,38.9-19,77.08-39.42,115.32-59.68l24.32-14.17Z",
  edge4:
    "M675.74,263.65c-33.98,34.57-62.35,74.2-83.63,117.86-59.05,27.79-117.15,57.47-173.95,89.54,9.51-60.17,30.15-118.18,58.82-171.68C553.49,156.58,690.81,49.97,849.33,13.73c155.71-35.6,324.66-1.29,451.8,94.82-.83,1.34-2.02,1.29-3.32,1.66-22.64,6.44-45.95,11.01-68.66,17.34-37.21,10.36-73.83,22.75-110.61,34.47-158.14-57.28-325.98-17.21-442.8,101.63Z",
  edge5:
    "M1523.16,447.05c-13.08-59.21-35.23-116.13-66.59-167.92-1.67-2.76-10.61-14.7-10.3-16.45.48-2.66,8.08-3.71,10.69-4.33,47.57-11.19,103.93-18.66,152.69-23.31,39.64-3.79,105.99-9.23,143.54.46,26.92,6.95,11.64,23.95-.06,38.02-47.82,57.49-150.05,126.85-215.06,165.94-1.63.98-14.19,8.53-14.91,7.58Z",
} as const;

/** 궤도 행성 설정 */
const ORBITERS = [
  { pathKey: "edge1" as const, dur: "18s", r: 5, delay: "0s" },
  { pathKey: "edge2" as const, dur: "24s", r: 4, delay: "-8s" },
  { pathKey: "edge3" as const, dur: "12s", r: 4.5, delay: "-3s" },
  { pathKey: "edge4" as const, dur: "14s", r: 3.5, delay: "-5s" },
];

interface OrbiTailOrbitProps {
  /** SVG max-width (px). 기본 1200 */
  size?: number;
  /** path stroke 두께. 기본 5 */
  strokeW?: number;
  /** 수직 오프셋 (px). 양수=아래. 기본 0 */
  offsetY?: number;
  /** 위치 모드. fixed=전체 화면, absolute=부모 기준 */
  position?: "fixed" | "absolute";
  /** SVG filter id 접두사 — 같은 페이지에 여러 인스턴스 있을 때 충돌 방지 */
  idPrefix?: string;
}

export function OrbiTailOrbit({
  size = 1200,
  strokeW = 5,
  offsetY = 0,
  position = "fixed",
  idPrefix = "orb",
}: OrbiTailOrbitProps) {
  const { isRich } = useMotion();
  const filterId = `${idPrefix}-glow`;
  const translateY = offsetY ? `translateY(${offsetY}px)` : undefined;

  return (
    <div
      className={`orbitail-orbit pointer-events-none ${position} inset-0 overflow-hidden text-primary`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1945.78 1127.57"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: `min(90vw, ${size}px)`,
          height: "auto",
          transform: `translate(-50%, -50%)${translateY ? ` ${translateY}` : ""}`,
        }}
        fill="none"
      >
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
          </filter>

          {Object.entries(PATHS).map(([key, d]) => (
            <path key={key} id={`${idPrefix}-path-${key}`} d={d} />
          ))}
        </defs>

        {/* 배경 — 로고 엣지를 반투명 stroke로 렌더링 */}
        <g className="opacity-[0.08] dark:opacity-[0.15]" stroke="currentColor" strokeWidth={strokeW}>
          {Object.values(PATHS).map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>

        {/* 공전 행성들 — minimal 모드에서는 숨김 */}
        {isRich && ORBITERS.map(({ pathKey, dur, r, delay }, i) => (
          <g key={i}>
            <circle r={r * 2.5} fill="currentColor" opacity={0.3} filter={`url(#${filterId})`}>
              <animateMotion dur={dur} begin={delay} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${idPrefix}-path-${pathKey}`} />
              </animateMotion>
            </circle>
            <circle r={r} fill="currentColor" opacity={0.8}>
              <animateMotion dur={dur} begin={delay} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${idPrefix}-path-${pathKey}`} />
              </animateMotion>
            </circle>
            <circle r={r * 0.4} fill="white" opacity={0.9}>
              <animateMotion dur={dur} begin={delay} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${idPrefix}-path-${pathKey}`} />
              </animateMotion>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}
