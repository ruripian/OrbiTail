/**
 * WebSocket 실시간 업데이트 훅
 *
 * 워크스페이스별 WebSocket 연결을 관리하고,
 * 서버 이벤트 수신 시 React Query 캐시를 자동으로 invalidate합니다.
 *
 * 이벤트 타입:
 *   - issue.updated / issue.created / issue.deleted → 모든 이슈 관련 쿼리 invalidate
 *   - issue.archived → 보관함 + 이슈 목록 invalidate
 *   - issue.commented → 댓글/활동 쿼리 invalidate
 *   - notification.new → 알림 쿼리 invalidate
 *
 * 성능 참고:
 *   invalidateQueries는 해당 쿼리를 사용 중인 컴포넌트가 마운트된 경우에만
 *   실제 refetch가 발생. 마운트되지 않은 쿼리는 stale 마킹만 하므로
 *   넓게 invalidate 해도 네트워크 부담이 크지 않음.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useRecentChangesStore } from "@/stores/recentChangesStore";
import { usePresenceStore, type PresenceUser } from "@/stores/presenceStore";
import { useIssueDialogStore } from "@/stores/issueDialogStore";

/* PASS10 — 토스트 노출 대상. 사용자가 종 아이콘을 안 봐도 즉시 인지해야 하는 타입. */
const HIGH_PRIORITY_NOTIFICATION_TYPES = new Set(["mentioned", "issue_assigned"]);

interface WebSocketEvent {
  type: string;
  issue_id?: string;
  project_id?: string;
  doc_id?: string;
  /** Phase 3.4 — 변경자 표시 색 (백엔드가 보내면 strip 색으로 사용) */
  actor_color?: string;
  [key: string]: unknown;
}

export type WsStatus = "connecting" | "connected" | "disconnected";

/* 모듈 단위 WS 참조 — useProjectPresence 같이 외부에서 메시지를 보내야 할 때 사용.
   여러 곳에서 동시에 useWebSocket 을 호출하지 않는다는 가정(앱당 1개) 하에 안전. */
let activeWs: WebSocket | null = null;

export function sendWsMessage(payload: unknown): boolean {
  if (activeWs && activeWs.readyState === WebSocket.OPEN) {
    activeWs.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

export function useWebSocket(workspaceSlug: string | undefined): WsStatus {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getAccessToken = useCallback(() => localStorage.getItem("access_token"), []);
  const [status, setStatus] = useState<WsStatus>("disconnected");

  useEffect(() => {
    if (!workspaceSlug) return;

    const token = getAccessToken();
    if (!token) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/workspace/${workspaceSlug}/?token=${token}`;

    function connect() {
      setStatus("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;
      activeWs = ws;

      ws.onopen = () => {
        setStatus("connected");
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
        if (activeWs === ws) activeWs = null;
        setStatus("disconnected");
        if (e.code !== 1000) {
          reconnectTimer.current = setTimeout(connect, 5000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    /** 모든 이슈 관련 쿼리를 invalidate — Table/Board/Calendar/Timeline/Sprint 등 전 뷰 반영 */
    function invalidateIssueQueries(event: WebSocketEvent) {
      // prefix 매칭: ["issues", workspaceSlug, ...] 하위 모두 (목록, 필터별 등)
      qc.invalidateQueries({ queryKey: ["issues", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["my-issues", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["recent-issues", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["issue-stats", workspaceSlug] });

      // 단건 이슈 (IssueDetailPage 패널)
      if (event.issue_id) {
        qc.invalidateQueries({ queryKey: ["issue", event.issue_id] });
      }

      // 프로젝트별 쿼리 (휴지통, 보관함 포함)
      if (event.project_id) {
        qc.invalidateQueries({ queryKey: ["issues-trash", workspaceSlug, event.project_id] });
        qc.invalidateQueries({ queryKey: ["issues-archive", workspaceSlug, event.project_id] });
      }
    }

    function handleEvent(event: WebSocketEvent) {
      switch (event.type) {
        case "issue.updated":
        case "issue.created":
        case "issue.archived":
          invalidateIssueQueries(event);
          // Phase 3.4 — 5초간 strip 표시. 변경자 색은 backend payload에서.
          if (event.issue_id) {
            useRecentChangesStore.getState().markChanged(event.issue_id, event.actor_color);
          }
          break;
        case "issue.deleted":
        case "issue.bulk_updated":
        case "issue.bulk_deleted":
          invalidateIssueQueries(event);
          break;

        case "issue.commented":
          // 댓글/활동 로그
          if (event.issue_id) {
            qc.invalidateQueries({ queryKey: ["issue", event.issue_id] });
            qc.invalidateQueries({ queryKey: ["comments", event.issue_id] });
            qc.invalidateQueries({ queryKey: ["activities", event.issue_id] });
          }
          // 알림도 갱신 (댓글 알림)
          qc.invalidateQueries({ queryKey: ["notifications", workspaceSlug] });
          qc.invalidateQueries({ queryKey: ["notifications-unread", workspaceSlug] });
          break;

        case "event.updated":
        case "event.created":
        case "event.deleted":
          // 프로젝트 이벤트 (캘린더)
          if (event.project_id) {
            qc.invalidateQueries({ queryKey: ["events", workspaceSlug, event.project_id] });
          }
          break;

        case "notification.new": {
          qc.invalidateQueries({ queryKey: ["notifications", workspaceSlug] });
          qc.invalidateQueries({ queryKey: ["notifications-unread", workspaceSlug] });
          /* PASS10-Toast — 우선순위 높은 알림은 종 아이콘 dropdown 을 안 열어도 보이게 토스트.
             백엔드 payload: { notification_type, message, issue_id, project_id, actor_name } */
          const ntype = typeof event.notification_type === "string" ? event.notification_type : null;
          if (ntype && HIGH_PRIORITY_NOTIFICATION_TYPES.has(ntype)) {
            const issueId = typeof event.issue_id === "string" ? event.issue_id : null;
            const projectId = typeof event.project_id === "string" ? event.project_id : null;
            const message = typeof event.message === "string" ? event.message : "새 알림";
            toast(message, {
              duration: 6000,
              action: issueId && projectId ? {
                label: "보기",
                onClick: () => useIssueDialogStore.getState().openIssue(workspaceSlug!, projectId, issueId),
              } : undefined,
            });
          }
          break;
        }

        case "doc.thread.changed":
          // 문서 댓글 스레드 변경 — 해당 문서의 스레드 리스트 + 전체 스레드(해결여부) 무효화
          if (event.doc_id) {
            qc.invalidateQueries({ queryKey: ["doc-threads", event.doc_id] });
            qc.invalidateQueries({ queryKey: ["doc-threads-all", event.doc_id] });
          }
          break;

        case "presence.update":
          // scope 별 접속자 갱신. event.scope 는 null(전역) 또는 'project:<id>' 등.
          if (Array.isArray(event.users)) {
            const scope = (event.scope ?? null) as string | null;
            usePresenceStore.getState().setScopeUsers(scope, event.users as PresenceUser[]);
          }
          break;

        case "pong":
          break;
      }
    }

    connect();

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
        if (activeWs === wsRef.current) activeWs = null;
        wsRef.current = null;
      }
      // 워크스페이스 전환 시 presence 초기화 — 다음 연결의 update 가 다시 채워준다
      usePresenceStore.getState().clear();
    };
  }, [workspaceSlug, qc, getAccessToken, navigate]);

  return status;
}
