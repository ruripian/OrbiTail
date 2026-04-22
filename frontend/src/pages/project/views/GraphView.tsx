/**
 * GraphView — 프로젝트 범위 노드 그래프 (같은 꼭지 아래 이슈 관계망)
 *
 * - 수동 node-link (IssueNodeLink) + 라벨 공유 자동 edge
 * - 프로젝트 내부 이슈 전체 + 해당 프로젝트가 source 인 수동 링크의 target (외부 이슈도 표시 가능)
 * - 클릭 시 이슈 상세 오픈, 드래그로 노드 이동, 휠로 줌, 빈 공간 드래그로 팬
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { ProjectIcon } from "@/components/ui/project-icon-picker";
import { Button } from "@/components/ui/button";
import { Loader2, Sliders, Link2, X, Unlink2, ArrowRight, Layers } from "lucide-react";

type Node = {
  id: string;
  title: string;
  sequence_id: number;
  project_id: string | null;
  project_identifier: string | null;
  state_group: string | null;
  labels: Array<{ id: string; name: string; color: string }>;
  external?: boolean;
  category_id?: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
};

type LinkTypeValue = "relates_to" | "blocks";
const LINK_TYPES: { value: LinkTypeValue; label: string; short: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "relates_to", label: "연관", short: "연관",
    desc: "서로 관련 있는 대등한 관계. 방향성 없음. 예: 같은 API 를 건드리는 버그 둘. — 그래프에서 이중선으로 표시.",
    icon: Link2 },
  { value: "blocks",     label: "의존", short: "선행 → 후행",
    desc: "A가 끝나야 B 진행 가능. 첫 번째로 클릭한 노드가 '선행(막는 쪽)', 두 번째가 '후행(막히는 쪽)'. — 그래프에서 주황 화살표로 표시.",
    icon: ArrowRight },
];

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
  categoryId?: string | null;
  onIssueClick?: (issueId: string) => void;
}

export function GraphView({ workspaceSlug, projectId, categoryId, onIssueClick }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const [, forceTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const [hasFit, setHasFit] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // 태양계 레이아웃 파라미터 — 드롭 시 업데이트하기 위해 ref 로 노출
  const orbitParamsRef = useRef<Map<string, { baseAngle: number; omega: number; radius: number }>>(new Map());
  const rootPolarRef = useRef<Map<string, { r: number; base: number }>>(new Map());
  const parentOfRef = useRef<Map<string, string>>(new Map());
  const orbitStartTimeRef = useRef<number>(0);
  const galaxyOmegaRef = useRef<number>(0);

  // 뷰 옵션 — localStorage 지속
  const [showIds, setShowIds] = useState<boolean>(() => {
    try { return localStorage.getItem("orbitail_graph_showIds") !== "0"; } catch { return true; }
  });
  const [labelSize, setLabelSize] = useState<number>(() => {
    try { return Number(localStorage.getItem("orbitail_graph_labelSize")) || 11; } catch { return 11; }
  });
  const [animating, setAnimating] = useState<boolean>(() => {
    try { return localStorage.getItem("orbitail_graph_animating") !== "0"; } catch { return true; }
  });
  const [layoutMode, setLayoutMode] = useState<"force" | "orbit">(() => {
    try { return localStorage.getItem("orbitail_graph_layout") === "orbit" ? "orbit" : "force"; } catch { return "force"; }
  });
  // 포스 모드 반발력 — 0(서로 잘 붙음) ~ 100(확 퍼짐). localStorage.
  const [repulsionLevel, setRepulsionLevel] = useState<number>(() => {
    try {
      // 이전 키(cohesion) 가 있으면 마이그레이션해 반전 (100 - 값)
      const legacy = localStorage.getItem("orbitail_graph_cohesion");
      if (legacy != null) {
        const v = 100 - Number(legacy);
        localStorage.setItem("orbitail_graph_repulsion", String(v));
        localStorage.removeItem("orbitail_graph_cohesion");
        return Number.isFinite(v) ? v : 50;
      }
      return Number(localStorage.getItem("orbitail_graph_repulsion") ?? 50);
    } catch { return 50; }
  });
  useEffect(() => { try { localStorage.setItem("orbitail_graph_repulsion", String(repulsionLevel)); } catch {/*ignore*/} }, [repulsionLevel]);

  // 태양계 공전 속도 배율 — 0(정지) ~ 200(%).
  const [orbitSpeed, setOrbitSpeed] = useState<number>(() => {
    try { return Number(localStorage.getItem("orbitail_graph_orbitSpeed") ?? 100); } catch { return 100; }
  });
  useEffect(() => { try { localStorage.setItem("orbitail_graph_orbitSpeed", String(orbitSpeed)); } catch {/*ignore*/} }, [orbitSpeed]);

  const [linkType, setLinkType] = useState<LinkTypeValue>(() => {
    try {
      const v = localStorage.getItem("orbitail_graph_linkType");
      if (v === "relates_to" || v === "blocks") return v;
      return "relates_to";
    } catch { return "relates_to"; }
  });

  // 편집 모드 — null / 연결 추가 / 연결 해제
  const [editMode, setEditMode] = useState<null | "connect" | "disconnect">(null);
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null);
  const [focusedDepth, setFocusedDepth] = useState<number | null>(null);
  // 패널 — 하나만 열림
  const [openPanel, setOpenPanel] = useState<null | "settings" | "layer" | "help">(null);
  const togglePanel = (p: "settings" | "layer" | "help") => setOpenPanel((cur) => (cur === p ? null : p));
  const qc = useQueryClient();

  // 상태 변경 시 자동 저장
  useEffect(() => { try { localStorage.setItem("orbitail_graph_showIds", showIds ? "1" : "0"); } catch {/*ignore*/} }, [showIds]);
  useEffect(() => { try { localStorage.setItem("orbitail_graph_labelSize", String(labelSize)); } catch {/*ignore*/} }, [labelSize]);
  useEffect(() => { try { localStorage.setItem("orbitail_graph_animating", animating ? "1" : "0"); } catch {/*ignore*/} }, [animating]);
  useEffect(() => { try { localStorage.setItem("orbitail_graph_layout", layoutMode); } catch {/*ignore*/} }, [layoutMode]);
  useEffect(() => { try { localStorage.setItem("orbitail_graph_linkType", linkType); } catch {/*ignore*/} }, [linkType]);

  // 프로젝트 메타 (태양계 중심 라벨)
  const { data: project } = useQuery({
    queryKey: ["project", workspaceSlug, projectId],
    queryFn: () => projectsApi.get(workspaceSlug, projectId),
    enabled: !!workspaceSlug && !!projectId,
    staleTime: 60_000,
  });

  // 카테고리 목록 (필터용)
  const { data: categories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, projectId],
    queryFn: () => projectsApi.categories.list(workspaceSlug, projectId),
    enabled: !!workspaceSlug && !!projectId,
    staleTime: 60_000,
  });

  // 카테고리 필터 — 상단 카테고리 네비게이션(URL 의 /categories/:categoryId) 에서 prop 으로 받음.
  const categoryFilterId = categoryId ?? null;
  const activeCategory = categoryFilterId ? categories.find((c) => c.id === categoryFilterId) ?? null : null;

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
    const N = data.nodes.length;
    // 초기 배치 — 작게 모아두고 천천히 퍼지게. "촤아악" 폭발 억제.
    const radius = 80 + Math.sqrt(N) * 18;
    data.nodes.forEach((n, i) => {
      const prev = existing.get(n.id);
      const ang = (i / Math.max(1, N)) * Math.PI * 2 + Math.random() * 0.25;
      const r = radius * (0.7 + Math.random() * 0.35);
      next.set(n.id, {
        ...n,
        x: prev?.x ?? 600 + Math.cos(ang) * r,
        y: prev?.y ?? 450 + Math.sin(ang) * r,
        vx: 0,
        vy: 0,
        fx: prev?.fx ?? null,
        fy: prev?.fy ?? null,
      });
    });
    nodesRef.current = next;
    setHasFit(false); // 새 데이터 들어오면 한 번 오토핏
    forceTick((x) => x + 1);
  }, [data]);

  // 드래그/줌 조작 시 시뮬레이션 재기동 신호
  const [simKick, setSimKick] = useState(0);

  // 파생 상태 — 편집 서브모드
  const isConnect = editMode === "connect";
  const isDisconnect = editMode === "disconnect";

  // Esc 로 편집 모드 종료
  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditMode(null);
        setPendingSource(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode]);

  // 계층(depth) 맵 — parent 엣지 BFS. 계층 패널 + 편집 필터용.
  const depthMap = (() => {
    const map = new Map<string, number>();
    if (!data) return map;
    const children = new Map<string, string[]>();
    const hasParent = new Set<string>();
    for (const e of data.edges) {
      if ((e as any).link_type !== "parent") continue;
      if (!children.has(e.source)) children.set(e.source, []);
      children.get(e.source)!.push(e.target);
      hasParent.add(e.target);
    }
    const queue: string[] = [];
    for (const n of data.nodes) if (!hasParent.has(n.id)) { map.set(n.id, 0); queue.push(n.id); }
    while (queue.length) {
      const id = queue.shift()!;
      const d = map.get(id)!;
      for (const c of children.get(id) ?? []) if (!map.has(c)) { map.set(c, d + 1); queue.push(c); }
    }
    let maxD = 0; for (const v of map.values()) if (v > maxD) maxD = v;
    for (const n of data.nodes) if (!map.has(n.id)) map.set(n.id, maxD + 1);
    return map;
  })();
  const depthCounts = (() => {
    const counts = new Map<number, number>();
    for (const d of depthMap.values()) counts.set(d, (counts.get(d) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => a[0] - b[0]);
  })();

  // 노드-링크 삭제 (해제 모드) — 즉시 삭제 + "되돌리기" undo toast
  const deleteLinkMutation = useMutation({
    mutationFn: (linkId: string) => issuesApi.nodeLinks.delete(workspaceSlug, linkId),
    onError: () => toast.error(t("graphView.linkDeleteFailed", "해제 실패 (권한 부족?)")),
  });

  const disconnectEdge = (edge: { id: string; source: string; target: string; link_type: string }) => {
    const snapshot = { source: edge.source, target: edge.target, link_type: edge.link_type };
    deleteLinkMutation.mutate(edge.id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["node-graph", workspaceSlug, projectId] });
        qc.invalidateQueries({ queryKey: ["node-links"] });
        toast(t("graphView.linkDeleted", "연결을 해제했습니다"), {
          action: {
            label: t("graphView.undo", "되돌리기"),
            onClick: () => {
              issuesApi.nodeLinks
                .create(workspaceSlug, projectId, snapshot.source, {
                  source: snapshot.source,
                  target: snapshot.target,
                  link_type: snapshot.link_type as LinkTypeValue,
                })
                .then(() => {
                  toast.success(t("graphView.linkRestored", "연결을 복구했습니다"));
                  qc.invalidateQueries({ queryKey: ["node-graph", workspaceSlug, projectId] });
                })
                .catch(() => toast.error(t("graphView.linkRestoreFailed", "복구 실패")));
            },
          },
          duration: 6000,
        });
      },
    });
  };

  // 노드-링크 생성 뮤테이션 (연결 모드)
  const createLinkMutation = useMutation({
    mutationFn: ({ source, target }: { source: string; target: string }) =>
      issuesApi.nodeLinks.create(workspaceSlug, projectId, source, {
        source,
        target,
        link_type: linkType,
      }),
    onSuccess: () => {
      toast.success(t("graphView.linkCreated", "이슈를 연결했습니다"));
      qc.invalidateQueries({ queryKey: ["node-graph", workspaceSlug, projectId] });
      qc.invalidateQueries({ queryKey: ["node-links"] });
    },
    onError: () => toast.error(t("graphView.linkCreateFailed", "연결 실패 (이미 연결되었거나 권한 부족)")),
  });

  // ===== 태양계(orbit) 레이아웃 — 진짜 계층적. 부모 = 태양, 자식 = 부모 주변을 도는 위성 =====
  useEffect(() => {
    if (!data || layoutMode !== "orbit") return;
    let running = true;

    // 부모 엣지로부터 parent / children 맵 구성
    const parentOf = new Map<string, string>();
    const childrenOf = new Map<string, string[]>();
    for (const e of data.edges) {
      if ((e as any).link_type !== "parent") continue;
      if (!data.nodes.find((n) => n.id === e.source) || !data.nodes.find((n) => n.id === e.target)) continue;
      parentOf.set(e.target, e.source);
      if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
      childrenOf.get(e.source)!.push(e.target);
    }

    // 루트 = 부모 엣지의 target 이 아닌 노드
    const roots: string[] = [];
    for (const n of data.nodes) {
      if (!parentOf.has(n.id)) roots.push(n.id);
    }

    // depth 계산 (BFS)
    const depthOf = new Map<string, number>();
    const q: string[] = [];
    for (const r of roots) { depthOf.set(r, 0); q.push(r); }
    while (q.length) {
      const id = q.shift()!;
      const d = depthOf.get(id)!;
      for (const c of childrenOf.get(id) ?? []) {
        if (!depthOf.has(c)) { depthOf.set(c, d + 1); q.push(c); }
      }
    }
    // 사이클 등으로 미배정 → 루트 취급
    for (const n of data.nodes) {
      if (!depthOf.has(n.id)) { depthOf.set(n.id, 0); roots.push(n.id); }
    }

    // 루트 위치 — 여러 태양이면 넓게 배치, 하나면 중앙
    const cx = 600, cy = 450;
    const rootPos = new Map<string, { x: number; y: number }>();
    if (roots.length <= 1) {
      if (roots[0]) rootPos.set(roots[0], { x: cx, y: cy });
    } else {
      // 각 태양 간 거리 — 자손 수에 따라 여유 확보
      const totalDescendants = (id: string): number => {
        const kids = childrenOf.get(id) ?? [];
        return 1 + kids.reduce((s, k) => s + totalDescendants(k), 0);
      };
      const sizes = roots.map((r) => totalDescendants(r));
      // 각 태양이 차지하는 반경 추정 → 링 둘레에 배치
      const perimeter = sizes.reduce((s, sz) => s + Math.max(160, 80 + Math.sqrt(sz) * 120), 0);
      const ringR = Math.max(260, perimeter / (2 * Math.PI));
      let acc = 0;
      roots.forEach((id, i) => {
        const span = Math.max(160, 80 + Math.sqrt(sizes[i]) * 120);
        const a = ((acc + span / 2) / perimeter) * Math.PI * 2;
        rootPos.set(id, { x: cx + Math.cos(a) * ringR, y: cy + Math.sin(a) * ringR });
        acc += span;
      });
    }

    // 자손 수 — 각 노드의 "질량" 추정. 무거운 자식은 바깥 궤도, 가벼운 자식은 안쪽.
    const subtreeSize = new Map<string, number>();
    const computeSize = (id: string): number => {
      if (subtreeSize.has(id)) return subtreeSize.get(id)!;
      const kids = childrenOf.get(id) ?? [];
      let s = 1;
      for (const k of kids) s += computeSize(k);
      subtreeSize.set(id, s);
      return s;
    };
    for (const n of data.nodes) computeSize(n.id);

    // 각 비루트 노드의 궤도 파라미터 — 같은 부모라도 자손 수에 따라 반경 다르게.
    const orbit = orbitParamsRef.current;
    orbit.clear();
    parentOfRef.current = parentOf;
    for (const [pid, kids] of childrenOf) {
      const pDepth = depthOf.get(pid) ?? 0;
      const count = kids.length;
      // 부모 깊이별 기본 반경
      const baseR = Math.max(40, 160 / Math.sqrt(pDepth + 1));
      // 자손 크기 랭킹 — 무거운 애를 바깥쪽에 (뚜렷한 행성 / 소천체)
      const maxSz = Math.max(1, ...kids.map((k) => subtreeSize.get(k) ?? 1));
      kids.forEach((kid, i) => {
        const sz = subtreeSize.get(kid) ?? 1;
        const weight = sz / maxSz;
        const ringSpread = 1 + count * 0.06;
        // 반경 지터 — 자식들이 같은 링에 딱 정렬되지 않도록 ±15%
        const jitter = 0.85 + Math.random() * 0.3;
        const radius = baseR * ringSpread * (0.75 + weight * 0.5 + (i % 3) * 0.08) * jitter;
        const baseAngle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        // 케플러 풍 — ω ∝ 1/r^1.1. 공전이 실제로 보이게 계수 더 올림.
        //   r=40 → ~0.7  (≈9s/rev)
        //   r=80 → ~0.33 (≈19s/rev)
        //   r=150→ ~0.17 (≈37s/rev)
        const keplerOmega = 55 / Math.pow(radius, 1.1);
        const speedMul = Math.max(0, orbitSpeed) / 100;
        const omega = (animating ? 1 : 0) * Math.max(0.1, Math.min(1.0, keplerOmega)) * (0.9 + Math.random() * 0.2) * speedMul;
        orbit.set(kid, { baseAngle, omega, radius });
      });
    }

    // topological 순서 — depth 오름차순
    const ordered = Array.from(depthOf.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);

    const startTime = performance.now();
    orbitStartTimeRef.current = startTime;
    const galaxyOmega = (animating ? 0.09 : 0) * (Math.max(0, orbitSpeed) / 100);
    galaxyOmegaRef.current = galaxyOmega;
    const rootPolar = rootPolarRef.current;
    rootPolar.clear();
    for (const [id, p] of rootPos) {
      const dx = p.x - cx, dy = p.y - cy;
      rootPolar.set(id, { r: Math.hypot(dx, dy), base: Math.atan2(dy, dx) });
    }

    const step = () => {
      if (!running) return;
      const t = (performance.now() - startTime) / 1000;
      const pos = new Map<string, { x: number; y: number }>();
      for (const id of ordered) {
        const n = nodesRef.current.get(id);
        if (!n) continue;
        // fx/fy 가 설정된 노드 = 앵커(드래그 중이거나 루트 드래그 후 고정). 자식 궤도 계산의 기준.
        if (n.fx != null && n.fy != null) {
          n.x = n.fx;
          n.y = n.fy;
          pos.set(id, { x: n.fx, y: n.fy });
          continue;
        }
        let tx: number, ty: number;
        const params = orbit.get(id);
        if (!params) {
          const rp = rootPolar.get(id);
          if (!rp) continue;
          const a = rp.base + galaxyOmega * t;
          tx = cx + Math.cos(a) * rp.r;
          ty = cy + Math.sin(a) * rp.r;
        } else {
          const pid = parentOf.get(id)!;
          const pp = pos.get(pid);
          if (!pp) continue;
          const a = params.baseAngle + params.omega * t;
          tx = pp.x + Math.cos(a) * params.radius;
          ty = pp.y + Math.sin(a) * params.radius;
        }
        pos.set(id, { x: tx, y: ty });
        // 속도 기반 적분 — 포스 모드와 같은 상수대로 통일. 부드러운 관성 + 튐 없음.
        const d = depthMap.get(id) ?? 0;
        const m = Math.max(1, 1.3 - d * 0.06);
        // 스프링 더 낮춤 + 감쇠 ↑ → 놓는 순간 미끄러지듯 다음 궤도로, 튐 없음
        const k = 0.022 / m;
        const damp = 0.91;
        const fx_ = (tx - n.x) * k;
        const fy_ = (ty - n.y) * k;
        // "별 띄우기" — 아주 작은 무작위 부유
        const jitter = (dragRef.current ? 0 : 0.03);
        n.vx = (n.vx + fx_) * damp + (Math.random() - 0.5) * jitter;
        n.vy = (n.vy + fy_) * damp + (Math.random() - 0.5) * jitter;
        n.x += n.vx;
        n.y += n.vy;
      }
      forceTick((x) => (x + 1) % 1000);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [data, layoutMode, animating, orbitSpeed]);

  // ===== 포스 레이아웃 물리 =====
  useEffect(() => {
    if (!data || layoutMode !== "force") return;
    let running = true;
    // 정적 모드: 약 1.2초 동안만 시뮬레이션을 돌려 레이아웃을 정착시킨 뒤 멈춘다.
    const stopAt = animating ? Infinity : performance.now() + 1200;
    // Obsidian 유사 물리:
    //  - 초기 온도 높게 → 빠르게 퍼지고
    //  - 감쇠는 약간 느슨히 해서 드리프트가 오래감
    //  - 중심 인력은 아주 약하게 — 레이아웃이 자유롭게 퍼지도록
    // Orbitail 이름 모티프 — 가볍게 선회하는 느낌. 감쇠는 높게, 스프링은 부드럽게,
    // 탄성이 튀어오르지 않고 쪽 흘러들어가는 이미지. 여기에 아주 작은 접선(tangential) 드리프트를 더해
    // 궤도를 따라 흐르는 듯한 움직임을 준다.
    // 로드 직후엔 조용히 — "촤자자작" 튐 방지.
    let temperature = 0.25;
    const N = data.nodes.length || 1;
    // 반발력 slider: 0(잘 붙음) ~ 100(확 퍼짐). 값 ↑ → 반발 ↑ · 중심 인력 ↓.
    const r = Math.max(0, Math.min(100, repulsionLevel)) / 100;
    // 0 에선 한데 뭉침(반발 작음, 중심 인력 큼).
    // 100 에선 쫙 퍼짐(반발 매우 큼, 중심 인력 거의 없음).
    const REPULSION = 1200 * (0.16 + r * 90);        // 0: 192 / 50: 54192 / 100: 108192 (5x 강화)
    const IDEAL_LEN = 115;
    const SPRING = 0.045;
    const CENTER_PULL = 0.0008 * (5.0 - r * 4.98);   // 0: 0.004 / 100: ~0.000016
    const DAMPING = 0.84;            // 감쇠 살짝 ↓ → 출렁임 유지
    const MIN_TEMP = 0.03;
    const MAX_STEP = 14;             // 한 프레임 이동 폭 ↑ → 드래그/릴리즈 반응 강화
    const ORBIT_SWIRL = 0.008;

    // 질량 — 차이 완화(r^2). 20px ≈ 8.2, 7px = 1 → 8배 정도. 너무 극단적이지 않게.
    const massOf = (id: string): number => {
      const d = depthMap.get(id) ?? 0;
      const r = Math.max(7, Math.min(20, 22 / Math.sqrt(d + 1)));
      return Math.pow(r / 7, 2);
    };

    // 드래그 중엔 반발력을 크게 낮춤 → 공전궤도처럼 "부모 쪽으로 직선 끌림" 에 가까운 감각.
    const repBase = REPULSION * (N > 80 ? 0.75 : 1);
    const rep = dragRef.current ? repBase * 0.2 : repBase;

    const step = () => {
      if (!running) return;
      const nodes = Array.from(nodesRef.current.values());
      // 질량 캐시 — 루프마다 호출 최소화
      const massMap = new Map<string, number>();
      const mass = (id: string) => {
        let m = massMap.get(id);
        if (m == null) { m = massOf(id); massMap.set(id, m); }
        return m;
      };

      // 반발력 — 힘이 같아도 무거운 쪽은 덜 밀림 (a/ma, b/mb)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const ma = mass(a.id);
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const mb = mass(b.id);
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = dx*dx + dy*dy + 0.01; }
          const d = Math.sqrt(d2);
          const f = rep / d2;
          a.vx += (dx / d) * f / ma;
          a.vy += (dy / d) * f / ma;
          b.vx -= (dx / d) * f / mb;
          b.vy -= (dy / d) * f / mb;
        }
      }
      // 엣지 스프링 — 질량 가중 (부모-자식은 부모가 무거워 자식이 끌려감)
      for (const e of data.edges) {
        const s = nodesRef.current.get(e.source);
        const tgt = nodesRef.current.get(e.target);
        if (!s || !tgt) continue;
        const dx = tgt.x - s.x;
        const dy = tgt.y - s.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        // 부모-자식 스프링 — 정상시엔 3.3x, 드래그 중엔 8x 추가 증폭 → 끌려오는 감 확실.
        const dragBoost = dragRef.current ? 8 : 1;
        const parentSpring = SPRING * 3.3 * dragBoost;
        const spring = (e as any).link_type === "parent" ? parentSpring : parentSpring * 0.3;
        const f = (d - IDEAL_LEN) * spring;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        s.vx += fx / mass(s.id);
        s.vy += fy / mass(s.id);
        tgt.vx -= fx / mass(tgt.id);
        tgt.vy -= fy / mass(tgt.id);
      }
      // 약한 중심 인력 + 접선 드리프트 — 질량 무관(모두 균일하게 부유감)
      for (const n of nodes) {
        const dx = n.x - 600;
        const dy = n.y - 450;
        n.vx += -dx * CENTER_PULL;
        n.vy += -dy * CENTER_PULL;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        n.vx += (-dy / d) * ORBIT_SWIRL;
        n.vy += ( dx / d) * ORBIT_SWIRL;
      }
      // 적분 + 속도 클램프. 드래그 중이면 상한 완화해서 자식들이 빠르게 따라올 수 있게.
      const stepCap = dragRef.current ? MAX_STEP * 4 : MAX_STEP;
      for (const n of nodes) {
        if (n.fx != null && n.fy != null) {
          n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue;
        }
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        const dx = Math.max(-stepCap, Math.min(stepCap, n.vx)) * Math.max(MIN_TEMP, temperature);
        const dy = Math.max(-stepCap, Math.min(stepCap, n.vy)) * Math.max(MIN_TEMP, temperature);
        n.x += dx;
        n.y += dy;
      }
      // 정적 모드에선 온도 빠르게 식혀 수렴시키고, 시간 지나면 중단
      if (animating) {
        temperature = Math.max(MIN_TEMP, temperature * 0.992);
      } else {
        temperature *= 0.96;
      }
      forceTick((x) => (x + 1) % 1000);
      if (!animating && performance.now() > stopAt) {
        return; // 루프 중단 → 정지
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [data, simKick, animating, layoutMode, repulsionLevel]);

  // 드래그 / 팬 상태는 ref 로 관리 — 전역 mousemove 리스너가 최신 값을 즉시 보도록 (state closure 지연 제거)
  // affected: 드래그 시 함께 움직일 노드 목록. 각각 factor(0~1)로 델타 비례 반영.
  //  - 드래그한 노드 자체: factor 1
  //  - 후손(부모-자식 하위): factor 1 (리지드)
  //  - 조상 체인: factor 0.3 / 0.09 / 0.027 ... (깊이 멀수록 덜 끌림)
  const dragRef = useRef<{
    nodeId: string;
    startCursor: { x: number; y: number };
    affected: Array<{ id: string; x0: number; y0: number; factor: number }>;
    prevCursor?: { x: number; y: number };
    lastDelta?: { dx: number; dy: number };
  } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dr = dragRef.current;
      if (dr) {
        if (dragStartRef.current) {
          const ddx = e.clientX - dragStartRef.current.x;
          const ddy = e.clientY - dragStartRef.current.y;
          if (ddx * ddx + ddy * ddy > 16) dragMovedRef.current = true;
        }
        const rect = containerRef.current!.getBoundingClientRect();
        const cx = (e.clientX - rect.left - pan.x) / zoom;
        const cy = (e.clientY - rect.top - pan.y) / zoom;
        const dx = cx - dr.startCursor.x;
        const dy = cy - dr.startCursor.y;
        // 관성 추적 — 직전 프레임 커서 위치 저장, 마지막 델타를 릴리즈 시 속도로 이월.
        dr.lastDelta = { dx: cx - (dr.prevCursor?.x ?? cx), dy: cy - (dr.prevCursor?.y ?? cy) };
        dr.prevCursor = { x: cx, y: cy };
        for (const a of dr.affected) {
          const n = nodesRef.current.get(a.id);
          if (!n) continue;
          n.x = a.x0 + dx * a.factor;
          n.y = a.y0 + dy * a.factor;
          n.fx = n.x;
          n.fy = n.y;
          // 속도는 유지하지 않고 마지막 델타만 기록 → release 시 관성 이월
        }
        forceTick((i) => i + 1);
        return;
      }
      const ps = panStartRef.current;
      if (ps) {
        setPan({
          x: ps.origX + (e.clientX - ps.x),
          y: ps.origY + (e.clientY - ps.y),
        });
      }
    };
    const onUp = () => {
      const dr = dragRef.current;
      if (dr) {
        // 태양계 모드: 드롭 지점을 "새 궤도" 로 갱신 → 노드가 원위치로 튀지 않고 그 자리에서 계속 돎.
        if (layoutMode === "orbit") {
          const n = nodesRef.current.get(dr.nodeId);
          if (n) {
            const parentId = parentOfRef.current.get(dr.nodeId);
            const t = (performance.now() - orbitStartTimeRef.current) / 1000;
            if (parentId) {
              const pn = nodesRef.current.get(parentId);
              if (pn) {
                const dx = n.x - pn.x, dy = n.y - pn.y;
                const radius = Math.hypot(dx, dy);
                const angle = Math.atan2(dy, dx);
                const prev = orbitParamsRef.current.get(dr.nodeId);
                const omega = prev?.omega ?? 0;
                // 현재 시각 t 에서 angle = baseAngle + omega*t 이도록 baseAngle 역산
                orbitParamsRef.current.set(dr.nodeId, {
                  baseAngle: angle - omega * t,
                  omega,
                  radius,
                });
              }
            } else {
              // 루트 = 은하 중심 기준 재배치
              const cx = 600, cy = 450;
              const dx = n.x - cx, dy = n.y - cy;
              const r = Math.hypot(dx, dy);
              const angle = Math.atan2(dy, dx);
              rootPolarRef.current.set(dr.nodeId, {
                r,
                base: angle - galaxyOmegaRef.current * t,
              });
            }
          }
        }
        // 모든 앵커 해제 + 마지막 드래그 속도를 초기 velocity 로 이월 → 놓는 순간 미끄러지듯 자연스럽게 다음 궤도 / 물리 상태로 전환.
        const vdx = (dr.lastDelta?.dx ?? 0);
        const vdy = (dr.lastDelta?.dy ?? 0);
        for (const a of dr.affected) {
          const nd = nodesRef.current.get(a.id);
          if (!nd) continue;
          nd.fx = null; nd.fy = null;
          nd.vx = vdx * a.factor * 0.7;
          nd.vy = vdy * a.factor * 0.7;
        }
        setSimKick((k) => k + 1);
      }
      dragRef.current = null;
      panStartRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [pan, zoom, layoutMode]);

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

  // 매 렌더마다 최신 Map 스냅샷 — useMemo 로 캐시하면 useEffect 로 뒤늦게 채워진 nodesRef 가 반영 안 됨.
  // 컴포넌트 스코프 parent/children 맵 (필터 확장 + 드래그 체인 계산용)
  const parentOfMap = (() => {
    const m = new Map<string, string>();
    if (!data) return m;
    for (const e of data.edges) if ((e as any).link_type === "parent") m.set(e.target, e.source);
    return m;
  })();

  const nodesAll = Array.from(nodesRef.current.values());
  // 카테고리 필터 적용 — 해당 카테고리의 이슈만 표시. 부모-자식 체인은 필터 이슈에서 확장해 상위까지 포함.
  const visibleIds = (() => {
    if (!categoryFilterId) return null;
    const set = new Set<string>();
    for (const n of data?.nodes ?? []) {
      if (n.category_id === categoryFilterId) set.add(n.id);
    }
    // 가시 노드의 조상 추가(경로 보이도록)
    const extra = new Set<string>();
    for (const id of set) {
      let p = parentOfMap.get(id);
      while (p) { extra.add(p); p = parentOfMap.get(p); }
    }
    for (const e of extra) set.add(e);
    return set;
  })();
  const nodes = visibleIds ? nodesAll.filter((n) => visibleIds.has(n.id)) : nodesAll;
  const allEdges = data?.edges ?? [];
  const edges = visibleIds
    ? allEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
    : allEdges;
  const totalNodes = visibleIds ? nodes.length : (data?.nodes.length ?? 0);

  // 첫 데이터 로드 후 시뮬이 퍼진 뒤 부드럽게 자동 맞춤 (뚝뚝 점프 없이 ease-in-out).
  useEffect(() => {
    if (!data || hasFit || !containerRef.current) return;
    let canceled = false;
    const timer = setTimeout(() => {
      if (canceled) return;
      const ns = Array.from(nodesRef.current.values());
      if (ns.length === 0) return;
      const xs = ns.map((n) => n.x);
      const ys = ns.map((n) => n.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const rect = containerRef.current!.getBoundingClientRect();
      const padding = 80;
      const w = Math.max(100, maxX - minX);
      const h = Math.max(100, maxY - minY);
      const targetZoom = Math.min(
        (rect.width - padding * 2) / w,
        (rect.height - padding * 2) / h,
        1.3,
      );
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const targetPan = {
        x: rect.width / 2 - cx * targetZoom,
        y: rect.height / 2 - cy * targetZoom,
      };
      // 현재 값에서 목표까지 900ms 이징 애니메이션
      const startZoom = zoom;
      const startPan = { ...pan };
      const t0 = performance.now();
      const dur = 1500;
      const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x); // easeInOutSine
      const tick = () => {
        if (canceled) return;
        const p = Math.min(1, (performance.now() - t0) / dur);
        const k = ease(p);
        setZoom(startZoom + (targetZoom - startZoom) * k);
        setPan({
          x: startPan.x + (targetPan.x - startPan.x) * k,
          y: startPan.y + (targetPan.y - startPan.y) * k,
        });
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setHasFit(true);
    }, 1400);
    return () => { canceled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hasFit]);

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
    <div className="relative flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-5 h-10 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          {totalNodes}개 노드 · {edges.length}개 연결
        </span>
        <div className="flex-1" />
        {/* 레이아웃 모드 */}
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          <button
            onClick={() => setLayoutMode("force")}
            className={`px-2.5 py-1 transition-colors ${layoutMode === "force" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40"}`}
          >
            포스
          </button>
          <button
            onClick={() => setLayoutMode("orbit")}
            className={`px-2.5 py-1 border-l border-border transition-colors ${layoutMode === "orbit" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40"}`}
          >
            공전궤도
          </button>
        </div>
        {/* 연결 모드 */}
        <Button
          variant={isConnect ? "default" : "ghost"}
          size="sm"
          onClick={() => { setEditMode(isConnect ? null : "connect"); setPendingSource(null); }}
          className="gap-1"
          title="두 노드 클릭으로 이슈 연결"
        >
          {isConnect ? <X className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
          {isConnect ? "연결 취소" : "연결"}
        </Button>
        <Button
          variant={isDisconnect ? "destructive" : "ghost"}
          size="sm"
          onClick={() => { setEditMode(isDisconnect ? null : "disconnect"); setPendingSource(null); }}
          className="gap-1"
          title="기존 연결선 클릭으로 해제"
        >
          {isDisconnect ? <X className="h-3.5 w-3.5" /> : <Unlink2 className="h-3.5 w-3.5" />}
          {isDisconnect ? "해제 취소" : "해제"}
        </Button>
        <Button
          variant={openPanel === "layer" ? "default" : "ghost"}
          size="sm"
          onClick={() => togglePanel("layer")}
          className="gap-1"
          title="계층(부모-자식 깊이)별 보기"
        >
          <Layers className="h-3.5 w-3.5" />
          계층
        </Button>
        <Button variant="ghost" size="sm" onClick={() => togglePanel("settings")} className="gap-1">
          <Sliders className="h-3.5 w-3.5" />
          {t("graph.view", "뷰")}
        </Button>
        {/* 재정렬 — 드래그로 고정한 노드 모두 풀고 전체 뷰 자동 맞춤 */}
        <Button
          variant="ghost" size="sm"
          onClick={() => {
            // 모든 fx/fy 풀기
            for (const n of nodesRef.current.values()) { n.fx = null; n.fy = null; }
            setHasFit(false);
          }}
          title="고정 해제 + 화면에 맞춰 재정렬"
        >
          재정렬
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => togglePanel("help")}
          className="w-7 h-7 p-0 rounded-full"
          title="그래프 설명 & 단축키"
        >
          ?
        </Button>
      </div>
      {/* 연결 모드 힌트 + 연결 타입(아이콘 버튼) — 100% 불투명 popover */}
      {isConnect && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 rounded-xl bg-popover border border-amber-500/70 text-foreground text-xs px-3 py-2 shadow-xl">
          <div className="font-medium">
            {pendingSource
              ? "두 번째 노드 클릭 → 연결 생성 (Esc: 취소)"
              : "연결할 첫 번째 노드를 클릭하세요"}
          </div>
          <div className="flex items-center gap-1 flex-wrap justify-center">
            {LINK_TYPES.map((lt) => {
              const active = linkType === lt.value;
              const Icon = lt.icon;
              return (
                <button
                  key={lt.value}
                  type="button"
                  onClick={() => setLinkType(lt.value)}
                  title={lt.desc}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                    active
                      ? "bg-amber-500 border-amber-500 text-white font-medium"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {lt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 도움말 패널 — 노드 스타일 / 연결 타입 설명 */}
      {openPanel === "help" && (
        <div className="absolute top-12 right-5 z-30 w-80 rounded-lg border bg-popover shadow-xl p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="font-semibold">그래프 가이드</div>
            <button onClick={() => setOpenPanel(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div>
            <div className="text-muted-foreground font-semibold mb-1.5">노드</div>
            <ul className="space-y-1 pl-1">
              <li className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
                <span>이 프로젝트의 이슈</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-slate-500 border-2 border-amber-400 border-dashed" />
                <span>외부 프로젝트의 이슈 (링크로 연결됨)</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-blue-500 ring-2 ring-pink-400" />
                <span>색 테두리 = 라벨 색</span>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-muted-foreground font-semibold mb-1.5">연결 타입</div>
            <ul className="space-y-2">
              {LINK_TYPES.map((lt) => {
                const Icon = lt.icon;
                return (
                  <li key={lt.value} className="flex items-start gap-2">
                    <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                    <div>
                      <div className="font-medium">{lt.label}</div>
                      <div className="text-muted-foreground">{lt.desc}</div>
                    </div>
                  </li>
                );
              })}
              <li className="flex items-start gap-2 pt-1 border-t border-border">
                <div className="w-3 h-0 border-t-2 border-[#8b5cf6] mt-1.5 shrink-0" />
                <div>
                  <div className="font-medium">부모 → 자식 (보라 화살표)</div>
                  <div className="text-muted-foreground">하위 이슈 관계. 그래프에서 자동으로 표시되며 삭제는 이슈 트리에서.</div>
                </div>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-muted-foreground font-semibold mb-1">조작</div>
            <ul className="space-y-0.5 text-muted-foreground">
              <li>· 드래그: 노드 고정 · 더블클릭: 고정 해제</li>
              <li>· 휠: 줌 · 빈 곳 드래그: 팬</li>
              <li>· 공전궤도 모드에서 중심 노드 드래그 = 자식 전체가 따라 이동</li>
            </ul>
          </div>
        </div>
      )}

      {/* 해제 모드 힌트 — 100% 불투명 */}
      {isDisconnect && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 rounded-full bg-destructive text-destructive-foreground text-xs px-3 py-1.5 shadow-lg font-medium">
          연결선을 클릭하면 해제됩니다 (부모-자식 / 라벨 엣지 제외, Esc: 취소)
        </div>
      )}

      {/* 계층(depth) 패널 */}
      {openPanel === "layer" && (
        <div className="absolute top-12 left-5 z-20 w-56 rounded-lg border bg-popover shadow-lg p-3 space-y-2 text-xs">
          <div className="font-semibold text-muted-foreground">계층(depth)별 보기</div>
          <div className="space-y-1">
            <button
              onClick={() => setFocusedDepth(null)}
              className={`w-full text-left rounded-md px-2 py-1 transition-colors ${
                focusedDepth === null ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50"
              }`}
            >
              전체 보기 · {data?.nodes.length ?? 0}개
            </button>
            {depthCounts.map(([d, c]) => (
              <button
                key={d}
                onClick={() => setFocusedDepth(focusedDepth === d ? null : d)}
                className={`w-full text-left rounded-md px-2 py-1 transition-colors ${
                  focusedDepth === d ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50"
                }`}
              >
                {d === 0 ? "최상위" : `└ 하위 ${d}단계`} · {c}개
              </button>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">선택한 계층만 강조됩니다. 다시 누르면 해제.</p>
        </div>
      )}

      {/* 뷰 설정 팝오버 */}
      {openPanel === "settings" && (
        <div className="absolute top-12 right-5 z-30 w-64 rounded-lg border bg-popover shadow-lg p-4 space-y-3 text-sm">
          <label className="flex items-center justify-between gap-2">
            <span>{t("graph.animation", "애니메이션 모드")}</span>
            <input type="checkbox" checked={animating} onChange={(e) => { setAnimating(e.target.checked); setSimKick((k) => k + 1); }} className="h-4 w-4 accent-primary" />
          </label>
          <p className="text-2xs text-muted-foreground -mt-2">끄면 정적 뷰 모드 — 한 번 자리잡고 멈춥니다.</p>
          <label className="flex items-center justify-between gap-2">
            <span>{t("graph.showIds", "이슈 ID 표시")}</span>
            <input type="checkbox" checked={showIds} onChange={(e) => setShowIds(e.target.checked)} className="h-4 w-4 accent-primary" />
          </label>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span>{t("graph.labelSize", "라벨 크기")}</span>
              <span className="text-xs text-muted-foreground">{labelSize}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={labelSize}
              onChange={(e) => setLabelSize(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-2xs text-muted-foreground mt-1">0 으로 두면 라벨이 숨겨집니다.</p>
          </div>

          {/* 구분선 + 모드별 섹션 */}
          <div className="pt-1">
            <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="shrink-0">포스</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span>{t("graphView.repulsion", "반발력")}</span>
                <span className="text-xs text-muted-foreground">{repulsionLevel}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={repulsionLevel}
                onChange={(e) => setRepulsionLevel(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-2xs text-muted-foreground mt-1">{t("graphView.repulsionHint", "높일수록 노드끼리 밀쳐내며 쫙쫙 퍼집니다.")}</p>
            </div>
          </div>

          <div className="pt-1">
            <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="shrink-0">공전궤도</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span>{t("graph.orbitSpeed", "공전 속도")}</span>
                <span className="text-xs text-muted-foreground">{orbitSpeed}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={200}
                step={10}
                value={orbitSpeed}
                onChange={(e) => setOrbitSpeed(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-2xs text-muted-foreground mt-1">0% 는 정지, 100% 기본, 200% 까지 가속.</p>
            </div>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-gradient-to-br from-muted/20 to-background select-none"
        onWheel={handleWheel}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-graph-node]")) return;
          panStartRef.current = { x: e.clientX, y: e.clientY, origX: pan.x, origY: pan.y };
        }}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && totalNodes === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
            {t("graph.empty", "이 프로젝트에 아직 이슈가 없습니다.")}
          </div>
        )}

        <svg
          className="absolute inset-0 w-full h-full"
          style={{ cursor: "grab" }}
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            <defs>
              <marker id="arrow-parent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 Z" fill="#8b5cf6" />
              </marker>
              <marker id="arrow-blocks" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 Z" fill="#f97316" />
              </marker>
            </defs>
            {/* 은하 중심 — 태양계 모드: 프로젝트 아이콘 + 이름 (카테고리 필터 시 카테고리 함께) */}
            {layoutMode === "orbit" && project && (
              <g transform="translate(600 450)" className="pointer-events-none">
                <circle r={60} fill="hsl(var(--primary) / 0.06)" stroke="hsl(var(--primary) / 0.25)" strokeWidth={1.5} strokeDasharray="4 5" />
                <foreignObject x={-32} y={-48} width={64} height={48}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%", height: "100%" }}>
                    <ProjectIcon value={project.icon_prop as Record<string, unknown> | null | undefined} size={22} />
                    {activeCategory && (
                      <>
                        <span style={{ opacity: 0.45, fontSize: 14, lineHeight: 1 }}>›</span>
                        <ProjectIcon value={activeCategory.icon_prop as Record<string, unknown> | null | undefined} size={22} />
                      </>
                    )}
                  </div>
                </foreignObject>
                <text y={14} textAnchor="middle" fontSize={12}
                  style={{ fill: "currentColor", fontWeight: 700, paintOrder: "stroke", stroke: "var(--background, #fff)", strokeWidth: 3, strokeLinejoin: "round" }}>
                  {(project.name.length > 14 ? project.name.slice(0, 14) + "…" : project.name)}
                </text>
                {activeCategory && (
                  <text y={30} textAnchor="middle" fontSize={11}
                    style={{ fill: "currentColor", fontWeight: 600, opacity: 0.8, paintOrder: "stroke", stroke: "var(--background, #fff)", strokeWidth: 2.5 }}>
                    {activeCategory.name.length > 16 ? activeCategory.name.slice(0, 16) + "…" : activeCategory.name}
                  </text>
                )}
                <text y={activeCategory ? 46 : 30} textAnchor="middle" fontSize={9}
                  style={{ fill: "currentColor", opacity: 0.5, fontWeight: 600, letterSpacing: "0.1em", paintOrder: "stroke", stroke: "var(--background, #fff)", strokeWidth: 2 }}>
                  {project.identifier}
                </text>
              </g>
            )}
            {edges.map((e) => {
              const s = nodesRef.current.get(e.source);
              const tgt = nodesRef.current.get(e.target);
              if (!s || !tgt) return null;
              const lt = (e as any).link_type as string;
              const isParent = lt === "parent";
              const isLabel = lt === "shared_label";
              const isRelates = lt === "relates_to";
              const isBlocks = lt === "blocks" || lt === "blocked_by";
              const isManual = !isParent && !isLabel;
              const dimByDepth = focusedDepth != null && (depthMap.get(e.source) !== focusedDepth && depthMap.get(e.target) !== focusedDepth);
              const hot = isDisconnect && isManual && hoverEdgeId === e.id;

              // blocked_by 는 화살표 방향 뒤집기 — DB 엔트리의 의미 그대로
              const sx = lt === "blocked_by" ? tgt.x : s.x;
              const sy = lt === "blocked_by" ? tgt.y : s.y;
              const ex = lt === "blocked_by" ? s.x   : tgt.x;
              const ey = lt === "blocked_by" ? s.y   : tgt.y;

              // 이중선(연관) — 두 선을 수직 방향으로 소폭 오프셋
              const dx = ex - sx, dy = ey - sy;
              const len = Math.hypot(dx, dy) || 1;
              const ox = (-dy / len) * 2.5;
              const oy = ( dx / len) * 2.5;

              const stroke = hot ? "#ef4444"
                : isParent  ? "#8b5cf6"
                : isBlocks  ? "#f97316"
                : isLabel   ? "#94a3b8"
                : "#64748b";

              return (
                <g key={e.id} opacity={dimByDepth ? 0.1 : 1}>
                  {isRelates ? (
                    (() => {
                      // 양 끝 노드의 상태 색을 끌어다 씀 — 이중선이 자연스레 두 색을 이음.
                      const sColor = s.state_group ? (STATE_COLOR[s.state_group] ?? "#6b7280") : "#6b7280";
                      const tColor = tgt.state_group ? (STATE_COLOR[tgt.state_group] ?? "#6b7280") : "#6b7280";
                      const gradId = `rel-${e.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
                      const gradRev = `${gradId}r`;
                      return (
                        <>
                          <defs>
                            <linearGradient id={gradId} x1={sx} y1={sy} x2={ex} y2={ey} gradientUnits="userSpaceOnUse">
                              <stop offset="0%" stopColor={hot ? "#ef4444" : sColor} />
                              <stop offset="100%" stopColor={hot ? "#ef4444" : tColor} />
                            </linearGradient>
                            <linearGradient id={gradRev} x1={sx} y1={sy} x2={ex} y2={ey} gradientUnits="userSpaceOnUse">
                              <stop offset="0%" stopColor={hot ? "#ef4444" : tColor} />
                              <stop offset="100%" stopColor={hot ? "#ef4444" : sColor} />
                            </linearGradient>
                          </defs>
                          <line x1={sx + ox} y1={sy + oy} x2={ex + ox} y2={ey + oy}
                                stroke={`url(#${gradId})`} strokeWidth={hot ? 3 : 2} opacity={0.9} />
                          <line x1={sx - ox} y1={sy - oy} x2={ex - ox} y2={ey - oy}
                                stroke={`url(#${gradRev})`} strokeWidth={hot ? 3 : 2} opacity={0.9} />
                        </>
                      );
                    })()
                  ) : (
                    <line
                      x1={sx} y1={sy} x2={ex} y2={ey}
                      stroke={stroke}
                      strokeWidth={hot ? 3.5 : isParent ? 2.5 : isBlocks ? 2.5 : 2}
                      strokeDasharray={isLabel ? "4 4" : undefined}
                      opacity={isLabel ? 0.5 : 0.9}
                      markerEnd={isBlocks ? "url(#arrow-blocks)" : undefined}
                    />
                  )}
                  {/* 해제 모드에서만 보이는 투명 히트라인 */}
                  {isDisconnect && isManual && (
                    <line
                      x1={s.x} y1={s.y} x2={tgt.x} y2={tgt.y}
                      stroke="transparent" strokeWidth={12}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHoverEdgeId(e.id)}
                      onMouseLeave={() => setHoverEdgeId((h) => (h === e.id ? null : h))}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        disconnectEdge({ id: e.id, source: e.source, target: e.target, link_type: lt });
                      }}
                    />
                  )}
                </g>
              );
            })}
            {nodes.map((n) => {
              const fill = n.state_group ? STATE_COLOR[n.state_group] ?? "#6b7280" : "#6b7280";
              const isHover = hoverId === n.id;
              const nDepth = depthMap.get(n.id) ?? 0;
              // 깊이별 크기 — 로그 감소로 10계층 넘어도 일정 하한 유지. 상한 20px, 하한 7px.
              const depthR = Math.max(7, Math.min(20, 22 / Math.sqrt(nDepth + 1)));
              const baseR = n.external ? Math.max(7, depthR - 3) : depthR;
              const dim = focusedDepth != null && nDepth !== focusedDepth;
              return (
                <g
                  key={n.id}
                  data-graph-node
                  opacity={dim ? 0.15 : 1}
                  transform={`translate(${n.x} ${n.y})`}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (isConnect || isDisconnect) return;
                    // 영향 노드 계산
                    //  - 태양계 모드: 본인 + 후손(리지드) + 조상 체인(0.3^depth) — 궤도 전체가 함께
                    //  - 포스 모드: 본인만 직접 끌고, 나머지는 엣지 스프링으로 자연스럽게 딸려옴
                    // 드래그 = 잡은 노드만 직접 이동. 나머지(자식/부모/손자)는 엣지 스프링·궤도 리타깃팅으로
                    // "실에 연결된 듯 끌려옴" — 탄성 있게 뒤늦게 따라붙는 느낌.
                    const affected: Array<{ id: string; x0: number; y0: number; factor: number }> = [];
                    affected.push({ id: n.id, x0: n.x, y0: n.y, factor: 1 });
                    // 마우스 좌표 (그래프 공간)
                    const rect = containerRef.current!.getBoundingClientRect();
                    const startCursor = {
                      x: (e.clientX - rect.left - pan.x) / zoom,
                      y: (e.clientY - rect.top - pan.y) / zoom,
                    };
                    dragRef.current = { nodeId: n.id, startCursor, affected };
                    dragMovedRef.current = false;
                    dragStartRef.current = { x: e.clientX, y: e.clientY };
                  }}
                  onClick={(e) => {
                    // 드래그로 이동했다면 클릭(이슈 열기) 억제
                    if (dragMovedRef.current) {
                      e.stopPropagation();
                      dragMovedRef.current = false;
                      return;
                    }
                    if (isConnect) {
                      e.stopPropagation();
                      if (!pendingSource) {
                        setPendingSource(n.id);
                        return;
                      }
                      if (pendingSource === n.id) {
                        setPendingSource(null);
                        return;
                      }
                      // 한 쌍은 하나의 연결만 — 이미 수동 엣지가 있으면 차단
                      const already = edges.some((ed) => {
                        const lt = (ed as any).link_type;
                        if (lt === "parent" || lt === "shared_label") return false;
                        return (
                          (ed.source === pendingSource && ed.target === n.id) ||
                          (ed.source === n.id && ed.target === pendingSource)
                        );
                      });
                      if (already) {
                        toast.error(t("graphView.linkDuplicate", "이미 연결된 쌍입니다 — 기존 연결 해제 후 다시 시도하세요"));
                        setPendingSource(null);
                        return;
                      }
                      createLinkMutation.mutate({ source: pendingSource, target: n.id });
                      setPendingSource(null);
                      return;
                    }
                    openIssue(n.id);
                  }}
                  className="cursor-pointer"
                >
                  {/* Obsidian 스타일 hover glow */}
                  {isHover && (
                    <circle r={baseR + 8} fill={fill} opacity={0.25} />
                  )}
                  {/* 연결 모드 소스 하이라이트 */}
                  {isConnect && pendingSource === n.id && (
                    <circle r={baseR + 6} fill="none" stroke="#f59e0b" strokeWidth={3} opacity={0.9}>
                      <animate attributeName="r" from={baseR + 6} to={baseR + 14} dur="1.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.9" to="0" dur="1.2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle
                    r={baseR}
                    fill={fill}
                    stroke={n.external ? "#fbbf24" : "#ffffff"}
                    strokeWidth={2}
                    strokeDasharray={n.external ? "3 2" : undefined}
                  />
                  {n.labels[0] && (
                    <circle r={baseR + 3} fill="none" stroke={n.labels[0].color} strokeWidth={2} opacity={0.7} />
                  )}
                  <text
                    x={0}
                    y={baseR + Math.max(12, labelSize + 2)}
                    fontSize={labelSize}
                    textAnchor="middle"
                    className="pointer-events-none"
                    style={{ fill: "currentColor", paintOrder: "stroke", stroke: "var(--background, #fff)", strokeWidth: 3, strokeLinejoin: "round" }}
                  >
                    {showIds && n.project_identifier ? `${n.project_identifier}-${n.sequence_id} ` : ""}
                    {n.title.length > 24 ? n.title.slice(0, 24) + "…" : n.title}
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
