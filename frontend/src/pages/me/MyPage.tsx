/**
 * 마이 페이지 — 모든 워크스페이스의 본인 데이터 통합 뷰.
 * 탭 3개: 캘린더 / 그래프 / 종합.
 * 탭 상태는 URL `?tab=` 쿼리에 영속화.
 */
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { LayoutDashboard, Calendar as CalIcon, Network } from "lucide-react";
import { PageTransition } from "@/components/motion";
import { MySummaryTab } from "./MySummaryTab";
import { MyCalendarTab } from "./MyCalendarTab";
import { MyGraphTab } from "./MyGraphTab";

type Tab = "calendar" | "graph" | "summary";
const TABS: Tab[] = ["calendar", "graph", "summary"];

const TAB_META: Record<Tab, { icon: typeof LayoutDashboard; labelKey: string; fallback: string }> = {
  calendar: { icon: CalIcon,         labelKey: "me.tabs.calendar", fallback: "캘린더" },
  graph:    { icon: Network,         labelKey: "me.tabs.graph",    fallback: "그래프" },
  summary:  { icon: LayoutDashboard, labelKey: "me.tabs.summary",  fallback: "종합" },
};

export function MyPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "calendar") as Tab;

  const setTab = (next: Tab) => {
    const np = new URLSearchParams(params);
    np.set("tab", next);
    setParams(np, { replace: true });
  };

  return (
    <PageTransition className="px-3 sm:px-4 py-3 overflow-y-auto h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h1 className="font-display text-xl font-semibold text-foreground tracking-tight">
          {t("me.title", "마이 페이지")}
        </h1>
      </div>

      {/* 탭 네비 */}
      <div className="flex gap-1 border-b border-border mb-3 overflow-x-auto shrink-0">
        {TABS.map((id) => {
          const Icon = TAB_META[id].icon;
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={
                "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px " +
                (active
                  ? "text-foreground border-primary"
                  : "text-muted-foreground border-transparent hover:text-foreground")
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {t(TAB_META[id].labelKey, TAB_META[id].fallback)}
            </button>
          );
        })}
      </div>

      {/* 탭별 컨텐츠 — flex-1 로 남은 공간 모두 차지 */}
      <div className="flex-1 min-h-0">
        {tab === "calendar" && <MyCalendarTab />}
        {tab === "graph"    && <MyGraphTab />}
        {tab === "summary"  && <MySummaryTab />}
      </div>
    </PageTransition>
  );
}
