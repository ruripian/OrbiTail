import { Circle, CircleDashed, CircleDot, CheckCircle2, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 프로젝트 상태(state.group) → lucide 아이콘 매핑
 *
 * 재사용: 이슈 상태 표시하는 모든 곳(TableView, TimelineView, BoardView, etc.)
 *
 * 사용:
 *   const Icon = STATE_ICONS[state.group] ?? Circle;
 *   <Icon className="h-3.5 w-3.5" style={{ color: state.color }} />
 */

export type StateGroup = "backlog" | "unstarted" | "started" | "completed" | "cancelled";

export const STATE_GROUP_LIST: StateGroup[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

export const STATE_ICONS: Record<string, LucideIcon> = {
  backlog:   CircleDashed,   // 점선 원 — 미정
  unstarted: Circle,         // 빈 원 — 시작 전
  started:   CircleDot,      // 중심점 원 — 진행 중
  completed: CheckCircle2,   // 체크 원 — 완료
  cancelled: XCircle,        // X 원 — 취소
};

/**
 * 상태 group 대표 색 — hex (inline style / SVG 전용)
 *
 * 개별 상태는 사용자가 지정한 state.color 를 쓴다. 이 상수는 group 단위로만 그릴 수 있는 곳
 * (필터 드롭다운, 그래프 엣지 그라디언트처럼 특정 state 를 특정할 수 없는 자리)의 폴백이다.
 * 배경/텍스트가 필요한 칩류는 tokens.css 의 var(--state-{group}-fill/text) 를 쓴다.
 */
export const STATE_GROUP_COLOR: Record<StateGroup, string> = {
  backlog:   "#94a3b8",
  unstarted: "#64748b",
  started:   "#3b82f6",
  completed: "#22c55e",
  cancelled: "#ef4444",
};

/** 상태 group 표시 이름 — 제품 용어라 번역하지 않고 영문 그대로 쓴다 */
export const STATE_GROUP_LABEL: Record<StateGroup, string> = {
  backlog:   "Backlog",
  unstarted: "To do",
  started:   "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** 상태 group 키로 대표 색을 안전하게 조회 (없으면 중립 회색 — 상태 미지정 노드/엣지용) */
export function getStateGroupColor(group: string | undefined | null): string {
  return STATE_GROUP_COLOR[(group ?? "") as StateGroup] ?? "#6b7280";
}

/** 상태 group 키로 아이콘을 안전하게 조회 (없으면 Circle 폴백) */
export function getStateIcon(group: string | undefined | null): LucideIcon {
  return STATE_ICONS[group ?? "backlog"] ?? Circle;
}
