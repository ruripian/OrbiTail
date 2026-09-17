/**
 * DocumentGraphPage — 문서 관계망
 *
 * 노드는 문서, 엣지는 본문에 박힌 문서 링크(DocumentLink)다.
 *
 * 이슈 GraphView 를 일반화하지 않고 따로 만들었다. 그쪽은 상태·우선순위·수동 링크 생성·
 * 프로젝트 super-node 같은 이슈 고유 개념이 1600줄에 얽혀 있어, 어댑터를 끼우려면 잘 돌아가는
 * 코드를 크게 흔들어야 한다. 문서 쪽은 그릴 것이 훨씬 단순해서(링크는 본문에서 오고, 노드에
 * 실리는 것은 제목·스페이스·연결 수뿐) 따로 두는 편이 양쪽 모두 읽기 쉽다.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, Share2, Focus, Maximize2 } from "lucide-react";
import { documentsApi, type DocumentGraph } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Sim = {
  id: string;
  title: string;
  space: string;
  degree: number;
  x: number; y: number;
  vx: number; vy: number;
};

/* 스페이스마다 색을 하나씩 — 같은 스페이스 문서가 눈으로 묶여 보이게 한다.
   프로젝트 색 팔레트와 같은 계열을 쓰되, 여기서는 스페이스 id 해시로 고정 배정한다
   (스페이스가 늘거나 줄어도 이미 익힌 색이 바뀌지 않게). */
const SPACE_COLORS = [
  "#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa",
  "#fb7185", "#22d3ee", "#a3e635", "#f97316", "#c084fc",
];
function spaceColor(spaceId: string): string {
  let h = 0;
  for (let i = 0; i < spaceId.length; i++) h = (h * 31 + spaceId.charCodeAt(i)) >>> 0;
  return SPACE_COLORS[h % SPACE_COLORS.length];
}

export default function DocumentGraphPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const spaceId = search.get("space") ?? undefined;
  const focusId = search.get("doc") ?? undefined;
  const depth = Number(search.get("depth") ?? 2);

  const { data, isLoading } = useQuery({
    queryKey: ["doc-graph", workspaceSlug, spaceId, focusId, depth],
    queryFn: () => documentsApi.graph(workspaceSlug!, {
      space: spaceId, doc: focusId, depth: focusId ? depth : undefined,
    }),
    enabled: !!workspaceSlug,
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <Share2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{t("documents.graph", "관계망")}</span>
        {data && (
          <span className="text-xs text-muted-foreground">
            {t("documents.graphCount", { n: data.nodes.length, e: data.edges.length })}
          </span>
        )}
        <div className="flex-1" />
        {focusId && (
          <Button
            variant="ghost" size="sm" className="h-7 text-xs gap-1.5"
            onClick={() => { search.delete("doc"); search.delete("depth"); setSearch(search, { replace: true }); }}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            {t("documents.graphShowAll", "전체 보기")}
          </Button>
        )}
      </div>

      {/* 상한에 걸려 잘린 사실을 조용히 넘기지 않는다 */}
      {data && data.truncated > 0 && (
        <p className="px-4 py-1.5 text-2xs text-amber-600 dark:text-amber-400 border-b shrink-0">
          {t("documents.graphTruncated", { n: data.truncated })}
        </p>
      )}

      <div className="flex-1 min-h-0 relative">
        {isLoading ? (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.nodes.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-center px-6">
            <div>
              <p className="text-sm text-muted-foreground">{t("documents.graphEmpty", "그릴 문서가 없습니다")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("documents.graphEmptyHint", "본문에서 [[ 로 다른 문서를 가리키면 여기에 이어집니다")}
              </p>
            </div>
          </div>
        ) : (
          <GraphCanvas
            data={data}
            focusId={focusId}
            onOpen={(n) => navigate(`/${workspaceSlug}/documents/space/${n.space}/${n.id}`)}
            onFocus={(n) => { search.set("doc", n.id); if (!search.get("depth")) search.set("depth", "2"); setSearch(search, { replace: true }); }}
          />
        )}
      </div>
    </div>
  );
}

function GraphCanvas({
  data, focusId, onOpen, onFocus,
}: {
  data: DocumentGraph;
  focusId?: string;
  onOpen: (n: Sim) => void;
  onFocus: (n: Sim) => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<Sim[]>([]);
  const byId = useRef<Map<string, Sim>>(new Map());
  const [hovered, setHovered] = useState<Sim | null>(null);

  const view = useRef({ zoom: 1, panX: 0, panY: 0 });
  const drag = useRef<{ node: Sim | null; panning: boolean; lastX: number; lastY: number; moved: boolean }>(
    { node: null, panning: false, lastX: 0, lastY: 0, moved: false },
  );

  /* 노드 배치 초기화 — 데이터가 바뀔 때만. 이미 있던 노드는 좌표를 유지해
     새로고침마다 그래프가 통째로 튀지 않게 한다. */
  useEffect(() => {
    const prev = byId.current;
    const next = new Map<string, Sim>();
    const N = data.nodes.length || 1;
    data.nodes.forEach((n, i) => {
      const old = prev.get(n.id);
      const angle = (i / N) * Math.PI * 2;
      const radius = 120 + Math.min(320, N * 3);
      next.set(n.id, old ?? {
        id: n.id, title: n.title, space: n.space, degree: n.degree,
        x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0,
      });
    });
    byId.current = next;
    nodesRef.current = [...next.values()];
  }, [data]);

  const edges = useMemo(() => data.edges, [data]);

  /* 물리 시뮬레이션 + 렌더 — 한 루프 안에서. 노드 수가 500 이하라 O(n²) 반발력으로 충분하다. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let alpha = 1;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = wrap.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const radiusOf = (n: Sim) => 5 + Math.min(9, n.degree * 1.6);

    const step = () => {
      const nodes = nodesRef.current;

      if (alpha > 0.005) {
        // 반발 — 노드끼리 밀어낸다
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
            if (d2 > 360_000) continue;   // 멀리 떨어진 쌍은 계산에서 뺀다
            const f = 2400 / d2;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
          }
        }
        // 인력 — 이어진 것끼리 당긴다
        for (const e of edges) {
          const s = byId.current.get(e.source), tgt = byId.current.get(e.target);
          if (!s || !tgt) continue;
          const dx = tgt.x - s.x, dy = tgt.y - s.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - 90) * 0.012;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          s.vx += fx; s.vy += fy; tgt.vx -= fx; tgt.vy -= fy;
        }
        // 중심으로 약하게 — 고립 노드가 화면 밖으로 흘러가지 않게
        for (const n of nodes) {
          n.vx -= n.x * 0.002; n.vy -= n.y * 0.002;
          n.vx *= 0.82; n.vy *= 0.82;
          if (drag.current.node !== n) { n.x += n.vx * alpha; n.y += n.vy * alpha; }
        }
        alpha *= 0.994;
      }

      // ── 렌더 ──
      const { width, height } = wrap.getBoundingClientRect();
      const css = getComputedStyle(document.documentElement);
      const fg = `hsl(${css.getPropertyValue("--foreground").trim()})`;
      const muted = `hsl(${css.getPropertyValue("--muted-foreground").trim()})`;
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2 + view.current.panX, height / 2 + view.current.panY);
      ctx.scale(view.current.zoom, view.current.zoom);

      ctx.lineWidth = 1;
      for (const e of edges) {
        const s = byId.current.get(e.source), tgt = byId.current.get(e.target);
        if (!s || !tgt) continue;
        const lit = hovered && (hovered.id === s.id || hovered.id === tgt.id);
        ctx.strokeStyle = lit ? spaceColor(s.space) : muted;
        ctx.globalAlpha = lit ? 0.9 : 0.22;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const n of nodes) {
        const r = radiusOf(n);
        const isFocus = n.id === focusId;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = spaceColor(n.space);
        // 고립 문서(연결 0)는 흐리게 — 한눈에 "아무 데도 안 이어진 문서"가 보이게
        ctx.globalAlpha = n.degree === 0 ? 0.35 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (isFocus || hovered?.id === n.id) {
          ctx.strokeStyle = fg;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // 이름은 큰 노드와 확대했을 때만 — 다 쓰면 글자밭이 된다
        if (view.current.zoom > 0.75 || n.degree >= 3 || hovered?.id === n.id) {
          ctx.fillStyle = hovered?.id === n.id || isFocus ? fg : muted;
          ctx.font = "11px system-ui, sans-serif";
          ctx.textAlign = "center";
          const label = n.title.length > 18 ? `${n.title.slice(0, 18)}…` : n.title;
          ctx.fillText(label, n.x, n.y + r + 12);
        }
      }
      ctx.restore();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [edges, hovered, focusId]);

  /* 화면 좌표 → 그래프 좌표 */
  const toGraph = (clientX: number, clientY: number) => {
    const wrap = wrapRef.current!;
    const r = wrap.getBoundingClientRect();
    const { zoom, panX, panY } = view.current;
    return {
      x: (clientX - r.left - r.width / 2 - panX) / zoom,
      y: (clientY - r.top - r.height / 2 - panY) / zoom,
    };
  };

  const hitTest = (clientX: number, clientY: number): Sim | null => {
    const p = toGraph(clientX, clientY);
    for (const n of nodesRef.current) {
      const r = 5 + Math.min(9, n.degree * 1.6) + 4;
      if ((n.x - p.x) ** 2 + (n.y - p.y) ** 2 <= r * r) return n;
    }
    return null;
  };

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 overflow-hidden"
      onWheel={(e) => {
        const next = view.current.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
        view.current.zoom = Math.max(0.2, Math.min(3, next));
      }}
      onMouseDown={(e) => {
        const hit = hitTest(e.clientX, e.clientY);
        drag.current = { node: hit, panning: !hit, lastX: e.clientX, lastY: e.clientY, moved: false };
      }}
      onMouseMove={(e) => {
        const d = drag.current;
        if (d.node) {
          const p = toGraph(e.clientX, e.clientY);
          d.node.x = p.x; d.node.y = p.y; d.node.vx = 0; d.node.vy = 0;
          d.moved = true;
        } else if (d.panning) {
          view.current.panX += e.clientX - d.lastX;
          view.current.panY += e.clientY - d.lastY;
          d.lastX = e.clientX; d.lastY = e.clientY; d.moved = true;
        } else {
          setHovered(hitTest(e.clientX, e.clientY));
        }
      }}
      onMouseUp={(e) => {
        const d = drag.current;
        // 끌지 않고 눌렀다 뗀 것만 클릭으로 — 노드를 옮기다 문서가 열리면 성가시다
        if (d.node && !d.moved) {
          if (e.altKey) onFocus(d.node);
          else onOpen(d.node);
        }
        drag.current = { node: null, panning: false, lastX: 0, lastY: 0, moved: false };
      }}
      onMouseLeave={() => { drag.current = { node: null, panning: false, lastX: 0, lastY: 0, moved: false }; setHovered(null); }}
    >
      <canvas ref={canvasRef} className={cn("block", drag.current.panning ? "cursor-grabbing" : "cursor-default")} />
      <p className="absolute bottom-2 left-3 text-2xs text-muted-foreground pointer-events-none">
        {t("documents.graphHintA")} <Focus className="inline h-3 w-3" /> {t("documents.graphHintB")}
      </p>
    </div>
  );
}
