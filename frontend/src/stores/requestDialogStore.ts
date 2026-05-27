/**
 * 전역 요청(IssueRequest) 상세 다이얼로그 store.
 *
 * 행 클릭 / deeplink (?req=<id>) 어느 쪽에서든 동일한 진입점.
 * - openRequest(req)            — list에서 받은 IssueRequest 객체를 통째로 넘김
 * - close()                     — URL 동기화는 호출부(RequestSubmitPage)가 담당
 * - approved_issue 가 있는 항목은 다이얼로그 안의 [이슈 보기] 버튼이 useIssueDialogStore.openIssue 로 위임
 *
 * 패턴: stores/issueDialogStore 와 동일한 zustand 단일 store. 콜백/액션은
 * 보관하지 않고, 액션은 다이얼로그 컴포넌트 내부의 nested dialog 로 처리.
 */
import { create } from "zustand";
import type { IssueRequest } from "@/types";

interface RequestDialogState {
  /** 현재 열려있는 요청 — null 이면 다이얼로그 닫힘. */
  current: IssueRequest | null;
  /** 페이지(workspaceSlug, projectId) 컨텍스트 — mutation 호출에 필요. */
  context: { workspaceSlug: string; projectId: string } | null;
  openRequest: (req: IssueRequest, ctx: { workspaceSlug: string; projectId: string }) => void;
  close: () => void;
}

export const useRequestDialogStore = create<RequestDialogState>((set) => ({
  current: null,
  context: null,
  openRequest: (req, ctx) => set({ current: req, context: ctx }),
  close: () => set({ current: null, context: null }),
}));
