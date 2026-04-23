/**
 * 문서 실시간 동시 편집 WebSocket provider
 *
 * Yjs CRDT + y-websocket protocol로 동일 문서를 여러 사용자가 동시 편집.
 * 문서 ID가 바뀔 때마다 완전히 새로 연결 (이전 Y.Doc 재사용 금지 — 상태 오염 방지).
 * 페이지를 떠나면 즉시 해제 (ClickUp 성능 문제 방지).
 */

import { useEffect, useState, useMemo } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { useAuthStore } from "@/stores/authStore";

export interface PresencePeer {
  clientID: number;
  name: string;
  color: string;
  avatar?: string;
}

export interface DocCollab {
  ydoc: Y.Doc;
  provider: WebsocketProvider | null;
  connected: boolean;
  synced: boolean;         // 초기 sync 완료 여부 — 시드 판단 후 false이면 여전히 seed 가능
  peers: PresencePeer[];    // 자신 제외 접속자
  me: { name: string; color: string; avatar?: string };
}

/* 사용자별 컬러 — id 해시로 안정적 할당 */
const PRESENCE_COLORS = [
  "#f87171", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa",
  "#f472b6", "#2dd4bf", "#fb923c", "#818cf8", "#c084fc",
];
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}

export function useDocumentWebSocket(docId: string | undefined): DocCollab {
  const user = useAuthStore((s) => s.user);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState<PresencePeer[]>([]);

  /* docId가 바뀌면 Y.Doc 자체를 새로 만든다 — 이전 문서 상태 누수 방지 */
  const ydoc = useMemo(() => new Y.Doc(), [docId]);

  const me = useMemo(() => ({
    name: user?.display_name || user?.email || "익명",
    color: colorFor(user?.id || "anon"),
    avatar: user?.avatar || undefined,
  }), [user]);

  /* provider는 state로 관리 — useEditor가 첫 렌더에서만 extensions를 고정하므로
     ref로 돌리면 provider가 null인 채로 CollaborationCursor가 영영 등록 안 됨. */
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);

  useEffect(() => {
    if (!docId) return;

    const token = localStorage.getItem("access_token");
    if (!token) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/documents`;

    const p = new WebsocketProvider(wsUrl, docId, ydoc, {
      params: { token },
      connect: true,
    });

    /* 커서/프레즌스 초기화 — CollaborationCursor도 동일 필드를 설정하지만
       provider 생성 시점에 한 번 해두면 초기 broadcast에 user 정보가 실림. */
    p.awareness.setLocalStateField("user", {
      name: me.name,
      color: me.color,
      avatar: me.avatar,
    });

    const onStatus = ({ status }: { status: string }) => {
      setConnected(status === "connected");
    };
    const onSync = (isSynced: boolean) => {
      if (isSynced) setSynced(true);
    };
    const onAwarenessChange = () => {
      const states = Array.from(p.awareness.getStates().entries()) as Array<[number, any]>;
      const self = p.awareness.clientID;
      const next: PresencePeer[] = states
        .filter(([id, st]) => id !== self && st?.user)
        .map(([id, st]) => ({
          clientID: id,
          name: st.user.name || "?",
          color: st.user.color || "#888",
          avatar: st.user.avatar,
        }));
      setPeers(next);
    };

    p.on("status", onStatus);
    p.on("sync", onSync);
    p.awareness.on("change", onAwarenessChange);

    setProvider(p);

    return () => {
      p.off("status", onStatus);
      p.off("sync", onSync);
      p.awareness.off("change", onAwarenessChange);
      p.destroy();
      setProvider(null);
      setConnected(false);
      setSynced(false);
      setPeers([]);
    };
  }, [docId, ydoc, me]);

  return { ydoc, provider, connected, synced, peers, me };
}
