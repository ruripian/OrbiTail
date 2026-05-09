import { useCallback } from "react";
import { useIssueDialogStore } from "@/stores/issueDialogStore";

/**
 * 이슈 클릭 핸들러 — 일반 클릭은 전역 다이얼로그 팝업.
 * Cmd/Ctrl/Shift/middle 클릭은 e.preventDefault 를 하지 않아 Link 의
 * default 동작(브라우저 기본 새 탭 등) 이 그대로 보존된다.
 *
 * 사용: <Link to={url} onClick={(e) => openIssue(e, ws, project, id)}>
 */
export function useOpenIssue() {
  const openIssue = useIssueDialogStore((s) => s.openIssue);
  return useCallback(
    (e: React.MouseEvent, workspaceSlug: string, projectId: string, issueId: string) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      openIssue(workspaceSlug, projectId, issueId);
    },
    [openIssue],
  );
}
