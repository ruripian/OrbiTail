import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import { Button } from "./button";
import { Input } from "./input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 빈 값으로는 확인할 수 없게 한다 (이름 입력 같은 경우). */
  requireValue?: boolean;
  onSubmit: (value: string) => void;
}

/** window.prompt 대체.
 *  값은 **마운트할 때** 기본값으로 잡는다 — 띄울 때만 렌더하거나(useDialogs 가 그렇게 한다)
 *  key 를 바꿔 다시 마운트시킬 것. effect 로 되돌리면 렌더가 한 번 더 도는 데다
 *  사용자가 입력하는 도중에 값을 덮어쓸 위험이 있다. */
export function PromptDialog({
  open, onOpenChange, title, description,
  defaultValue = "", placeholder,
  confirmLabel, cancelLabel, requireValue, onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // 다이얼로그가 그려진 뒤에 포커스를 줘야 한다
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.select(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  const blocked = requireValue && !value.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{description}</p>
          )}
        </DialogHeader>
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) onSubmit(value);
          }}
        >
          <Input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {cancelLabel ?? t("common.cancel")}
            </Button>
            <Button type="submit" disabled={blocked}>
              {confirmLabel ?? t("common.confirm")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
