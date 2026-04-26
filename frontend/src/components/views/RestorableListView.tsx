import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

/**
 * RestorableListView — Archive / Trash 공유 base (PASS5-B).
 *
 * 시각은 기존 두 view 와 동일. 컬럼/액션/계층 옵션만 외부에서 주입.
 *  - hierarchy 가 있으면 트리 + chevron 들여쓰기 (Archive)
 *  - 없으면 평면 (Trash)
 *  - actions[].visible 로 권한 체크 (예: can_purge)
 *  - actions[].confirmMessage 로 window.confirm 자동 처리
 */

export interface Column<T> {
  id: string;
  label: string;
  /** Tailwind class for fixed width or flex (예: "w-16", "w-20", "flex-1") */
  width: string;
  align?: "left" | "center" | "right";
  render: (row: T) => ReactNode;
}

export interface Action<T> {
  id: string;
  label: string;
  icon: ReactNode;
  variant?: "outline" | "ghost" | "destructive";
  /** label 을 옆에 표시할지. false 면 아이콘만 (Archive 의 휴지통). default true */
  showLabel?: boolean;
  onClick: (row: T) => void;
  disabled?: (row: T) => boolean;
  /** 권한 분기 (예: can_purge). default true */
  visible?: (row: T) => boolean;
  /** window.confirm 메시지. 있으면 클릭 → confirm → 통과 시 onClick */
  confirmMessage?: string;
}

interface Hierarchy<T> {
  childrenOf: (row: T) => T[];
  canExpand: (row: T) => boolean;
}

interface Props<T> {
  rows: T[];
  isLoading: boolean;
  rowKey: (row: T) => string;
  columns: Column<T>[];
  actions: Action<T>[];
  /** 액션 영역 width — 두 view 가 다른 폭 사용 */
  actionsWidth?: string;
  emptyState: { icon: ReactNode; title: string; description?: string };
  hint?: string;
  hierarchy?: Hierarchy<T>;
  onRowClick?: (row: T) => void;
}

const alignClass = (a: Column<unknown>["align"]) =>
  a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left";

export function RestorableListView<T>({
  rows,
  isLoading,
  rowKey,
  columns,
  actions,
  actionsWidth = "w-40",
  emptyState,
  hint,
  hierarchy,
  onRowClick,
}: Props<T>) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={emptyState.icon}
        title={emptyState.title}
        description={emptyState.description}
      />
    );
  }

  return (
    <div className="p-4 space-y-3">
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

      <div className="rounded-xl border overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-2.5 border-b bg-muted/20 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {columns.map((c) => (
            <span key={c.id} className={cn(c.width, alignClass(c.align))}>
              {c.label}
            </span>
          ))}
          <span className={actionsWidth} />
        </div>

        {rows.map((row) => (
          <Row<T>
            key={rowKey(row)}
            row={row}
            depth={0}
            rowKey={rowKey}
            columns={columns}
            actions={actions}
            actionsWidth={actionsWidth}
            hierarchy={hierarchy}
            onRowClick={onRowClick}
          />
        ))}
      </div>
    </div>
  );
}

function Row<T>({
  row, depth, rowKey, columns, actions, actionsWidth, hierarchy, onRowClick,
}: {
  row: T;
  depth: number;
  rowKey: (row: T) => string;
  columns: Column<T>[];
  actions: Action<T>[];
  actionsWidth: string;
  hierarchy?: Hierarchy<T>;
  onRowClick?: (row: T) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = hierarchy?.childrenOf(row) ?? [];
  const hasChildren = hierarchy ? hierarchy.canExpand(row) && children.length > 0 : false;
  const visibleActions = actions.filter((a) => a.visible?.(row) ?? true);

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-4 px-4 py-3 border-b last:border-0 hover:bg-muted/10 transition-colors",
          depth > 0 && "bg-muted/5",
        )}
      >
        {columns.map((c, idx) => {
          // 첫 컬럼만 계층 chevron + indent + click handler 부여
          if (idx === 0 && hierarchy) {
            return (
              <div
                key={c.id}
                className={cn(c.width, alignClass(c.align), "shrink-0")}
              >
                {c.render(row)}
              </div>
            );
          }
          if (idx === 1 && hierarchy) {
            return (
              <div
                key={c.id}
                className={cn(c.width, "min-w-0 flex items-center gap-1.5", onRowClick && "cursor-pointer")}
                style={{ paddingLeft: depth * 24 }}
                onClick={() => onRowClick?.(row)}
              >
                {hasChildren && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                    className="p-0.5 rounded hover:bg-muted/60 shrink-0"
                  >
                    {expanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                )}
                {!hasChildren && <span className="w-[18px] shrink-0" />}
                {c.render(row)}
              </div>
            );
          }
          // 평면 모드 — 첫 컬럼에 click handler
          if (idx === 0 && !hierarchy && onRowClick) {
            return (
              <div
                key={c.id}
                className={cn(c.width, alignClass(c.align), "min-w-0 cursor-pointer")}
                onClick={() => onRowClick(row)}
              >
                {c.render(row)}
              </div>
            );
          }
          return (
            <div key={c.id} className={cn(c.width, alignClass(c.align), "shrink-0")}>
              {c.render(row)}
            </div>
          );
        })}

        <div
          className={cn(actionsWidth, "flex items-center justify-end gap-1.5")}
          onClick={(e) => e.stopPropagation()}
        >
          {/* hierarchy 모드에서는 자식 행에 액션 버튼 숨김 (Archive 기존 동작 보존) */}
          {(depth === 0 || !hierarchy) && visibleActions.map((a) => (
            <Button
              key={a.id}
              variant={a.variant ?? "outline"}
              size="sm"
              className={cn(
                "h-7 text-xs",
                a.variant === "destructive" && "text-destructive hover:text-destructive",
              )}
              disabled={a.disabled?.(row)}
              onClick={() => {
                if (a.confirmMessage && !window.confirm(a.confirmMessage)) return;
                a.onClick(row);
              }}
            >
              <span className="mr-1">{a.icon}</span>
              {(a.showLabel ?? true) && a.label}
            </Button>
          ))}
        </div>
      </div>

      {expanded && hierarchy && children.map((child) => (
        <Row<T>
          key={rowKey(child)}
          row={child}
          depth={depth + 1}
          rowKey={rowKey}
          columns={columns}
          actions={actions}
          actionsWidth={actionsWidth}
          hierarchy={hierarchy}
          onRowClick={onRowClick}
        />
      ))}
    </>
  );
}
