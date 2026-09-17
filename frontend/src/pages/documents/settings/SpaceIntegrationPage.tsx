/**
 * 문서 스페이스 설정 · 연동 — 연결된 프로젝트와 문서↔이슈 링크 현황.
 *
 * 연결 자체는 이미 있었지만(스페이스는 프로젝트와 1:1, 문서는 이슈와 N:N) 어디서도 한눈에 볼 수 없었다.
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ExternalLink, FolderKanban, Link2 } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Skeleton } from "@/components/ui/skeleton";
import { useSpaceSettings } from "./DocumentSpaceSettingsLayout";

export default function SpaceIntegrationPage() {
  const { t } = useTranslation();
  const { space, workspaceSlug, spaceId } = useSpaceSettings();

  /* 스페이스 전체 문서를 한 번 받아, 문서별 이슈 링크를 모아 현황을 만든다.
     링크 목록 API 가 문서 단위라 스페이스 단위 집계는 여기서 한다. */
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["documents", workspaceSlug, spaceId, "all"],
    queryFn: () => documentsApi.list(workspaceSlug, spaceId, { all: "true" }),
  });

  const documentIds = docs.filter((d) => !d.is_folder).map((d) => d.id);

  const { data: linkGroups = [] } = useQuery({
    queryKey: ["space-issue-links", workspaceSlug, spaceId, documentIds.length],
    queryFn: async () =>
      Promise.all(
        documentIds.map(async (docId) => ({
          docId,
          links: await documentsApi.issues.list(workspaceSlug, spaceId, docId),
        })),
      ),
    enabled: documentIds.length > 0,
  });

  const linked = linkGroups.filter((g) => g.links.length > 0);
  const totalLinks = linked.reduce((sum, g) => sum + g.links.length, 0);
  const docTitle = (id: string) => docs.find((d) => d.id === id)?.title ?? t("documents.untitled");

  return (
    <div className="max-w-regular space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{t("documents.spaceSettings.integration")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("documents.integration.subtitle")}
        </p>
      </div>

      <section className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-muted-foreground" />
          {t("documents.integration.linkedProject")}
        </h2>
        {space.project ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{space.project_name}</div>
              <div className="text-2xs text-muted-foreground mt-0.5">
                {space.project_identifier} · {t("documents.integration.syncNote")}
              </div>
            </div>
            <Link
              to={`/${workspaceSlug}/projects/${space.project}/issues`}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              {t("documents.integration.openProject")}
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("documents.integration.standalone")}
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            {t("documents.integration.docIssueLinks")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("documents.integration.linkCounts", { docs: linked.length, links: totalLinks })}
          </p>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded" />)}
          </div>
        ) : linked.length === 0 ? (
          <p className="p-5 text-xs text-muted-foreground">{t("documents.integration.empty")}</p>
        ) : (
          <ul className="divide-y">
            {linked.map((group) => (
              <li key={group.docId} className="px-5 py-3">
                <Link
                  to={`/${workspaceSlug}/documents/space/${spaceId}/${group.docId}`}
                  className="text-sm hover:text-primary transition-colors"
                >
                  {docTitle(group.docId)}
                </Link>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {group.links.map((link) => (
                    <span
                      key={link.id}
                      className="text-2xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                    >
                      {link.project_identifier}-{link.issue_sequence_id}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
