import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParentPicker } from "./parent-picker";
import type { Issue } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function mkIssue(id: string, sequence_id: number, title: string): Issue {
  return {
    id,
    sequence_id,
    title,
    description_html: "",
    state: null,
    state_detail: null,
    priority: "none",
    assignees: [],
    assignee_details: [],
    parent: null,
    project: "p1",
    workspace: "w1",
    is_field: false,
    sort_order: 0,
    created_at: "",
    updated_at: "",
  } as unknown as Issue;
}

describe("ParentPicker — 자기/조상 제외 로직", () => {
  const issues = [
    mkIssue("A", 1, "alpha"),
    mkIssue("B", 2, "bravo"),
    mkIssue("C", 3, "charlie"),
    mkIssue("D", 4, "delta"),
  ];

  it("자기 자신은 후보에서 제외", async () => {
    const user = userEvent.setup();
    render(
      <ParentPicker
        issues={issues}
        currentIssueId="A"
        excludeIds={[]}
        currentParentId={null}
        refPrefix="X"
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button"));

    expect(screen.queryByText("alpha")).toBeNull();
    expect(await screen.findByText("bravo")).toBeInTheDocument();
    expect(screen.getByText("charlie")).toBeInTheDocument();
    expect(screen.getByText("delta")).toBeInTheDocument();
  });

  it("excludeIds 의 조상도 후보에서 제외", async () => {
    const user = userEvent.setup();
    render(
      <ParentPicker
        issues={issues}
        currentIssueId="A"
        excludeIds={["B", "C"]}
        currentParentId={null}
        refPrefix="X"
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button"));

    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.queryByText("bravo")).toBeNull();
    expect(screen.queryByText("charlie")).toBeNull();
    expect(await screen.findByText("delta")).toBeInTheDocument();
  });

  it("선택 시 onChange 호출", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ParentPicker
        issues={issues}
        currentIssueId="A"
        excludeIds={[]}
        currentParentId={null}
        refPrefix="X"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button"));
    await user.click(await screen.findByText("bravo"));

    expect(onChange).toHaveBeenCalledWith("B");
  });
});
