import { describe, it, expect } from "vitest";
import { sprintMetrics, groupOf, formatCount } from "./sprint-metrics";
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

let seq = 0;
const issue = (stateId: string, points: number | null = null): Issue =>
  ({ id: `i-${seq++}`, state: stateId, estimate_point: points } as Issue);

describe("sprintMetrics", () => {
  it("이슈 수로 센다 — 예상 포인트는 지표에 쓰지 않는다", () => {
    const m = sprintMetrics([issue("s-done", 13), issue("s-todo", 1)], stateMap);
    expect(m.total).toBe(2);
    expect(m.done).toBe(1);
    expect(m.percent).toBe(50);
  });

  it("취소는 완료로 세지 않는다 — 완료율이 부풀려지면 안 된다", () => {
    const m = sprintMetrics([issue("s-cancel"), issue("s-todo")], stateMap);
    expect(m.done).toBe(0);
    expect(m.percent).toBe(0);
    expect(m.byGroup.cancelled).toBe(1);
  });

  it("그룹별 건수를 낸다", () => {
    const m = sprintMetrics([issue("s-doing"), issue("s-doing"), issue("s-backlog")], stateMap);
    expect(m.byGroup.started).toBe(2);
    expect(m.byGroup.backlog).toBe(1);
    expect(m.byGroup.completed).toBe(0);
  });

  it("이슈가 없으면 0으로 나누지 않는다", () => {
    const m = sprintMetrics([], stateMap);
    expect(m.total).toBe(0);
    expect(m.percent).toBe(0);
  });
});

describe("groupOf / formatCount", () => {
  it("상태를 모르면 백로그로 본다", () => {
    expect(groupOf({ state: "없는-상태" } as Issue, stateMap)).toBe("backlog");
    expect(groupOf({ state: null } as unknown as Issue, stateMap)).toBe("backlog");
  });

  it("건 단위로 표기한다", () => {
    expect(formatCount(3)).toBe("3건");
  });
});
