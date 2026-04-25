import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Checkbox — 테마 통합 커스텀 체크박스
 *
 * 특징:
 *  - primary 컬러 + rounded + smooth transition
 *  - indeterminate 상태 지원 (Minus 아이콘)
 *  - native input을 sr-only로 숨기고 커스텀 박스로 표시
 *  - 포커스 ring + hover 효과
 *
 * 사용:
 *   <Checkbox checked={selected} onChange={setSelected} />
 *   <Checkbox checked={checked} indeterminate={isIndeterminate} onChange={...} />
 */

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "size"> {
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  size?: "sm" | "md";
}

const SIZE_CLASSES: Record<NonNullable<CheckboxProps["size"]>, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
};
const ICON_SIZE: Record<NonNullable<CheckboxProps["size"]>, string> = {
  sm: "h-2.5 w-2.5",
  md: "h-3 w-3",
};

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ checked, indeterminate = false, onChange, size = "md", className, disabled, ...props }, ref) => {
    const localRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => localRef.current!, []);

    /* indeterminate는 DOM property로만 설정 가능 */
    React.useEffect(() => {
      if (localRef.current) localRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <label
        className={cn(
          "relative inline-flex items-center justify-center shrink-0 cursor-pointer",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <input
          ref={localRef}
          type="checkbox"
          checked={!!checked}
          onChange={(e) => onChange?.(e.target.checked)}
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <span
          className={cn(
            "inline-flex items-center justify-center rounded border transition-all duration-fast",
            SIZE_CLASSES[size],
            /* 기본 */
            "border-border bg-input/40",
            /* hover */
            "peer-hover:border-primary/60",
            /* checked/indeterminate */
            "peer-checked:bg-primary peer-checked:border-primary peer-checked:text-primary-foreground",
            "peer-indeterminate:bg-primary peer-indeterminate:border-primary peer-indeterminate:text-primary-foreground",
            /* focus ring */
            "peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background",
          )}
        >
          {indeterminate ? (
            <Minus className={cn("stroke-[3]", ICON_SIZE[size])} />
          ) : checked ? (
            <Check className={cn("stroke-[3]", ICON_SIZE[size])} />
          ) : null}
        </span>
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
