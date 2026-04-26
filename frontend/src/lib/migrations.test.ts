import { describe, it, expect } from "vitest";
import { runLocalStorageMigrations } from "./migrations";

const FLAG = "orbitail.migrations.v1";

describe("runLocalStorageMigrations", () => {
  it("legacy snake_case 키를 dot-notation 으로 옮기고 원본 삭제", () => {
    localStorage.setItem("orbitail_graph_showIds", "true");
    localStorage.setItem("orbitail_graph_layout", "force");

    runLocalStorageMigrations();

    expect(localStorage.getItem("orbitail.graph.showIds")).toBe("true");
    expect(localStorage.getItem("orbitail.graph.layout")).toBe("force");
    expect(localStorage.getItem("orbitail_graph_showIds")).toBeNull();
    expect(localStorage.getItem("orbitail_graph_layout")).toBeNull();
    expect(localStorage.getItem(FLAG)).toBe("1");
  });

  it("flag 가 이미 있으면 no-op", () => {
    localStorage.setItem(FLAG, "1");
    localStorage.setItem("orbitail_graph_showIds", "true");

    runLocalStorageMigrations();

    // legacy 키가 그대로 남아 있어야 한다 (마이그레이션 실행 안 됨)
    expect(localStorage.getItem("orbitail_graph_showIds")).toBe("true");
    expect(localStorage.getItem("orbitail.graph.showIds")).toBeNull();
  });

  it("두 번 호출해도 idempotent — 두 번째는 아무것도 바꾸지 않음", () => {
    localStorage.setItem("orbitail_graph_repulsion", "150");

    runLocalStorageMigrations();
    const afterFirst = localStorage.getItem("orbitail.graph.repulsion");

    // 두 번째 실행 — 새 키를 임의로 바꾼 뒤 호출했을 때 덮어쓰지 않아야 한다
    localStorage.setItem("orbitail.graph.repulsion", "999");
    runLocalStorageMigrations();

    expect(afterFirst).toBe("150");
    expect(localStorage.getItem("orbitail.graph.repulsion")).toBe("999");
  });

  it("새 키가 이미 존재하면 legacy 값으로 덮어쓰지 않음", () => {
    localStorage.setItem("orbitail_graph_layout", "old");
    localStorage.setItem("orbitail.graph.layout", "new");

    runLocalStorageMigrations();

    expect(localStorage.getItem("orbitail.graph.layout")).toBe("new");
    expect(localStorage.getItem("orbitail_graph_layout")).toBeNull();
  });

  it("legacy cohesion 키는 흔적 없이 제거", () => {
    localStorage.setItem("orbitail_graph_cohesion", "0.5");

    runLocalStorageMigrations();

    expect(localStorage.getItem("orbitail_graph_cohesion")).toBeNull();
  });
});
