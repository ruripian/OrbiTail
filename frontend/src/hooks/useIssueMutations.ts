/**
 * 이슈 CRUD 후 캐시 갱신을 한곳에서 관리하는 훅
 * — 어떤 뷰(Table, Board, Calendar, Timeline, Detail)에서든 동일한 갱신 보장
 *
 * staleTime(60s)과 무관하게 refetchQueries로 즉시 갱신하므로
 * 생성/삭제/수정 후 UI가 항상 최신 상태를 반영한다.
 */
import { useQueryClient } from "@tanstack/react-query";

export function useIssueRefresh(workspaceSlug: string, projectId: string) {
  const qc = useQueryClient();

  /**
   * 이슈 관련 모든 캐시를 즉시 갱신
   * @param parentId - 하위 이슈 변경 시 부모 ID 전달 → sub-issues 캐시도 갱신
   */
  const refresh = async (parentId?: string | null) => {
    await Promise.all([
      // issues 캐시 — prefix 매칭으로 issueFilter, "with-sub" 변형 모두 포함
      qc.refetchQueries({ queryKey: ["issues", workspaceSlug, projectId] }),
      // 하위 이슈 캐시
      parentId
        ? qc.refetchQueries({ queryKey: ["sub-issues", parentId] })
        : Promise.resolve(),
    ]);
    // 사이드바/홈 등 보조 캐시 — await 불필요 (백그라운드 갱신)
    qc.invalidateQueries({ queryKey: ["my-issues", workspaceSlug] });
    qc.invalidateQueries({ queryKey: ["recent-issues", workspaceSlug] });
    qc.invalidateQueries({ queryKey: ["categories", workspaceSlug, projectId] });
  };

  /** 보관 처리 시 추가 캐시 갱신 */
  const refreshWithArchive = async (parentId?: string | null) => {
    await refresh(parentId);
    qc.invalidateQueries({ queryKey: ["issues-archive", workspaceSlug, projectId] });
  };

  /** 단일 이슈 상세 캐시 갱신 */
  const refreshIssue = (issueId: string) => {
    qc.invalidateQueries({ queryKey: ["issue", issueId] });
    qc.invalidateQueries({ queryKey: ["activities", issueId] });
  };

  return { refresh, refreshWithArchive, refreshIssue };
}
