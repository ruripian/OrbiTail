/** 마이 그래프 탭 — 본인 담당 이슈를 force-layout 그래프로 시각화.
 * 프로젝트 GraphView 와 같은 컴포넌트를 mode="me" 로 재사용한다.
 * 본인 이슈가 아닌 조상은 트리 연결을 위해 external=true 로 반투명 표시.
 *
 * ws-scoped — 현재 워크스페이스의 본인 담당 이슈만 표시. 워크스페이스는 별개 공간.
 */
import { useParams } from "react-router-dom";
import { GraphView } from "@/pages/project/views/GraphView";

export function MyGraphTab() {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  return (
    <div className="h-full rounded-md border border-border overflow-hidden">
      <GraphView workspaceSlug={workspaceSlug} projectId="" mode="me" />
    </div>
  );
}
