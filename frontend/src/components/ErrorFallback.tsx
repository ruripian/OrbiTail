import { useRouteError, isRouteErrorResponse, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * 라우터 최상위 errorElement — 컴포넌트 렌더 중 throw 가 일어났을 때
 * react-router 기본 회색 영문 화면("Unexpected Application Error!") 대신 노출되는 fallback.
 *
 * 진단 목적도 겸함:
 *   - 에러 메시지/스택을 화면에 그대로 노출하여 재현 캡처를 쉽게 한다
 *   - console.error 로도 한 번 기록 (devtools 닫혀 있어도 다시 열면 보임)
 *
 * 운영 환경에서도 그대로 노출하는 이유: 어차피 에러가 발생한 것이므로
 * 사용자에게 무엇이 잘못됐는지 보여주고 로그인/홈으로 복귀 동선을 제공하는 게 낫다.
 */
export function ErrorFallback() {
  const error = useRouteError();
  const navigate = useNavigate();

  /* 콘솔에도 한 번 dump — 재현 후 devtools 를 켜도 확인 가능하도록 */
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[ErrorFallback] route error:", error);
  }, [error]);

  const { title, message, detail } = normalizeError(error);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-lg space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
            오류가 발생했습니다
          </p>
          <h1 className="text-lg font-bold">{title}</h1>
        </div>

        {message && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs font-mono break-words text-foreground/90">
            {message}
          </p>
        )}

        {detail && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">
              상세 정보(개발자용)
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-[11px]">
              {detail}
            </pre>
          </details>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="sm:w-auto"
          >
            이전으로
          </Button>
          <Button
            onClick={() => {
              /* hard reload — fallback 상태 자체가 손상 가능성 있는 store/router 상태를 안고 있을 수 있음 */
              window.location.href = "/";
            }}
          >
            홈으로
          </Button>
        </div>
      </div>
    </div>
  );
}

/** route error 객체를 표시 가능한 3-tuple 로 정규화 */
function normalizeError(error: unknown): { title: string; message: string; detail: string } {
  if (isRouteErrorResponse(error)) {
    return {
      title: `${error.status} ${error.statusText || ""}`.trim(),
      message: typeof error.data === "string" ? error.data : safeStringify(error.data),
      detail: "",
    };
  }
  if (error instanceof Error) {
    return {
      title: error.name || "Error",
      message: error.message || "(empty error message)",
      detail: error.stack ?? "",
    };
  }
  return {
    title: "Unknown error",
    message: safeStringify(error),
    detail: "",
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
