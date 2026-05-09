/**
 * 마이 페이지 — 모든 워크스페이스의 본인 데이터 통합 뷰.
 * 탭 4개: 종합 / 캘린더 / 그래프 / 일정.
 * 탭 상태는 URL `?tab=` 쿼리에 영속화.
 */
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { LayoutDashboard, Calendar as CalIcon, Network, ListChecks } from "lucide-react";
import { PageTransition } from "@/components/motion";
import { MySummaryTab } from "./MySummaryTab";
import { MyCalendarTab } from "./MyCalendarTab";
import { MyGraphTab } from "./MyGraphTab";
import { MyScheduleTab } from "./MyScheduleTab";

type Tab = "summary" | "calendar" | "graph" | "schedule";
const TABS: Tab[] = ["summary", "calendar", "graph", "schedule"];

const TAB_META: Record<Tab, { icon: typeof LayoutDashboard; labelKey: string }> = {
  summary:  { icon: LayoutDashboard, labelKey: "me.tabs.summary" },
  calendar: { icon: CalIcon,         labelKey: "me.tabs.calendar" },
  graph:    { icon: Network,         labelKey: "me.tabs.graph" },
  schedule: { icon: ListChecks,      labelKey: "me.tabs.schedule" },
};

export function MyPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "summary") as Tab;

  const setTab = (next: Tab) => {
    const np = new URLSearchParams(params);
    np.set("tab", next);
    setParams(np, { replace: true });
  };

  return (
    <PageTransition className="p-5 sm:p-8 overflow-y-auto h-full">
      <div className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-foreground tracking-tight">
          {t("me.title", "마이 페이지")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("me.subtitle", "모든 워크스페이스의 내 이슈와 일정을 한 곳에서.")}
        </p>
      </div>

      {/* 탭 네비 */}
      <div className="flex gap-1 border-b border-border mb-6 -mx-1 overflow-x-auto">
        {TABS.map((id) => {
          const Icon = TAB_META[id].icon;
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px " +
                (active
                  ? "text-foreground border-primary"
                  : "text-muted-foreground border-transparent hover:text-foreground")
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {t(TAB_META[id].labelKey)}
            </button>
          );
        })}
      </div>

      {/* 탭별 컨텐츠 */}
      {tab === "summary"  && <MySummaryTab />}
      {tab === "calendar" && <MyCalendarTab />}
      {tab === "graph"    && <MyGraphTab />}
      {tab === "schedule" && <MyScheduleTab />}
    </PageTransition>
  );
}
