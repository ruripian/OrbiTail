import { useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { PriorityColors } from "@/types";

/**
 * 현재 워크스페이스의 priority_colors 설정을 CSS 변수로 주입한다.
 *
 * - 워크스페이스가 없거나 priority_colors가 빈 객체면 tokens.css 기본값을 그대로 사용
 * - 워크스페이스가 바뀌면 자동으로 재적용
 * - 컴포넌트는 var(--priority-high) 또는 Tailwind의 text-priority-high 클래스만 쓰면 됨
 */
export function useWorkspaceColors() {
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);

  useEffect(() => {
    const colors: PriorityColors = currentWorkspace?.priority_colors ?? {};
    const keys = ["urgent", "high", "medium", "low", "none"] as const;

    keys.forEach((key) => {
      const value = colors[key];
      if (value) {
        // 워크스페이스 커스텀 색상 적용
        document.documentElement.style.setProperty(`--priority-${key}`, value);
      } else {
        // 커스텀 값 없으면 인라인 스타일 제거 → tokens.css 기본값 복원
        document.documentElement.style.removeProperty(`--priority-${key}`);
      }
    });

    // Phase 2.3 / F6 — workspace.brand_color 를 보조 액센트로 노출.
    // 컴포넌트는 var(--workspace-brand) 로 참조 가능. 미설정 시 var(--accent) fallback.
    const brand = currentWorkspace?.brand_color?.trim();
    if (brand) {
      document.documentElement.style.setProperty("--workspace-brand", brand);
    } else {
      document.documentElement.style.removeProperty("--workspace-brand");
    }
  }, [currentWorkspace]);
}
