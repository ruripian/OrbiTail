/**
 * Tooltip — Radix 기반 가벼운 래퍼.
 * 브라우저 기본 `title` 속성 대신 사용 (시각적으로 일관된 다크 톤 풍선 + 화살표).
 * 사용:
 *   <Tooltip content="설명">
 *     <button>...</button>
 *   </Tooltip>
 */
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** 표시 지연(ms). 기본 200ms — 호버 의도 명확해질 때만 표시. */
  delay?: number;
  /** content 가 falsy 면 툴팁 자체를 비활성화 (children 만 그대로 통과) */
  disabled?: boolean;
}

export function Tooltip({ content, children, side = "top", align = "center", delay = 200, disabled }: TooltipProps) {
  if (disabled || !content) return <>{children}</>;
  return (
    <TooltipPrimitive.Provider delayDuration={delay} skipDelayDuration={100}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            className={cn(
              "z-[60] max-w-xs rounded-md px-2.5 py-1.5 text-xs leading-snug",
              "bg-foreground text-background shadow-md",
              "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
              "data-[state=delayed-open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-foreground" width={10} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
