/** 마이 그래프 탭 — 본인 담당 이슈를 force-layout 그래프로 시각화.
 * 프로젝트 GraphView 와 같은 컴포넌트를 mode="me" 로 재사용한다.
 * 본인 이슈가 아닌 조상은 트리 연결을 위해 external=true 로 반투명 표시.
 */
import { useTranslation } from "react-i18next";
import { GraphView } from "@/pages/project/views/GraphView";

export function MyGraphTab() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 h-[calc(100vh-220px)] flex flex-col">
      <p className="text-xs text-muted-foreground shrink-0">
        {t("me.graph.hint", "내가 담당한 이슈를 force-layout 그래프로 봅니다. 부모 chain 의 외부 이슈는 트리 연결만 유지하기 위해 반투명으로 표시됩니다.")}
      </p>
      <div className="flex-1 min-h-0 rounded-xl border border-border overflow-hidden">
        <GraphView workspaceSlug="" projectId="" mode="me" />
      </div>
    </div>
  );
}
