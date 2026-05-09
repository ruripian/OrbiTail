/** 마이 그래프 탭 — 본인 담당 이슈를 force-layout 그래프로 시각화.
 * 프로젝트 GraphView 와 같은 컴포넌트를 mode="me" 로 재사용한다.
 * 본인 이슈가 아닌 조상은 트리 연결을 위해 external=true 로 반투명 표시.
 */
import { GraphView } from "@/pages/project/views/GraphView";

export function MyGraphTab() {
  return (
    <div className="h-full rounded-md border border-border overflow-hidden">
      <GraphView workspaceSlug="" projectId="" mode="me" />
    </div>
  );
}
