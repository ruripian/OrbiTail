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
      if (!setup.is_complete) {
        setStatus("setup");
        return;
      }

      if (demo.enabled) {
        setDemoTtlHours(demo.ttl_hours);

        /* 만료된 샌드박스의 토큰을 들고 들어오면 서버가 401 을 준다.
           그대로 두면 로그인 화면으로 튕기는데, 로그인이 없는 배포라
           막다른 길이 된다. 만료가 확인되면 세션을 비우고 랜딩으로 돌린다. */
        const { expiresAt, clearDemo } = useDemoStore.getState();
        if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
          useAuthStore.getState().clearAuth();
          clearDemo();
        }

        if (!useAuthStore.getState().accessToken) {
          setStatus("demo");
          return;
        }
      }

      setStatus("ready");
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
