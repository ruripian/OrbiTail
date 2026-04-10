/**
 * WebSocket 실시간 업데이트 훅
 *
 * 워크스페이스별 WebSocket 연결을 관리하고,
 * 서버 이벤트 수신 시 React Query 캐시를 자동으로 invalidate합니다.
 *
 * 이벤트 타입:
 *   - issue.updated:    이슈 변경 → issues 쿼리 invalidate
 *   - issue.created:    이슈 생성 → issues 쿼리 invalidate
 *   - issue.deleted:    이슈 삭제 → issues 쿼리 invalidate
 *   - notification.new: 새 알림   → notifications 쿼리 invalidate
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface WebSocketEvent {
  type: string;
  issue_id?: string;
  project_id?: string;
  [key: string]: unknown;
}

export type WsStatus = "connecting" | "connected" | "disconnected";

export function useWebSocket(workspaceSlug: string | undefined): WsStatus {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getAccessToken = useCallback(() => localStorage.getItem("access_token"), []);
  const [status, setStatus] = useState<WsStatus>("disconnected");

  useEffect(() => {
    if (!workspaceSlug) return;

    const token = getAccessToken();
    if (!token) return;

    /* WebSocket URL — 같은 도메인/포트로 접속 (개발: vite proxy, 프로덕션: nginx proxy가 /ws를 backend로 라우팅) */
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/workspace/${workspaceSlug}/?token=${token}`;

    function connect() {
      setStatus("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        /* 연결 성공 시 재연결 타이머 초기화 */
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      ws.onmessage = (e) => {
        try {
          const event: WebSocketEvent = JSON.parse(e.data);
          handleEvent(event);
        } catch {
          /* 파싱 실패 무시 */
        }
      };

      ws.onclose = (e) => {
        wsRef.current = null;
        setStatus("disconnected");
        /* 비정상 종료 시 5초 후 재연결 */
        if (e.code !== 1000) {
          reconnectTimer.current = setTimeout(connect, 5000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    function handleEvent(event: WebSocketEvent) {
      switch (event.type) {
        case "issue.updated":
        case "issue.created":
        case "issue.deleted":
          /* 이슈 관련 쿼리 전체 invalidate */
          qc.invalidateQueries({ queryKey: ["issues", workspaceSlug] });
          qc.invalidateQueries({ queryKey: ["my-issues", workspaceSlug] });
          qc.invalidateQueries({ queryKey: ["recent-issues", workspaceSlug] });
          qc.invalidateQueries({ queryKey: ["issue-stats", workspaceSlug] });
          if (event.issue_id) {
            qc.invalidateQueries({ queryKey: ["issue", event.issue_id] });
          }
          if (event.project_id) {
            qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, event.project_id] });
          }
          break;

        case "notification.new":
          /* 알림 쿼리 invalidate — TopBar 벨 카운터 즉시 갱신 */
          qc.invalidateQueries({ queryKey: ["notifications", workspaceSlug] });
          qc.invalidateQueries({ queryKey: ["notifications-unread", workspaceSlug] });
          break;

        case "pong":
          /* ping/pong 응답 — 무시 */
          break;
      }
    }

    connect();

    /* ping 간격: 30초마다 연결 유지 */
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
    };
  }, [workspaceSlug, qc, getAccessToken]);

  return status;
}
