/**
 * 프로젝트 이슈 통계 차트 — 프로젝트 내부 대시보드용
 * 4개 차트: 상태별 도넛, 우선순위 바, 생성/완료 추이, 담당자 워크로드
 */
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid,
} from "recharts";
import type { IssueStats } from "@/types";

/* 우선순위 → 고정 색상 */
const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#ef4444", high: "#f97316", medium: "#eab308", low: "#3b82f6", none: "#9ca3af",
};

/* 다크모드 대응 Tooltip 스타일 */
const tooltipStyle = {
  contentStyle: {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    fontSize: 12,
    color: "hsl(var(--foreground))",
  },
  itemStyle: { color: "hsl(var(--foreground))" },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};

/* 차트 카드 셸 */
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border glass p-5">
      <h3 className="text-sm font-semibold text-muted-foreground mb-4">{title}</h3>
      {children}
    </div>
  );
}

interface Props {
  stats: IssueStats;
  t: (k: string, o?: Record<string, unknown>) => string;
}

export function StatsCharts({ stats, t }: Props) {
  const priorityData = stats.by_priority.map((p) => ({
    name: t(`issues.priority.${p.priority}`),
    count: p.count,
    fill: PRIORITY_COLOR[p.priority] ?? "#9ca3af",
  }));
  const recentTrend = stats.over_time.slice(-14);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* 상태별 도넛 */}
      <ChartCard title={t("dashboard.charts.byState")}>
        {stats.by_state.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t("dashboard.noIssues")}</p>
        ) : (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={160}>
              <PieChart>
                <Pie data={stats.by_state} dataKey="count" nameKey="state_name" cx="50%" cy="50%" innerRadius={35} outerRadius={62} paddingAngle={2} stroke="hsl(var(--card))">
                  {stats.by_state.map((s) => <Cell key={s.state_id} fill={s.color} />)}
                </Pie>
                <Tooltip {...tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {stats.by_state.map((s) => (
                <div key={s.state_id} className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="flex-1 truncate">{s.state_name}</span>
                  <span className="font-mono text-muted-foreground">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </ChartCard>

      {/* 우선순위 바 */}
      <ChartCard title={t("dashboard.charts.byPriority")}>
        {priorityData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t("dashboard.noIssues")}</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={priorityData} layout="vertical" margin={{ left: 0, right: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} stroke="none">
                {priorityData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 생성/완료 추이 */}
      <ChartCard title={t("dashboard.charts.overTime")}>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={recentTrend} margin={{ left: 0, right: 8, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis width={28} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Line type="monotone" dataKey="created" stroke="#3b82f6" strokeWidth={2} dot={false} name={t("dashboard.charts.created")} />
            <Line type="monotone" dataKey="completed" stroke="#22c55e" strokeWidth={2} dot={false} name={t("dashboard.charts.completed")} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* 담당자 워크로드 */}
      <ChartCard title={t("dashboard.charts.byAssignee")}>
        {stats.by_assignee.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t("dashboard.charts.noAssignees")}</p>
        ) : (
          <div className="space-y-3">
            {stats.by_assignee.slice(0, 5).map((a) => {
              const maxCount = Math.max(...stats.by_assignee.map((x) => x.count));
              const pct = maxCount > 0 ? (a.count / maxCount) * 100 : 0;
              return (
                <div key={a.user_id} className="flex items-center gap-3">
                  <div className="h-7 w-7 rounded-full bg-primary/15 text-xs font-bold flex items-center justify-center text-primary shrink-0">
                    {a.display_name[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm truncate w-24">{a.display_name}</span>
                  <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-mono text-muted-foreground w-8 text-right">{a.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </ChartCard>
    </div>
  );
}
