import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query-client";
/* React Query DevTools — 프로덕션에서 숨김 (번들은 tree-shake됨) */
import { Loader2 } from "lucide-react";

import "./index.css";
import "./styles/tokens.css"; // 시맨틱 색상 토큰 (priority, state group)
import "./styles/patterns.css"; // 기하학적 배경 패턴 (페이지별 멤피스/네오-지오 스타일)
import "./lib/i18n"; // i18n 초기화 (side-effect import)
import { runLocalStorageMigrations } from "./lib/migrations";
import { router } from "./router";

// PASS5-A: localStorage 키 namespace 마이그레이션 — render 전에 한 번
runLocalStorageMigrations();
import { ThemeProvider } from "./lib/theme-provider";
import { MotionProvider } from "./lib/motion-provider";
import { DensityProvider } from "./lib/density-provider";
import { FontSettingsProvider } from "./lib/font-settings";
import { setupApi } from "./api/setup";
import { SetupPage } from "./pages/setup/SetupPage";
import { demoApi } from "./api/demo";
import { DemoLandingPage } from "./pages/demo/DemoLandingPage";
import { DemoBadge } from "./components/demo/DemoBadge";
import { useAuthStore } from "./stores/authStore";
import { useDemoStore } from "./stores/demoStore";
import { decideBoot } from "./lib/boot";
import { Toaster } from "sonner";
import { useAppVersionCheck } from "./hooks/useAppVersionCheck";

type BootStatus = "loading" | "setup" | "demo" | "ready";

/**
 * 앱 최초 진입 시 서버 상태를 확인해 어느 화면으로 들어갈지 정한다.
 * - 초기 설정 미완료 → SetupPage
 * - 데모 배포이고 세션 없음 → DemoLandingPage ("데모 시작" 을 눌러야 샌드박스 생성)
 * - 그 외            → 정상 라우터 진입
 * - API 오류         → 정상 라우터 진입 (서버 점검 중 등 예외 상황)
 */
function AppBootstrap() {
  const [status, setStatus] = useState<BootStatus>("loading");
  const [demoTtlHours, setDemoTtlHours] = useState<number | null>(null);

  /* 새 배포 감지 — 다른 build_id 면 토스트로 새로고침 안내 */
  useAppVersionCheck();

  useEffect(() => {
    Promise.all([
      setupApi.getStatus().catch(() => ({ is_complete: true })),
      demoApi.getStatus().catch(() => ({ enabled: false, ttl_hours: null })),
    ]).then(([setup, demo]) => {
      setDemoTtlHours(demo.ttl_hours);

      /* 어느 화면으로 갈지는 lib/boot.ts 의 순수 함수가 정한다 (테스트 있음).
         데모 배포에서는 "살아 있는 데모 세션" 만 통과시킨다 — 데모가 아닌
         세션이나 만료된 세션은 들어가 봐야 갈 곳이 없어 버리고 랜딩으로 돌린다. */
      const { isDemo, expiresAt } = useDemoStore.getState();
      const { screen, clearSession } = decideBoot({
        setupComplete: setup.is_complete,
        demoEnabled: demo.enabled,
        hasToken: Boolean(useAuthStore.getState().accessToken),
        isDemoSession: isDemo,
        expiresAt,
      });

      if (clearSession) {
        useAuthStore.getState().clearAuth();
        useDemoStore.getState().clearDemo();
      }
      setStatus(screen);
    });
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

  if (status === "demo") {
    return <DemoLandingPage ttlHours={demoTtlHours} onStart={() => setStatus("ready")} />;
  }

  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <MotionProvider>
        <DensityProvider>
          <FontSettingsProvider>
            <QueryClientProvider client={queryClient}>
              <AppBootstrap />
              <Toaster position="top-right" richColors closeButton />
              <DemoBadge />
              {/* DevTools는 개발 환경에서만 표시 — 프로덕션 빌드 시 제거됨 */}
            </QueryClientProvider>
          </FontSettingsProvider>
        </DensityProvider>
      </MotionProvider>
    </ThemeProvider>
  </StrictMode>
);
