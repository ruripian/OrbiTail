import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { TrashView } from "./views/TrashView";
import { IssueDetailPanel } from "./IssueDetailPanel";
import { AnimatePresence } from "framer-motion";
import { useCallback } from "react";

/**
 * PASS4-4 — 프로젝트 휴지통 standalone 페이지.
 * ProjectArchivePage 와 동일한 패턴.
 */
export function ProjectTrashPage() {
  const { t } = useTranslation();
  const { workspaceSlug, projectId } = useParams<{ workspaceSlug: string; projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedIssue = searchParams.get("issue");
  const closeIssue = useCallback(() => {
    setSearchParams((p) => { p.delete("issue"); return p; }, { replace: false });
  }, [setSearchParams]);

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      <header className="flex items-center gap-2 px-5 h-12 border-b border-border shrink-0">
        <Trash2 className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">{t("project.nav.trash", "휴지통")}</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        <TrashView workspaceSlug={workspaceSlug!} projectId={projectId!} />
      </div>

      <AnimatePresence>
        {selectedIssue && (
          <IssueDetailPanel key={selectedIssue} issueId={selectedIssue} onClose={closeIssue} />
        )}
      </AnimatePresence>
    </div>
  );
}
