/**
 * 문서 스페이스 설정 · 연동 — 연결된 프로젝트와 문서↔이슈 링크 현황.
 *
 * 연결 자체는 이미 있었지만(스페이스는 프로젝트와 1:1, 문서는 이슈와 N:N) 어디서도 한눈에 볼 수 없었다.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, FolderKanban, Link2 } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Skeleton } from "@/components/ui/skeleton";
import { useSpaceSettings } from "./DocumentSpaceSettingsLayout";

export default function SpaceIntegrationPage() {
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
  const docTitle = (id: string) => docs.find((d) => d.id === id)?.title ?? "제목 없음";

  return (
    <div className="max-w-regular space-y-6">
      <div>
        <h1 className="text-lg font-semibold">연동</h1>
        <p className="text-sm text-muted-foreground mt-1">
          이 스페이스가 프로젝트·이슈와 어떻게 이어져 있는지 보여줍니다.
        </p>
      </div>

      <section className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-muted-foreground" />
          연결된 프로젝트
        </h2>
        {space.project ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{space.project_name}</div>
              <div className="text-2xs text-muted-foreground mt-0.5">
                {space.project_identifier} · 이름·아이콘·보관 상태가 프로젝트와 동기화됩니다.
              </div>
            </div>
            <Link
              to={`/${workspaceSlug}/projects/${space.project}/issues`}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              프로젝트 열기
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            독립 스페이스입니다. 프로젝트를 만들면 그 프로젝트 전용 스페이스가 자동으로 생깁니다.
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            문서 ↔ 이슈 링크
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            문서 {linked.length}개에 이슈 {totalLinks}건이 연결돼 있습니다. 연결은 문서 화면에서 추가·해제합니다.
          </p>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded" />)}
          </div>
        ) : linked.length === 0 ? (
          <p className="p-5 text-xs text-muted-foreground">아직 이슈에 연결된 문서가 없습니다.</p>
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
