/**
 * 스프린트 지표 계산 — 화면 여러 곳(목록 카드·상세 헤더·번다운)이 같은 정의를 쓰게 모아둔다.
 *
 * **이슈 건수 기준.** 예상 포인트 기준으로 세던 것을 걷어냈다 — 추정치를 채우지 않는 팀에서는
 * "13pt / 26pt" 가 무엇을 센 숫자인지 읽히지 않았다.
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
  /** 이슈 수 */
  total: number;
  done: number;
  /** 완료율 0~100 */
  percent: number;
  /** 그룹별 이슈 수 — 분포 막대와 범례가 함께 쓴다 */
  byGroup: Record<StateGroup, number>;
}

export function sprintMetrics(issues: Issue[], stateMap: Map<string, State>): SprintMetrics {
  const byGroup = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0])) as SprintMetrics["byGroup"];

  let done = 0;
  for (const issue of issues) {
    const g = groupOf(issue, stateMap);
    byGroup[g] += 1;
    /* 취소는 "끝난 일" 이지만 완료로 세면 완료율이 부풀려진다 — 분모에는 두고 분자에는 넣지 않는다
       (취소분은 막대에서 빨간 구간으로 따로 보인다). */
    if (g === "completed") done += 1;
  }

  const total = issues.length;
  return {
    total, done,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    byGroup,
  };
}

/** "3건" */
export const formatCount = (value: number) => `${value}건`;
