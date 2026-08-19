/**
 * 최근 업데이트 모두보기 — 홈 "최근 업데이트" 위젯의 전용 전체 페이지.
 *
 * 위젯은 10개만 노출하고, 이 페이지는 스크롤을 내리면 다음 페이지를 이어 붙인다.
 * 행 렌더는 홈과 동일한 IssueRow 를 재사용해 시각/동작을 통일한다.
 */
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { PageTransition } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { IssueRow } from "./WorkspaceDashboard";

const PAGE_SIZE = 20;

export function RecentIssuesPage() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();

  const query = useInfiniteQuery({
    queryKey: ["recent-issues", workspaceSlug, "all"],
    queryFn: ({ pageParam }) =>
      issuesApi.recentByWorkspace(workspaceSlug!, { page: pageParam, page_size: PAGE_SIZE }),
    getNextPageParam: (lastPage) =>
      lastPage.next ? Number(new URL(lastPage.next).searchParams.get("page")) : undefined,
    initialPageParam: 1,
    enabled: !!workspaceSlug,
  });

  const issues = query.data?.pages.flatMap((page) => page.results) ?? [];
  const total = query.data?.pages[0]?.count ?? 0;

  const sentinelRef = useInfiniteScroll({
    hasNextPage: query.hasNextPage,
    isFetching: query.isFetchingNextPage,
    onLoadMore: () => query.fetchNextPage(),
  });

  return (
    // 부모 <main> 이 overflow-hidden 이라 스크롤 컨테이너는 페이지가 직접 가져야 한다
    <PageTransition className="h-full overflow-y-auto">
      <div className="max-w-regular mx-auto py-6 px-4 sm:px-6">
        <div className="flex items-center gap-3 mb-5">
          <Link
            to={`/${workspaceSlug}`}
            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-semibold">{t("dashboard.recentIssues")}</h1>
          {/* 총 건수 — 목록이 어디까지 있는지 사용자가 모르는 상태를 만들지 않는다 */}
          {issues.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {t("dashboard.showingCount", { shown: issues.length, total })}
            </span>
          )}
        </div>

        {query.isLoading ? (
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
          <>
            <div className="rounded-2xl border border-border bg-card/70 shadow-sm overflow-hidden divide-y divide-border">
              {issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} workspaceSlug={workspaceSlug!} />
              ))}
            </div>

            {query.hasNextPage && (
              <div ref={sentinelRef} className="pt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </PageTransition>
  );
}
