import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
/* React Query DevTools — 프로덕션에서 숨김 (번들은 tree-shake됨) */
import { Loader2 } from "lucide-react";

import "./index.css";
import "./styles/tokens.css"; // 시맨틱 색상 토큰 (priority, state group)
import "./styles/patterns.css"; // 기하학적 배경 패턴 (페이지별 멤피스/네오-지오 스타일)
import "./lib/i18n"; // i18n 초기화 (side-effect import)
import { router } from "./router";
import { ThemeProvider } from "./lib/theme-provider";
import { MotionProvider } from "./lib/motion-provider";
import { DensityProvider } from "./lib/density-provider";
import { setupApi } from "./api/setup";
import { SetupPage } from "./pages/setup/SetupPage";
import { Toaster } from "sonner";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60, retry: 1 },
  },
});

type BootStatus = "loading" | "setup" | "ready";

/**
 * 앱 최초 진입 시 서버 초기 설정 완료 여부를 확인한다.
 * - 미완료(유저 없음) → SetupPage 표시
 * - 완료            → 정상 라우터 진입
 * - API 오류         → 정상 라우터 진입 (서버 점검 중 등 예외 상황)
 */
function AppBootstrap() {
  const [status, setStatus] = useState<BootStatus>("loading");

  useEffect(() => {
    setupApi
      .getStatus()
      .then(({ is_complete }) => setStatus(is_complete ? "ready" : "setup"))
      .catch(() => setStatus("ready")); // 오류 시 정상 플로우
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  if (status === "setup") {
    // 설정 완료 시 status를 ready로 바꿔 라우터로 전환
    return <SetupPage onComplete={() => setStatus("ready")} />;
  }

  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <MotionProvider>
        <DensityProvider>
          <QueryClientProvider client={queryClient}>
            <AppBootstrap />
            <Toaster position="top-right" richColors closeButton />
            {/* DevTools는 개발 환경에서만 표시 — 프로덕션 빌드 시 제거됨 */}
          </QueryClientProvider>
        </DensityProvider>
      </MotionProvider>
    </ThemeProvider>
  </StrictMode>
);
