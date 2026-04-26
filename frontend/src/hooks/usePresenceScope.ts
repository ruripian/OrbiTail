/**
 * usePresenceScope — 페이지 mount/unmount 시 서버에 현재 보고 있는 scope 알림.
 *
 * scope 예시: "project:<id>", "document:<id>". null/undefined 면 동작 안 함.
 *
 * 사용:
 *   usePresenceScope(`project:${projectId}`);
 *   const users = usePresenceStore(selectScopeUsers(`project:${projectId}`));
 */
import { useEffect } from "react";
import { sendWsMessage } from "./useWebSocket";

export function usePresenceScope(scope: string | null | undefined) {
  useEffect(() => {
    if (!scope) return;

    /* WS 가 아직 안 열렸을 수 있어 짧게 retry — 한 번 실패하면 다음 tick 에 재시도 */
    let attempts = 0;
    const trySend = () => {
      const ok = sendWsMessage({ type: "presence.scope", scope });
      if (!ok && attempts < 30) {
        attempts++;
        setTimeout(trySend, 200);
      }
    };
    trySend();

    return () => {
      sendWsMessage({ type: "presence.scope", scope: null });
    };
  }, [scope]);
}
