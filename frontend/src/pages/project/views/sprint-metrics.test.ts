import { describe, it, expect } from "vitest";
import { sprintMetrics, weightOf, groupOf, formatMetric } from "./sprint-metrics";
import type { Issue, State } from "@/types";

const state = (id: string, group: string) => ({ id, group } as State);
const STATES = [
  state("s-backlog", "backlog"),
  state("s-todo", "unstarted"),
  state("s-doing", "started"),
  state("s-done", "completed"),
  state("s-cancel", "cancelled"),
];
const stateMap = new Map(STATES.map((s) => [s.id, s]));

const issue = (stateId: string, points: number | null): Issue =>
  ({ id: `i-${stateId}-${points}`, state: stateId, estimate_point: points } as Issue);

describe("sprintMetrics", () => {
  it("추정치가 있으면 포인트로 센다 — 큰 이슈와 작은 이슈를 같은 무게로 세지 않는다", () => {
    const m = sprintMetrics([issue("s-done", 13), issue("s-todo", 1)], stateMap);
    expect(m.unit).toBe("pt");
    expect(m.total).toBe(14);
    expect(m.done).toBe(13);
    expect(m.percent).toBe(93); // 건수로 세면 50% 가 나온다
  });

  it("추정치가 하나도 없으면 건수로 폴백한다 — 화면이 0 으로 죽지 않게", () => {
    const m = sprintMetrics([issue("s-done", null), issue("s-todo", null)], stateMap);
    expect(m.unit).toBe("count");
    expect(m.total).toBe(2);
    expect(m.done).toBe(1);
    expect(m.percent).toBe(50);
  });

  it("취소는 완료로 세지 않는다 — 완료율이 부풀려지면 안 된다", () => {
    const m = sprintMetrics([issue("s-cancel", 5), issue("s-todo", 5)], stateMap);
    expect(m.done).toBe(0);
    expect(m.percent).toBe(0);
    expect(m.byGroup.cancelled.value).toBe(5);
  });

  it("그룹별 합계와 건수를 함께 낸다", () => {
    const m = sprintMetrics(
      [issue("s-doing", 3), issue("s-doing", 5), issue("s-backlog", 2)],
      stateMap,
    );
    expect(m.byGroup.started).toEqual({ value: 8, count: 2 });
    expect(m.byGroup.backlog).toEqual({ value: 2, count: 1 });
    expect(m.byGroup.completed).toEqual({ value: 0, count: 0 });
  });

  it("이슈가 없으면 0으로 나누지 않는다", () => {
    const m = sprintMetrics([], stateMap);
    expect(m.total).toBe(0);
    expect(m.percent).toBe(0);
  });

  it("추정치가 없는 이슈는 pt 모드에서 0으로 잡힌다", () => {
    const m = sprintMetrics([issue("s-done", 8), issue("s-todo", null)], stateMap);
    expect(m.unit).toBe("pt");
    expect(m.total).toBe(8);
  });
});

describe("groupOf / weightOf / formatMetric", () => {
  it("상태를 모르면 백로그로 본다", () => {
    expect(groupOf({ state: "없는-상태" } as Issue, stateMap)).toBe("backlog");
    expect(groupOf({ state: null } as unknown as Issue, stateMap)).toBe("backlog");
  });

  it("count 모드에서는 포인트와 무관하게 1", () => {
    expect(weightOf(issue("s-todo", 13), "count")).toBe(1);
    expect(weightOf(issue("s-todo", 13), "pt")).toBe(13);
    expect(weightOf(issue("s-todo", null), "pt")).toBe(0);
  });

  it("단위를 붙여 표기한다", () => {
    expect(formatMetric(34, "pt")).toBe("34pt");
    expect(formatMetric(3, "count")).toBe("3건");
  });
});
