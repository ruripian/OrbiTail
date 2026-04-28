/**
 * 전역 이슈 상세 다이얼로그 store.
 *
 * 문서/대시보드/검색 등 어디서든 이슈를 모달로 열기 위한 단일 진입점.
 * - openIssue(workspaceSlug, projectId, issueId) 로 모달을 띄움
 * - 라우팅 없이 띄우므로 현재 페이지 컨텍스트(문서, 다른 프로젝트)를 잃지 않음
 * - Cmd/Ctrl 클릭 등으로 새 탭에서 페이지로 열고 싶다면 호출부에서 modifier 키를 검사해 분기
 */

import { create } from "zustand";

interface IssueDialogTarget {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
}

interface IssueDialogState {
  current: IssueDialogTarget | null;
  openIssue: (workspaceSlug: string, projectId: string, issueId: string) => void;
  close: () => void;
}

export const useIssueDialogStore = create<IssueDialogState>((set) => ({
  current: null,
  openIssue: (workspaceSlug, projectId, issueId) =>
    set({ current: { workspaceSlug, projectId, issueId } }),
  close: () => set({ current: null }),
}));
