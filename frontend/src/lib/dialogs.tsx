import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PromptDialog } from "@/components/ui/prompt-dialog";

/* 브라우저 기본 팝업(window.confirm/alert/prompt)을 앱 안의 다이얼로그로 대체한다.
   기본 팝업은 테마·글꼴·번역이 안 먹고, 창을 통째로 멈추며, 모바일에서 주소창을 드러낸다.

   호출부는 기존과 모양이 거의 같게 쓴다:
     const { confirm } = useDialogs();
     if (!(await confirm(t("documents.deleteConfirm")))) return;   */

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 삭제처럼 되돌릴 수 없는 동작은 "destructive" 로. */
  variant?: "default" | "destructive";
};

type PromptOptions = {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  requireValue?: boolean;
};

type Dialogs = {
  confirm: (options: string | ConfirmOptions) => Promise<boolean>;
  /** 삭제처럼 되돌릴 수 없는 동작 — 빨간 버튼으로 뜬다. */
  confirmDelete: (options: string | Omit<ConfirmOptions, "variant">) => Promise<boolean>;
  alert: (options: string | Omit<ConfirmOptions, "variant">) => Promise<void>;
  prompt: (options: string | PromptOptions) => Promise<string | null>;
};

const noop: Dialogs = {
  confirm: async () => false,
  confirmDelete: async () => false,
  alert: async () => {},
  prompt: async () => null,
};

const DialogsContext = createContext<Dialogs>(noop);

type Request =
  | { kind: "confirm"; options: ConfirmOptions }
  | { kind: "alert"; options: ConfirmOptions }
  | { kind: "prompt"; options: PromptOptions };

const asOptions = <T extends { title: string }>(input: string | T): T =>
  (typeof input === "string" ? ({ title: input } as T) : input);

export function DialogsProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  // 열려 있는 다이얼로그의 응답 통로. 닫힐 때 반드시 한 번 호출해 await 를 풀어 준다.
  const resolveRef = useRef<((value: unknown) => void) | null>(null);

  const settle = useCallback((value: unknown) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    resolve?.(value);
  }, []);

  const open = useCallback(
    (next: Request, fallback: unknown) =>
      new Promise((resolve) => {
        // 이미 떠 있는 게 있으면 취소로 끝내고 넘어간다 — await 가 영영 안 풀리면 안 된다.
        resolveRef.current?.(fallback);
        resolveRef.current = resolve as (value: unknown) => void;
        setRequest(next);
      }),
    [],
  );

  const api = useMemo<Dialogs>(
    () => ({
      confirm: (input) =>
        open({ kind: "confirm", options: asOptions(input) }, false) as Promise<boolean>,
      confirmDelete: (input) =>
        open(
          { kind: "confirm", options: { ...asOptions(input), variant: "destructive" } },
          false,
        ) as Promise<boolean>,
      alert: (input) =>
        open({ kind: "alert", options: asOptions(input) }, undefined) as Promise<void>,
      prompt: (input) =>
        open({ kind: "prompt", options: asOptions(input) }, null) as Promise<string | null>,
    }),
    [open],
  );

  return (
    <DialogsContext.Provider value={api}>
      {children}
      {request?.kind === "prompt" ? (
        <PromptDialog
          open
          onOpenChange={(next) => { if (!next) settle(null); }}
          title={request.options.title}
          description={request.options.description}
          defaultValue={request.options.defaultValue}
          placeholder={request.options.placeholder}
          requireValue={request.options.requireValue}
          onSubmit={(value) => settle(value)}
        />
      ) : request ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => { if (!next) settle(request.kind === "alert" ? undefined : false); }}
          title={request.options.title}
          description={request.options.description}
          confirmLabel={request.options.confirmLabel}
          cancelLabel={request.options.cancelLabel}
          variant={request.options.variant}
          hideCancel={request.kind === "alert"}
          onConfirm={() => settle(request.kind === "alert" ? undefined : true)}
        />
      ) : null}
    </DialogsContext.Provider>
  );
}

export function useDialogs() {
  return useContext(DialogsContext);
}
