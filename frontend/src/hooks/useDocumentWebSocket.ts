/**
 * 문서 실시간 동시 편집 WebSocket provider
 *
 * Yjs CRDT + WebSocket으로 동일 문서를 여러 사용자가 동시 편집.
 * 문서 페이지 진입 시 연결, 떠나면 즉시 해제 (ClickUp 성능 문제 방지).
 */

import { useEffect, useRef, useState, useMemo } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

export interface DocWsResult {
  ydoc: Y.Doc;
  provider: WebsocketProvider | null;
  connected: boolean;
}

export function useDocumentWebSocket(docId: string | undefined): DocWsResult {
  const [connected, setConnected] = useState(false);
  const ydoc = useMemo(() => new Y.Doc(), []);
  const providerRef = useRef<WebsocketProvider | null>(null);

  useEffect(() => {
    if (!docId) return;

    const token = localStorage.getItem("access_token");
    if (!token) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/documents`;

    const provider = new WebsocketProvider(wsUrl, docId, ydoc, {
      params: { token },
    });
    providerRef.current = provider;

    provider.on("status", ({ status }: { status: string }) => {
      setConnected(status === "connected");
    });

    return () => {
      provider.destroy();
      providerRef.current = null;
      setConnected(false);
    };
  }, [docId, ydoc]);

  return { ydoc, provider: providerRef.current, connected };
}
