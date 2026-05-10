/**
 * 프로젝트별 색 결정 — 마이 페이지 등 다중 프로젝트 통합 뷰에서 시각 구분에 사용.
 *
 * 정책:
 *   1. icon_prop 이 lucide 면 그 .color 우선 사용 (사용자가 명시적으로 지정한 색)
 *   2. 위 색이 다른 프로젝트와 hue 가 너무 가까우면 (충돌) hash 색으로 fallback
 *   3. icon_prop 이 image/없음/충돌 시 project_id 해시 → HSL 색 자동 생성
 *   4. hash 색이 다른 프로젝트와 충돌하면 +30deg 씩 shift (최대 12회 시도)
 *
 * 같은 프로젝트는 입력 순서와 무관하게 항상 같은 색을 받는 것이 이상적이지만,
 * 충돌 회피로 인해 입력 순서/구성이 바뀌면 hue 가 shift 될 수 있음.
 */
import { parseIconProp } from "@/components/ui/project-icon-picker";

export interface ProjectColorInput {
  id: string;
  icon_prop?: Record<string, unknown> | null;
}

/** 같은 hue 로 간주하는 거리 (degrees). 너무 좁으면 충돌 회피가 의미 없고 너무 넓으면 단조롭다. */
const HUE_DUPLICATE_THRESHOLD = 25;

/** 문자열 해시 → 0..359 hue 매핑. 안정적 (같은 입력 → 같은 출력). */
function hashStringToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function hslColor(hue: number): string {
  return `hsl(${hue}, 65%, 50%)`;
}

/** hex → hue (0..359). 무채색이면 -1. */
function hueOfHex(hex: string): number {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return -1;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return -1;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

/** 환형 hue 거리 (0..180) — 0과 360을 같다고 본다. */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function isHueClose(used: number[], hue: number, threshold = HUE_DUPLICATE_THRESHOLD): boolean {
  return used.some((u) => hueDistance(u, hue) < threshold);
}

/** 프로젝트 ID → 색(hex 또는 hsl) 매핑 빌드 */
export function buildProjectColorMap(projects: ProjectColorInput[]): Record<string, string> {
  const result: Record<string, string> = {};
  const usedHues: number[] = [];

  /* 중복 제거 — 같은 ID 가 여러번 들어와도 한 번만 처리 */
  const seen = new Set<string>();
  const unique: ProjectColorInput[] = [];
  for (const p of projects) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    unique.push(p);
  }

  /* 1차 패스 — 명시적 lucide 색이 있고 충돌 안 하면 그대로 사용 */
  const fallbacks: ProjectColorInput[] = [];
  for (const p of unique) {
    const icon = parseIconProp(p.icon_prop);
    if (icon.type === "lucide") {
      const h = hueOfHex(icon.color);
      if (h >= 0 && !isHueClose(usedHues, h)) {
        result[p.id] = icon.color;
        usedHues.push(h);
        continue;
      }
    }
    fallbacks.push(p);
  }

  /* 2차 패스 — hash 색 + 충돌 시 +30deg shift */
  for (const p of fallbacks) {
    const baseHue = hashStringToHue(p.id);
    let hue = baseHue;
    let attempt = 0;
    while (attempt < 12 && isHueClose(usedHues, hue)) {
      attempt++;
      hue = (baseHue + attempt * 30) % 360;
    }
    result[p.id] = hslColor(hue);
    usedHues.push(hue);
  }

  return result;
}
