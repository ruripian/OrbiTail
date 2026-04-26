import { ChevronsUp, ChevronUp, Minus, ChevronDown, MinusCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 이슈 우선순위 아이콘 + 색상 통합 상수
 *
 * 재사용 대상: 우선순위 표시가 있는 모든 곳
 * (TableView, IssueDetailPage, IssueCreateDialog, TimelineView, BoardView 등)
 *
 * 사용:
 *   const Icon = PRIORITY_ICONS[issue.priority];          // 기존 — chevron 아이콘
 *   <PriorityGlyph priority={p} />                        // 신규 — 형태 시그널 (Phase 2.1)
 *   const color = PRIORITY_COLOR[issue.priority];          // hex (inline style 용)
 *   const label = t(PRIORITY_LABEL_KEY[issue.priority]);
 *
 * Phase 2.1 — 색은 OKLCH 단일 hue 그라디언트로 통일됐다 (tokens.css).
 *   색만으로 5종을 구분하기 어려우니 PRIORITY_SHAPE의 형태(◆▲●○·)와 함께 쓴다.
 */

export type Priority = "urgent" | "high" | "medium" | "low" | "none";

export const PRIORITY_LIST: Priority[] = ["urgent", "high", "medium", "low", "none"];

export const PRIORITY_ICONS: Record<Priority, LucideIcon> = {
  urgent: ChevronsUp,   // 이중 상향 화살 — 긴급
  high:   ChevronUp,    // 단일 상향 화살 — 높음
  medium: Minus,        // 가로 선 — 보통
  low:    ChevronDown,  // 단일 하향 화살 — 낮음
  none:   MinusCircle,  // 원 안 가로 선 — 없음
};

/** PriorityGlyph가 렌더하는 형태 — 색맹/저시력 사용자도 식별 가능하게 */
export type PriorityShape = "diamond" | "triangle" | "circle" | "ring" | "dot";

export const PRIORITY_SHAPE: Record<Priority, PriorityShape> = {
  urgent: "diamond",   // ◆ 채움 — 가장 강한 시각 무게
  high:   "triangle",  // ▲ 채움 — 위로 향한 강조
  medium: "circle",    // ● 채움 — 중립 강조
  low:    "ring",      // ○ 외곽선 — 약한 강조
  none:   "dot",       // · 작은 점선 ring — 없음
};

/**
 * Hex 폴백 — inline style용 (예: `style={{ backgroundColor: PRIORITY_COLOR.high }}`).
 * tokens.css의 OKLCH 토큰과 시각적으로 매칭. 가능하면 var(--priority-X) 사용을 권장.
 */
export const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: "#b21e2c",   // oklch(0.50 0.22 25)
  high:   "#d54d57",   // oklch(0.62 0.18 25)
  medium: "#d6a05c",   // oklch(0.74 0.14 50)
  low:    "#cfc679",   // oklch(0.82 0.08 90)
  none:   "#c9c9d0",   // oklch(0.85 0.01 260)
};

/** i18n 번역 키 매핑 — t(PRIORITY_LABEL_KEY[p])로 라벨 조회 */
export const PRIORITY_LABEL_KEY: Record<Priority, string> = {
  urgent: "issues.priority.urgent",
  high:   "issues.priority.high",
  medium: "issues.priority.medium",
  low:    "issues.priority.low",
  none:   "issues.priority.none",
};
