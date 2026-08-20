import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
  }),
}));

import { DemoBadge } from "./DemoBadge";
import { useDemoStore } from "@/stores/demoStore";

const NOW = new Date("2026-08-20T00:00:00Z");

describe("DemoBadge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useDemoStore.getState().clearDemo();
  });
  afterEach(() => vi.useRealTimers());

  it("데모 세션이 아니면 아무것도 그리지 않는다", () => {
    const { container } = render(<DemoBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("남은 시간을 시·분으로 보여준다", () => {
    /* 3시간 25분 뒤 만료 */
    useDemoStore.getState().startDemo("2026-08-20T03:25:00Z");
    render(<DemoBadge />);
    expect(screen.getByText("demo.badgeLabel")).toBeInTheDocument();
    expect(screen.getByText('demo.badgeRemaining:{"hours":3,"minutes":25}')).toBeInTheDocument();
  });

  it("이미 만료됐으면 라벨만 두고 남은 시간은 숨긴다", () => {
    useDemoStore.getState().startDemo("2026-08-19T23:00:00Z");
    render(<DemoBadge />);
    expect(screen.getByText("demo.badgeLabel")).toBeInTheDocument();
    expect(screen.queryByText(/demo.badgeRemaining/)).not.toBeInTheDocument();
  });
});
