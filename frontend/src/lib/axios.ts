import axios from "axios";
import { useAuthStore } from "@/stores/authStore";

/* baseURL은 항상 상대 경로 "/api" — 같은 도메인에서 SPA + API를 서빙하므로 절대 URL 불필요.
   개발 환경: vite proxy (/api → backend:8000)
   프로덕션: nginx가 /api를 backend로 프록시 */
export const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // FormData 를 전송할 때는 Content-Type 을 명시적으로 제거해 브라우저가
  // multipart/form-data; boundary=... 를 자동으로 채우도록 둠.
  // (인스턴스 기본 Content-Type: application/json 이 FormData 까지 덮어씌우는 문제 방지)
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    if (config.headers) {
      // axios v1 의 AxiosHeaders 는 delete 지원
      if (typeof (config.headers as { delete?: (k: string) => void }).delete === "function") {
        (config.headers as { delete: (k: string) => void }).delete("Content-Type");
      } else {
        delete (config.headers as Record<string, unknown>)["Content-Type"];
      }
    }
  }
  return config;
});

/* 동시에 여러 요청이 401 나면 refresh가 중복 호출되는 문제 방지 — 진행 중인 promise 공유 */
let refreshPromise: Promise<string> | null = null;

/* 로그인 API 자체의 401은 "비밀번호 틀림"이라 로그아웃 리다이렉트 대상 제외 */
const AUTH_ENDPOINTS = ["/auth/login/", "/auth/register/", "/auth/token/refresh/"];
const isAuthEndpoint = (url: string = "") => AUTH_ENDPOINTS.some((ep) => url.includes(ep));

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const refresh = localStorage.getItem("refresh_token");
    const status = error.response?.status;

    if (status === 401 && !original._retry && !isAuthEndpoint(original.url)) {
      /* refresh 토큰이 없으면 = 완전 로그아웃 상태이거나 저장 실패. 즉시 로그인으로 */
      if (!refresh) {
        useAuthStore.getState().clearAuth();
        if (window.location.pathname !== "/auth/login") {
          window.location.href = "/auth/login";
        }
        return Promise.reject(error);
      }

      original._retry = true;
      try {
        /* 이미 진행 중인 refresh가 있으면 재사용 — 동시 요청들이 블랙리스트된 토큰 재사용하는 것 방지 */
        if (!refreshPromise) {
          refreshPromise = axios
            .post("/api/auth/token/refresh/", { refresh })
            .then(({ data }) => {
              /* ROTATE_REFRESH_TOKENS=True — 응답에 새 refresh 토큰이 오면 반드시 저장.
                 저장하지 않으면 기존 refresh가 블랙리스트 처리되어 다음 refresh 실패. */
              useAuthStore.getState().updateTokens(data.access, data.refresh);
              return data.access as string;
            })
            .finally(() => {
              refreshPromise = null;
            });
        }
        const newAccess = await refreshPromise;
        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      } catch {
        // refresh도 실패 → 세션 만료, 로그인 페이지로
        useAuthStore.getState().clearAuth();
        if (window.location.pathname !== "/auth/login") {
          window.location.href = "/auth/login";
        }
      }
    }
    return Promise.reject(error);
  }
);
