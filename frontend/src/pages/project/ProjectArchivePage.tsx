import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Archive } from "lucide-react";
import { ArchiveView } from "./views/ArchiveView";
import { IssueDetailPanel } from "./IssueDetailPanel";
import { AnimatePresence } from "framer-motion";
import { useCallback } from "react";

/**
 * PASS4-4 — 프로젝트 보관함 standalone 페이지.
 *
 * 기존에는 ProjectIssuePage 의 ?view=archive 였으나, 일상 작업 view 와 분리하기 위해
 * 사이드바 nav 의 별도 진입점으로 이동. 내부 UI 는 기존 ArchiveView 를 그대로 사용.
 * IssueDetailPanel 통합 패턴은 ProjectIssuePage 와 동일.
 */
export function ProjectArchivePage() {
  const { t } = useTranslation();
  const { workspaceSlug, projectId } = useParams<{ workspaceSlug: string; projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedIssue = searchParams.get("issue");
  const openIssue = useCallback((id: string) => {
    setSearchParams((p) => { p.set("issue", id); return p; }, { replace: false });
  }, [setSearchParams]);
  const closeIssue = useCallback(() => {
    setSearchParams((p) => { p.delete("issue"); return p; }, { replace: false });
  }, [setSearchParams]);

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      <header className="flex items-center gap-2 px-5 h-12 border-b border-border shrink-0">
        <Archive className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">{t("project.nav.archive", "보관함")}</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        <ArchiveView
          workspaceSlug={workspaceSlug!}
          projectId={projectId!}
          onIssueClick={openIssue}
        />
      </div>

      <AnimatePresence>
        {selectedIssue && (
          <IssueDetailPanel key={selectedIssue} issueId={selectedIssue} onClose={closeIssue} />
        )}
      </AnimatePresence>
    </div>
  );
}
