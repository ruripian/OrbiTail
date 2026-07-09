/**
 * 최근 업데이트 모두보기 — 대시보드 우측 "최근 이슈" 위젯의 전용 전체 페이지.
 *
 * 위젯은 10개만 노출하고, 이 페이지는 ?limit 로 더 많이(최대 100) 불러온다.
 * 행 렌더는 대시보드와 동일한 IssueRow 를 재사용해 시각/동작을 통일한다.
 */
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { PageTransition } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { IssueRow } from "./WorkspaceDashboard";

const RECENT_LIMIT = 100;

export function RecentIssuesPage() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ["recent-issues", workspaceSlug, RECENT_LIMIT],
    queryFn: () => issuesApi.recentByWorkspace(workspaceSlug!, { limit: RECENT_LIMIT }),
    enabled: !!workspaceSlug,
  });

  return (
    <PageTransition>
      <div className="max-w-3xl mx-auto py-6 px-4 sm:px-6">
        <div className="flex items-center gap-3 mb-5">
          <Link
            to={`/${workspaceSlug}`}
            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-semibold">{t("dashboard.recentIssues")}</h1>
        </div>

        {isLoading ? (
          <div className="rounded-2xl border border-border p-5 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : issues.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/70 p-12 text-center">
            <p className="text-muted-foreground">{t("dashboard.allClear")}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card/70 shadow-sm overflow-hidden divide-y divide-border">
            {issues.map((issue) => (
              <IssueRow key={issue.id} issue={issue} workspaceSlug={workspaceSlug!} />
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
