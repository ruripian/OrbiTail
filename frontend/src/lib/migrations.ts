/**
 * localStorage 마이그레이션 (PASS5-A).
 *
 * snake_case 키를 dot-notation 으로 통일.
 * orbitail.migrations.v1 플래그로 idempotent — 두 번 호출해도 한 번만 실행된다.
 */

const LEGACY_KEY_MAP: Record<string, string> = {
  orbitail_graph_showIds:       "orbitail.graph.showIds",
  orbitail_graph_labelSize:     "orbitail.graph.labelSize",
  orbitail_graph_animating:     "orbitail.graph.animating",
  orbitail_graph_layout:        "orbitail.graph.layout",
  orbitail_graph_repulsion:     "orbitail.graph.repulsion",
  orbitail_graph_orbitSpeed:    "orbitail.graph.orbitSpeed",
  orbitail_graph_linkType:      "orbitail.graph.linkType",
  orbitail_timeline_col_widths: "orbitail.timeline.colWidths",
};

const FLAG_KEY = "orbitail.migrations.v1";

export function runLocalStorageMigrations(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(FLAG_KEY)) return;

    for (const [oldKey, newKey] of Object.entries(LEGACY_KEY_MAP)) {
      const v = localStorage.getItem(oldKey);
      if (v != null && localStorage.getItem(newKey) == null) {
        localStorage.setItem(newKey, v);
      }
      localStorage.removeItem(oldKey);
    }

    // legacy cohesion → repulsion 변환은 GraphView 가 이미 처리, 여기선 키만 정리
    localStorage.removeItem("orbitail_graph_cohesion");

    localStorage.setItem(FLAG_KEY, "1");
  } catch {
    /* private mode 등 localStorage 접근 불가 — 다음 진입 때 재시도 */
  }
}
