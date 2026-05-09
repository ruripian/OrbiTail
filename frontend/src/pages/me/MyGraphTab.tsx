/** 마이 그래프 탭 — 본인 이슈를 워크스페이스/프로젝트 단위 노드로 시각화. */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { meApi } from "@/api/me";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityGlyph } from "@/components/ui/priority-glyph";
import { useOpenIssue } from "@/hooks/useOpenIssue";
import type { Issue } from "@/types";

interface ProjectGroup {
  workspaceSlug: string | null;
  workspaceName: string;
  projectId: string;
  projectName: string;
  projectIdentifier: string;
  issues: Issue[];
}

export function MyGraphTab() {
  const { t } = useTranslation();
  const openIssue = useOpenIssue();
  const { data: issues = [], isLoading } = useQuery({
    queryKey: ["me", "issues", "graph"],
    queryFn: () => meApi.issues({ include_completed: true }),
  });

  // 워크스페이스 → 프로젝트 → 이슈 트리 구성
  const wsBuckets = useMemo(() => {
    const wsMap = new Map<string, { name: string; slug: string | null; projects: Map<string, ProjectGroup> }>();
    for (const issue of issues as Issue[]) {
      const wsSlug = issue.workspace_slug ?? "(unknown)";
      const wsName = issue.workspace_name ?? wsSlug;
      if (!wsMap.has(wsSlug)) wsMap.set(wsSlug, { name: wsName, slug: issue.workspace_slug ?? null, projects: new Map() });
      const wsBucket = wsMap.get(wsSlug)!;

      const pId = issue.project ?? "__none__";
      if (!wsBucket.projects.has(pId)) {
        wsBucket.projects.set(pId, {
          workspaceSlug: issue.workspace_slug ?? null,
          workspaceName: wsName,
          projectId: pId,
          projectName: issue.project_name ?? "—",
          projectIdentifier: issue.project_identifier ?? "—",
          issues: [],
        });
      }
      wsBucket.projects.get(pId)!.issues.push(issue);
    }
    return Array.from(wsMap.entries()).map(([slug, b]) => ({
      slug, name: b.name, projects: Array.from(b.projects.values()),
    }));
  }, [issues]);

  if (isLoading) {
    return <Skeleton className="h-96 rounded-xl" />;
  }
  if (wsBuckets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center">
        <p className="text-sm text-muted-foreground">{t("me.graph.empty", "표시할 이슈가 없습니다.")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {wsBuckets.map((ws) => (
        <section key={ws.slug} className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold mb-4">{ws.name}</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {ws.projects.map((p) => (
              <div key={p.projectId} className="rounded-lg border border-border/70 bg-muted/20 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-2xs font-mono font-semibold text-muted-foreground bg-background px-2 py-0.5 rounded-md">
                      {p.projectIdentifier}
                    </span>
                    <span className="text-sm font-medium truncate">{p.projectName}</span>
                  </div>
                  <span className="text-2xs text-muted-foreground tabular-nums shrink-0">{p.issues.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {p.issues.slice(0, 30).map((issue) => {
                    const href = p.workspaceSlug
                      ? `/${p.workspaceSlug}/projects/${p.projectId}/issues?issue=${issue.id}`
                      : "#";
                    const stateColor = issue.state_detail?.color ?? "#9ca3af";
                    return (
                      <Link
                        key={issue.id}
                        to={href}
                        title={issue.title}
                        onClick={(e) => {
                          if (p.workspaceSlug) openIssue(e, p.workspaceSlug, p.projectId, issue.id);
                        }}
                        className="group inline-flex items-center gap-1 max-w-[140px] rounded-full border border-border bg-background px-2 py-1 text-2xs hover:border-primary transition-colors"
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: stateColor }} />
                        <PriorityGlyph priority={issue.priority} size={8} />
                        <span className="truncate">{issue.title}</span>
                      </Link>
                    );
                  })}
                  {p.issues.length > 30 && (
                    <span className="text-2xs text-muted-foreground px-2 py-1">+{p.issues.length - 30}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
