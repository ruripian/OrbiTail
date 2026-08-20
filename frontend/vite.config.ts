/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

export default defineConfig(({ mode }) => {
  /* .env 파일에서 환경변수 로드 (프로젝트 루트 기준) */
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");

  /* DOMAIN 환경변수로 허용 호스트 동적 설정
     예: DOMAIN=orbitail.example.com → ["orbitail.example.com"]
     비어있으면 기본값(localhost)만 허용 */
  const allowedHosts: string[] = [];
  const domain = env.DOMAIN || process.env.DOMAIN;
  if (domain) allowedHosts.push(domain);

  /* HMR 되잡기 설정.
     HMR 은 브라우저가 dev 서버로 WebSocket 을 다시 연결해야 동작한다. 기본값은
     "페이지 호스트 + vite 포트(5173)" 인데, 리버스 프록시(tailscale serve, ngrok,
     nginx 등) 뒤에서 열면 그 포트가 프록시 밖으로 열려 있지 않아 연결이 실패한다.
     그러면 저장해도 화면이 안 바뀌고 매번 새로고침해야 한다.

     DEV_HMR_CLIENT_PORT 에 프록시가 듣는 포트를 주면 그쪽으로 되잡는다.
     예) tailscale serve 로 https://<host>:8443 → 127.0.0.1:5173 인 경우
         DEV_HMR_CLIENT_PORT=8443
     미설정이면 vite 기본 동작 그대로다(직접 접속 시 정상). */
  const hmrClientPort = Number(env.DEV_HMR_CLIENT_PORT || 0);
  const hmr = hmrClientPort
    ? {
        // 프록시가 TLS 를 종단하므로 기본은 wss. 평문 프록시면 DEV_HMR_PROTOCOL=ws
        protocol: env.DEV_HMR_PROTOCOL || "wss",
        // 호스트를 고정해 두면 127.0.0.1:5173 으로 직접 열었을 때도 되잡을 수 있다
        host: domain || undefined,
        clientPort: hmrClientPort,
      }
    : undefined;

  /* 버전 — 루트 VERSION 파일이 단일 source of truth.
     dev 컨테이너에서는 마운트 볼륨 외부라 못 읽는 경우가 있어
     frontend/VERSION fallback도 시도, 둘 다 실패 시 "0.0.0". */
  let appVersion = "0.0.0";
  for (const p of [path.resolve(__dirname, "../VERSION"), path.resolve(__dirname, "VERSION")]) {
    try {
      const text = fs.readFileSync(p, "utf-8").trim();
      if (text) { appVersion = text; break; }
    } catch { /* try next */ }
  }

  /* 빌드별 고유 ID — 새 배포 감지용. 매 빌드마다 변경. */
  const buildId = String(Date.now());

  return {
    plugins: [
      react(),
      {
        /* 빌드 산출물에 version.json 추가 — 프론트가 폴링해서 새 배포 감지 */
        name: "emit-version-json",
        apply: "build",
        closeBundle() {
          const out = path.resolve(__dirname, "dist", "version.json");
          fs.writeFileSync(
            out,
            JSON.stringify({ version: appVersion, build_id: buildId }) + "\n",
          );
        },
      },
    ],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __BUILD_ID__: JSON.stringify(buildId),
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      globals: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts,
      hmr,
      watch: {
        // Windows Docker 환경에서 inotify 이벤트가 전달 안 됨 → 폴링으로 변경 감지
        usePolling: true,
        interval: 1000,
      },
      /* 개발 환경: /api → backend:8000, /ws → backend:8000 (WebSocket)
         프로덕션은 nginx가 동일 경로를 프록시 */
      proxy: {
        "/api": {
          target: "http://backend:8000",
          changeOrigin: true,
        },
        "/ws": {
          target: "ws://backend:8000",
          ws: true,
        },
        "/media": {
          target: "http://backend:8000",
          changeOrigin: true,
        },
      },
    },
  };
});
