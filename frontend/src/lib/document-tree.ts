/**
 * 문서 트리 조작 공용 규칙 — 사이드바 트리와 탐색기가 같은 규칙을 쓰도록 한 곳에 모은다.
 *
 * 여기 없으면 "사이드바에서는 막히는 이동이 탐색기에서는 되는" 식으로 두 화면이 갈라진다.
 */
import type { Document } from "@/types";

/** parent id → 자식 목록. 순환 검사와 정렬에 함께 쓴다. */
export function buildChildrenMap(docs: Document[]): Map<string | null, Document[]> {
    const map = new Map<string | null, Document[]>();
    for (const doc of docs) {
        const key = doc.parent ?? null;
        const list = map.get(key);
        if (list) list.push(doc);
        else map.set(key, [doc]);
    }
    return map;
}

/**
 * dragged 를 target 안에 넣으면 순환이 생기는지 — 자기 자신이거나 자손이면 true.
 * 트리가 깊어도 BFS 한 번이면 끝나고, 이미 본 노드는 건너뛰어 손상된 데이터에서도 멈춘다.
 */
export function wouldCreateCycle(
    draggedId: string,
    targetId: string,
    childrenMap: Map<string | null, Document[]>,
): boolean {
    if (draggedId === targetId) return true;
    const queue = [draggedId];
    const visited = new Set<string>();
    while (queue.length > 0) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const kid of childrenMap.get(cur) ?? []) {
            if (kid.id === targetId) return true;
            queue.push(kid.id);
        }
    }
    return false;
}

/**
 * 파일 탐색기식 정렬 — 폴더가 항상 위, 그 안에서 사용자가 드래그한 순서(sort_order).
 * 동점이면 제목순으로 안정화한다.
 */
export function sortExplorerItems(docs: Document[]): Document[] {
    return [...docs].sort((a, b) => {
        if (a.is_folder !== b.is_folder) return a.is_folder ? -1 : 1;
        const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        if (order !== 0) return order;
        return a.title.localeCompare(b.title);
    });
}

/**
 * target 의 앞/뒤에 끼워 넣을 때 쓸 sort_order — 이웃과의 중간값.
 * 전체를 다시 번호 매기지 않아도 순서가 유지된다.
 */
export function calcInsertOrder(
    docs: Document[],
    draggedId: string,
    target: Document,
    position: "before" | "after",
): { parent: string | null; sort_order: number } {
    const parent = target.parent ?? null;
    const siblings = docs
        .filter((d) => (d.parent ?? null) === parent && d.id !== draggedId)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const idx = siblings.findIndex((d) => d.id === target.id);
    const targetOrder = target.sort_order ?? 0;

    if (position === "before") {
        const prev = idx > 0 ? siblings[idx - 1] : null;
        return { parent, sort_order: prev ? ((prev.sort_order ?? 0) + targetOrder) / 2 : targetOrder - 1 };
    }
    const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
    return { parent, sort_order: next ? ((next.sort_order ?? 0) + targetOrder) / 2 : targetOrder + 1 };
}

/** 폴더(또는 최상위) 안 맨 뒤에 놓을 때의 sort_order */
export function calcAppendOrder(docs: Document[], parent: string | null): number {
    const siblings = docs.filter((d) => (d.parent ?? null) === parent);
    if (siblings.length === 0) return 0;
    return Math.max(...siblings.map((d) => d.sort_order ?? 0)) + 1;
}
