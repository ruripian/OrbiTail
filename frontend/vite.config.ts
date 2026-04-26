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
  if (env.DOMAIN) allowedHosts.push(env.DOMAIN);

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

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
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
