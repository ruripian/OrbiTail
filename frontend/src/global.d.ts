/// <reference types="vite/client" />

/** Vite define에서 주입되는 앱 버전 (root /VERSION 파일 기준) */
declare const __APP_VERSION__: string;

/** Vite define에서 주입되는 빌드별 고유 ID (Date.now() 기반). 배포 감지용. */
declare const __BUILD_ID__: string;
