/**
 * 스프린트 번다운 차트 — 이상(ideal) 라인 vs 실제 잔여 이슈 수
 *
 * Props:
 *   sprint: { start_date, end_date } — 스프린트 기간
 *   issues: Issue[] — 해당 스프린트 이슈
 *   states: State[] — 프로젝트 상태 목록
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Issue, State, Sprint } from "@/types";

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

interface Props {
  sprint: Sprint;
  issues: Issue[];
  states: State[];
}

function daysBetween(a: string, b: string): number {
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function SprintBurndown({ sprint, issues, states }: Props) {
  const { t } = useTranslation();

  const data = useMemo(() => {
    if (!sprint.start_date || !sprint.end_date) return [];

    const total = issues.length;
    if (total === 0) return [];

    const completedStateIds = new Set(
      states.filter((s) => s.group === "completed" || s.group === "cancelled").map((s) => s.id),
    );

    const totalDays = daysBetween(sprint.start_date, sprint.end_date);
    if (totalDays <= 0) return [];

    const today = new Date().toISOString().slice(0, 10);
    const points: { date: string; label: string; ideal: number; actual: number | null }[] = [];

    for (let i = 0; i <= totalDays; i++) {
      const date = addDays(sprint.start_date, i);
      const label = `${parseInt(date.slice(5, 7))}/${parseInt(date.slice(8, 10))}`;
      const ideal = Math.round(total * (1 - i / totalDays));

      // 실제 값은 오늘까지만 표시
      let actual: number | null = null;
      if (date <= today) {
        // 해당 날짜까지 완료된 이슈 수 (updated_at 기준 근사)
        const doneCount = issues.filter((issue) => {
          if (!issue.state || !completedStateIds.has(issue.state)) return false;
          // updated_at이 해당 날짜 이전이면 완료된 것으로 간주
          return issue.updated_at.slice(0, 10) <= date;
        }).length;
        actual = total - doneCount;
      }

      points.push({ date, label, ideal, actual });
    }

    return points;
  }, [sprint, issues, states]);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
        {t("cycles.burndown.noData")}
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4">
      <h3 className="text-sm font-semibold mb-3">{t("cycles.burndown.title")}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            interval={Math.max(0, Math.floor(data.length / 8))}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            allowDecimals={false}
          />
          <Tooltip {...tooltipStyle} />
          <Line
            type="monotone"
            dataKey="ideal"
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="5 5"
            strokeWidth={1.5}
            dot={false}
            name={t("cycles.burndown.ideal")}
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls={false}
            name={t("cycles.burndown.actual")}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
