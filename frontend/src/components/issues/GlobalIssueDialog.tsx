/**
 * 전역 이슈 상세 다이얼로그.
 *
 * useIssueDialogStore 의 current 값이 채워지면 IssueDetailPanel 을 띄움.
 * AppLayout 에서 한 번만 마운트되며, 문서/대시보드/검색 등 어디서든
 * openIssue() 만 호출하면 모달이 뜬다.
 */

import { useIssueDialogStore } from "@/stores/issueDialogStore";
import { IssueDetailPanel } from "@/pages/project/IssueDetailPanel";

export function GlobalIssueDialog() {
  const current = useIssueDialogStore((s) => s.current);
  const close = useIssueDialogStore((s) => s.close);

  if (!current) return null;

  return (
    <IssueDetailPanel
      key={`${current.projectId}:${current.issueId}`}
      workspaceSlug={current.workspaceSlug}
      projectId={current.projectId}
      issueId={current.issueId}
      onClose={close}
    />
  );
}
