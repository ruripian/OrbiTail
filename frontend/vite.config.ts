import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  /* .env 파일에서 환경변수 로드 (프로젝트 루트 기준) */
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");

  /* DOMAIN 환경변수로 허용 호스트 동적 설정
     예: DOMAIN=orbitail.example.com → ["orbitail.example.com"]
     비어있으면 기본값(localhost)만 허용 */
  const allowedHosts: string[] = [];
  if (env.DOMAIN) allowedHosts.push(env.DOMAIN);

  return {
    plugins: [react()],
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
      },
    },
  };
});
