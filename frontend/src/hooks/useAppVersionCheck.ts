/**
 * 앱 버전 변경(새 배포) 감지 훅.
 *
 * 동작:
 *  - 페이지 로드 시점의 __BUILD_ID__ 를 baseline 으로 보관
 *  - tab 이 visible 로 돌아올 때, 그리고 5분마다 /version.json 폴링
 *  - 응답의 build_id 가 baseline 과 다르면 토스트 노출 — 사용자가 "새로고침" 클릭하면 reload
 *
 * 자동 reload 는 일부러 안 함 — 작업 중인 폼/입력이 날아가는 사고 방지.
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5분

export function useAppVersionCheck() {
  const { t } = useTranslation();
  const baselineBuildId = useRef<string>(typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "");
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (!baselineBuildId.current) return; // dev 모드 또는 baseline 없으면 비활성

    let cancelled = false;

    async function check() {
      if (cancelled || notifiedRef.current) return;
      try {
        const res = await fetch("/version.json", {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });
        if (!res.ok) return;
        const data = await res.json();
        const remoteId = String(data?.build_id ?? "");
        if (remoteId && remoteId !== baselineBuildId.current) {
          notifiedRef.current = true;
          toast.message(
            t("appUpdate.title", "새 버전이 배포되었습니다"),
            {
              description: t(
                "appUpdate.body",
                "최신 기능과 버그 수정을 반영하려면 새로고침해 주세요.",
              ),
              duration: Infinity,
              action: {
                label: t("appUpdate.refresh", "새로고침"),
                onClick: () => window.location.reload(),
              },
            },
          );
        }
      } catch {
        /* 네트워크 일시 오류 — 다음 폴링에서 재시도 */
      }
    }

    /* 첫 실행: 즉시 한 번. 이후 interval + visibilitychange 로 보충. */
    check();
    const intervalId = window.setInterval(check, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [t]);
}
