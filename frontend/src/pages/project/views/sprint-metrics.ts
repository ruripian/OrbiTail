/**
 * 스프린트 지표 계산 — 화면 여러 곳(목록 카드·상세 헤더·번다운)이 같은 정의를 쓰게 모아둔다.
 *
 * **포인트 우선, 건수 폴백.** estimate_point 를 안 쓰는 프로젝트도 있으므로,
 * 스프린트 안에 추정치가 하나도 없으면 건수(1건=1)로 세어 화면이 0 으로 죽지 않게 한다.
 * 어느 기준으로 셌는지는 `unit` 으로 알려주고, 화면이 "pt" / "건" 을 골라 쓴다.
 */
import type { Issue, State } from "@/types";

export type StateGroup = "backlog" | "unstarted" | "started" | "completed" | "cancelled";

/** 표시 순서 — 왼쪽에서 오른쪽으로 진행되는 흐름 */
export const GROUP_ORDER: StateGroup[] = [
  "backlog", "unstarted", "started", "completed", "cancelled",
];

export const GROUP_LABEL: Record<StateGroup, string> = {
  backlog: "백로그",
  unstarted: "할 일",
  started: "진행 중",
  completed: "완료",
  cancelled: "취소",
};

/** 분포 막대 색 — 상태 색은 프로젝트마다 달라서 그룹 단위 고정색을 쓴다 */
export const GROUP_COLOR: Record<StateGroup, string> = {
  backlog: "#A3A3A3",
  unstarted: "#F0AD4E",
  started: "#5E6AD2",
  completed: "#26B55E",
  cancelled: "#D94F4F",
};

export function groupOf(issue: Issue, stateMap: Map<string, State>): StateGroup {
  return (stateMap.get(issue.state ?? "")?.group as StateGroup) ?? "backlog";
}

export interface SprintMetrics {
  /** "pt" = 추정치 기준, "count" = 건수 기준(추정치가 하나도 없을 때) */
  unit: "pt" | "count";
  total: number;
  done: number;
  /** 완료율 0~100 */
  percent: number;
  /** 그룹별 합계 — 분포 막대와 그룹 헤더가 함께 쓴다 */
  byGroup: Record<StateGroup, { value: number; count: number }>;
}

/** 이슈 하나의 무게. unit 이 "count" 면 1건=1. */
export const weightOf = (issue: Issue, unit: "pt" | "count") =>
  unit === "pt" ? (issue.estimate_point ?? 0) : 1;

export function sprintMetrics(issues: Issue[], stateMap: Map<string, State>): SprintMetrics {
  const hasEstimates = issues.some((i) => (i.estimate_point ?? 0) > 0);
  const unit: "pt" | "count" = hasEstimates ? "pt" : "count";

  const byGroup = Object.fromEntries(
    GROUP_ORDER.map((g) => [g, { value: 0, count: 0 }]),
  ) as SprintMetrics["byGroup"];

  let total = 0;
  let done = 0;
  for (const issue of issues) {
    const g = groupOf(issue, stateMap);
    const w = weightOf(issue, unit);
    byGroup[g].value += w;
    byGroup[g].count += 1;
    total += w;
    /* 취소는 "끝난 일" 이지만 완료로 세면 완료율이 부풀려진다 — 분모에서만 빼지 않고
       분자에도 넣지 않는다(취소분은 막대에서 회색 구간으로 따로 보인다). */
    if (g === "completed") done += w;
  }

  return {
    unit, total, done,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    byGroup,
  };
}

/** "34 / 89pt" 처럼 단위를 붙여 준다 */
export const formatMetric = (value: number, unit: "pt" | "count") =>
  unit === "pt" ? `${value}pt` : `${value}건`;
