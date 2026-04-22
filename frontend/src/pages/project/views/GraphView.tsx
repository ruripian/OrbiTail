/**
 * GraphView — 프로젝트 범위 노드 그래프 (같은 꼭지 아래 이슈 관계망)
 *
 * - 수동 node-link (IssueNodeLink) + 라벨 공유 자동 edge
 * - 프로젝트 내부 이슈 전체 + 해당 프로젝트가 source 인 수동 링크의 target (외부 이슈도 표시 가능)
 * - 클릭 시 이슈 상세 오픈, 드래그로 노드 이동, 휠로 줌, 빈 공간 드래그로 팬
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { issuesApi } from "@/api/issues";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Node = {
  id: string;
  title: string;
  sequence_id: number;
  project_id: string | null;
  project_identifier: string | null;
  state_group: string | null;
  labels: Array<{ id: string; name: string; color: string }>;
  external?: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
};

const STATE_COLOR: Record<string, string> = {
  backlog: "#94a3b8",
  unstarted: "#64748b",
  started: "#3b82f6",
  completed: "#22c55e",
  cancelled: "#ef4444",
};

interface Props {
  workspaceSlug: string;
  projectId: string;
  onIssueClick?: (issueId: string) => void;
}

export function GraphView({ workspaceSlug, projectId, onIssueClick }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const [, forceTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  // 라벨 기반 자동 엣지 제외 — 수동 node-link 만 표시. 라벨은 카테고리화 용도라 관계망과 역할 분리.
  const { data, isLoading } = useQuery({
    queryKey: ["node-graph", workspaceSlug, projectId, "manual"],
    queryFn: () => issuesApi.nodeGraph(workspaceSlug, projectId, { manualOnly: true, includeLabelEdges: false }),
    enabled: !!workspaceSlug && !!projectId,
  });

  useEffect(() => {
    if (!data) return;
    const existing = nodesRef.current;
    const next = new Map<string, Node>();
    data.nodes.forEach((n, i) => {
      const prev = existing.get(n.id);
      const ang = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
      next.set(n.id, {
        ...n,
        x: prev?.x ?? 500 + Math.cos(ang) * 220,
        y: prev?.y ?? 400 + Math.sin(ang) * 220,
        vx: 0,
        vy: 0,
        fx: prev?.fx ?? null,
        fy: prev?.fy ?? null,
      });
    });
    nodesRef.current = next;
    forceTick((x) => x + 1);
  }, [data]);

  // 드래그/줌 조작 시 시뮬레이션 재기동 신호
  const [simKick, setSimKick] = useState(0);

  useEffect(() => {
    if (!data) return;
    let running = true;
    // 초기 온도는 1에서 시작해 서서히 식지만, 최소 온도를 유지해 Obsidian 처럼 끊임없이 미세 진동.
    let temperature = 1;
    const REPULSION = 8000;
    const IDEAL_LEN = 140;
    const SPRING = 0.04;
    const CENTER_PULL = 0.002;
    const DAMPING = 0.86;
    // 최소 온도 — 0 이면 완전히 정지. 작지만 0 이 아니어서 영구적으로 살짝 떠다님.
    const MIN_TEMP = 0.08;

    const step = () => {
      if (!running) return;
      const nodes = Array.from(nodesRef.current.values());
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const f = REPULSION / d2;
          const d = Math.sqrt(d2);
          a.vx += (dx / d) * f * temperature;
          a.vy += (dy / d) * f * temperature;
          b.vx -= (dx / d) * f * temperature;
          b.vy -= (dy / d) * f * temperature;
        }
      }
      for (const e of data.edges) {
        const s = nodesRef.current.get(e.source);
        const tgt = nodesRef.current.get(e.target);
        if (!s || !tgt) continue;
        const dx = tgt.x - s.x;
        const dy = tgt.y - s.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = (d - IDEAL_LEN) * SPRING;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        s.vx += fx;
        s.vy += fy;
        tgt.vx -= fx;
        tgt.vy -= fy;
      }
      for (const n of nodes) {
        n.vx += (500 - n.x) * CENTER_PULL;
        n.vy += (400 - n.y) * CENTER_PULL;
      }
      for (const n of nodes) {
        if (n.fx != null && n.fy != null) {
          n.x = n.fx;
          n.y = n.fy;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += Math.max(-30, Math.min(30, n.vx));
        n.y += Math.max(-30, Math.min(30, n.vy));
      }
      // Obsidian 스타일 — 완전 정지하지 않고 MIN_TEMP 에서 계속 미세 요동
      temperature = Math.max(MIN_TEMP, temperature * 0.996);
      forceTick((x) => (x + 1) % 1000);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [data, simKick]);

  const [drag, setDrag] = useState<{ nodeId: string } | null>(null);
  const [panStart, setPanStart] = useState<{ x: number; y: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (drag) {
        const rect = containerRef.current!.getBoundingClientRect();
        const x = (e.clientX - rect.left - pan.x) / zoom;
        const y = (e.clientY - rect.top - pan.y) / zoom;
        const n = nodesRef.current.get(drag.nodeId);
        if (!n) return;
        n.fx = x;
        n.fy = y;
        n.x = x;
        n.y = y;
        forceTick((i) => i + 1);
      } else if (panStart) {
        setPan({
          x: panStart.origX + (e.clientX - panStart.x),
          y: panStart.origY + (e.clientY - panStart.y),
        });
      }
    };
    const onUp = () => {
      if (drag) setSimKick((k) => k + 1);
      setDrag(null);
      setPanStart(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, panStart, pan, zoom]);

  const handleWheel = (e: React.WheelEvent) => {
    const delta = -e.deltaY * 0.001;
    const next = Math.max(0.2, Math.min(3, zoom * (1 + delta)));
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const k = next / zoom;
    setPan({ x: cx - (cx - pan.x) * k, y: cy - (cy - pan.y) * k });
    setZoom(next);
  };

  const nodes = useMemo(() => Array.from(nodesRef.current.values()), [data]);
  const edges = data?.edges ?? [];

  const openIssue = (id: string) => {
    if (onIssueClick) return onIssueClick(id);
    const node = nodesRef.current.get(id);
    // 다른 프로젝트 이슈면 해당 프로젝트 URL 로 이동해야 패널이 열림
    if (node && node.project_id && node.project_id !== projectId) {
      navigate(`/${workspaceSlug}/projects/${node.project_id}/issues?issue=${id}`);
    } else {
      setSearchParams((sp) => { sp.set("issue", id); return sp; });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-5 h-10 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          {nodes.length}개 노드 · {edges.length}개 연결
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
          {t("graph.resetView", "리셋")}
        </Button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-gradient-to-br from-muted/20 to-background select-none"
        onWheel={handleWheel}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-graph-node]")) return;
          setPanStart({ x: e.clientX, y: e.clientY, origX: pan.x, origY: pan.y });
        }}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
            {t("graph.empty", "이 프로젝트에는 아직 연결된 이슈가 없습니다. 이슈 상세의 '관련 이슈' 탭에서 자유 연결을 추가하거나 라벨을 공유해 클러스터를 만들어보세요.")}
          </div>
        )}

        <svg
          className="absolute inset-0 w-full h-full"
          style={{ cursor: panStart ? "grabbing" : "grab" }}
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {edges.map((e) => {
              const s = nodesRef.current.get(e.source);
              const tgt = nodesRef.current.get(e.target);
              if (!s || !tgt) return null;
              return (
                <line
                  key={e.id}
                  x1={s.x}
                  y1={s.y}
                  x2={tgt.x}
                  y2={tgt.y}
                  stroke="#64748b"
                  strokeWidth={2}
                  opacity={0.8}
                />
              );
            })}
            {nodes.map((n) => {
              const fill = n.state_group ? STATE_COLOR[n.state_group] ?? "#6b7280" : "#6b7280";
              return (
                <g
                  key={n.id}
                  data-graph-node
                  transform={`translate(${n.x} ${n.y})`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDrag({ nodeId: n.id });
                    n.fx = n.x;
                    n.fy = n.y;
                  }}
                  onDoubleClick={() => {
                    n.fx = null;
                    n.fy = null;
                    // unpin 이후 레이아웃 재배치를 위해 시뮬 재개
                    setSimKick((k) => k + 1);
                  }}
                  onClick={() => openIssue(n.id)}
                  className="cursor-pointer"
                >
                  <circle
                    r={n.external ? 8 : 11}
                    fill={fill}
                    stroke={n.external ? "#fbbf24" : "#ffffff"}
                    strokeWidth={2}
                    strokeDasharray={n.external ? "2 2" : undefined}
                  />
                  {n.labels[0] && (
                    <circle r={14} fill="none" stroke={n.labels[0].color} strokeWidth={2} opacity={0.7} />
                  )}
                  <text x={16} y={4} fontSize={11} className="fill-foreground pointer-events-none">
                    {n.project_identifier ? `${n.project_identifier}-${n.sequence_id} ` : ""}
                    {n.title.length > 30 ? n.title.slice(0, 30) + "…" : n.title}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
