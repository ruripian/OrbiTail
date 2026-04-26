import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RestorableListView, type Column, type Action } from "./RestorableListView";

interface Row {
  id: string;
  name: string;
  can_purge: boolean;
}

const cols: Column<Row>[] = [
  { id: "name", label: "Name", width: "flex-1", render: (r) => <span>{r.name}</span> },
];

const sampleRows: Row[] = [
  { id: "1", name: "alpha", can_purge: true },
  { id: "2", name: "beta", can_purge: false },
];

function renderView(props: Partial<Parameters<typeof RestorableListView<Row>>[0]> = {}) {
  return render(
    <RestorableListView<Row>
      rows={sampleRows}
      isLoading={false}
      rowKey={(r) => r.id}
      columns={cols}
      actions={[]}
      emptyState={{ icon: null, title: "Empty title", description: "Empty desc" }}
      {...props}
    />,
  );
}

describe("RestorableListView", () => {
  it("rows 비었을 때 EmptyState 노출", () => {
    renderView({ rows: [] });
    expect(screen.getByText("Empty title")).toBeInTheDocument();
    expect(screen.getByText("Empty desc")).toBeInTheDocument();
  });

  it("isLoading 일 때 Loading... 노출", () => {
    renderView({ isLoading: true });
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("visible=false 인 액션은 해당 행에서 렌더 안 됨", () => {
    const onClick = vi.fn();
    const actions: Action<Row>[] = [
      {
        id: "purge",
        label: "Purge",
        icon: null,
        visible: (r) => r.can_purge,
        onClick,
      },
    ];
    renderView({ actions });

    // alpha (can_purge=true) → 1 개, beta (false) → 0 개
    expect(screen.getAllByRole("button", { name: /purge/i })).toHaveLength(1);
  });

  it("disabled=true 인 액션 버튼은 비활성화", () => {
    const actions: Action<Row>[] = [
      { id: "act", label: "Act", icon: null, disabled: () => true, onClick: vi.fn() },
    ];
    renderView({ actions });
    const buttons = screen.getAllByRole("button", { name: /act/i });
    buttons.forEach((b) => expect(b).toBeDisabled());
  });

  it("confirmMessage 거부 시 onClick 호출 안 됨", () => {
    const onClick = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const actions: Action<Row>[] = [
      { id: "del", label: "Del", icon: null, confirmMessage: "정말요?", onClick },
    ];
    renderView({ actions });

    fireEvent.click(screen.getAllByRole("button", { name: /del/i })[0]);
    expect(confirmSpy).toHaveBeenCalledWith("정말요?");
    expect(onClick).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("confirmMessage 수락 시 onClick 호출", () => {
    const onClick = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const actions: Action<Row>[] = [
      { id: "del", label: "Del", icon: null, confirmMessage: "정말요?", onClick },
    ];
    renderView({ actions });

    fireEvent.click(screen.getAllByRole("button", { name: /del/i })[0]);
    expect(onClick).toHaveBeenCalledWith(sampleRows[0]);
    confirmSpy.mockRestore();
  });

  it("confirmMessage 없으면 즉시 onClick", () => {
    const onClick = vi.fn();
    const actions: Action<Row>[] = [
      { id: "act", label: "Act", icon: null, onClick },
    ];
    renderView({ actions });

    fireEvent.click(screen.getAllByRole("button", { name: /act/i })[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(sampleRows[0]);
  });
});
