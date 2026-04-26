import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SprintView } from "./SprintView";
import { AnalyticsView } from "./AnalyticsView";

/**
 * PASS4-2 — Reports view: 기존 Sprint + Analytics 를 한 페이지 안 두 탭으로 통합.
 *  - "current"  : SprintView (active sprint burndown + 이슈 목록)
 *  - "history"  : AnalyticsView (전체 통계 차트)
 *
 * shadcn Tabs 의존성 추가하지 않고 내부 segmented control 로 처리.
 */
interface Props {
  workspaceSlug: string;
  projectId:     string;
  onIssueClick?: (issueId: string) => void;
}

type Tab = "current" | "history";

export function ReportsView({ workspaceSlug, projectId, onIssueClick }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("current");

  const TABS: { id: Tab; label: string }[] = [
    { id: "current", label: t("views.reports.current", "현재 스프린트") },
    { id: "history", label: t("views.reports.history", "히스토리") },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 sm:px-6 pt-4 shrink-0">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
          {TABS.map((o) => {
            const active = tab === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setTab(o.id)}
                className={cn(
                  "rounded-md px-4 py-1 text-xs font-medium transition-all duration-fast",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "current" ? (
          <SprintView workspaceSlug={workspaceSlug} projectId={projectId} onIssueClick={onIssueClick ?? (() => {})} />
        ) : (
          <AnalyticsView workspaceSlug={workspaceSlug} projectId={projectId} />
        )}
      </div>
    </div>
  );
}
