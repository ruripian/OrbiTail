import { useState, useCallback, useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SponsorButton } from "./SponsorButton";
import { authApi } from "@/api/auth";
import { workspacesApi } from "@/api/workspaces";
import { useAuthStore } from "@/stores/authStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceColors } from "@/hooks/useWorkspaceColors";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useUndoStore } from "@/stores/undoStore";
import { Z_SIDEBAR_OVERLAY, Z_SIDEBAR } from "@/constants/z-index";
import { GlobalIssueDialog } from "@/components/issues/GlobalIssueDialog";
import { RequestDialog } from "@/components/requests/RequestDialog";

export function AppLayout() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const isDesktop = useIsDesktop();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 워크스페이스 색상 설정을 CSS 변수로 주입 (priority_colors)
  useWorkspaceColors();

  // WebSocket 실시간 업데이트 — 워크스페이스별 연결. 반환된 상태는 현재 UI에서 사용 안 함.
  useWebSocket(workspaceSlug);

  /* 앱 진입 시 /me/ 를 한 번 갱신 — 백엔드에서 새로 추가된 플래그
     (is_superuser, is_workspace_admin, is_suspended 등) 를 기존 세션에 주입 */
  const updateUser = useAuthStore((s) => s.updateUser);
  useEffect(() => {
    authApi
      .me()
      .then((u) => updateUser(u))
      .catch(() => { /* 401 등은 axios 인터셉터가 처리 */ });
  }, [updateUser]);

  /* URL 의 workspaceSlug 를 진실의 원천으로 삼아 workspaceStore.currentWorkspace 를 동기화.
     로그인 후 자동 리다이렉트(WorkspaceSelectPage) 가 "최근 워크스페이스"를 currentWorkspace 로 판단하므로,
     선택 페이지/생성 페이지 외 진입 경로(URL 직접 입력, 북마크, 외부 링크 등) 에서도 이 값이 갱신되어야 함. */
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const currentWorkspaceSlug = useWorkspaceStore((s) => s.currentWorkspace?.slug);
  const { data: workspacesData } = useQuery({
    queryKey: ["workspaces"],
    queryFn: workspacesApi.list,
  });
  useEffect(() => {
    if (!workspaceSlug || !workspacesData) return;
    if (currentWorkspaceSlug === workspaceSlug) return;
    const matched = workspacesData.find((w) => w.slug === workspaceSlug);
    if (matched) setCurrentWorkspace(matched);
  }, [workspaceSlug, workspacesData, currentWorkspaceSlug, setCurrentWorkspace]);

  /* 글로벌 Undo 단축키 — Cmd/Ctrl+Z. input/textarea/contenteditable 안에서는 무시. */
  const popUndo = useUndoStore((s) => s.popAndRun);
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      e.preventDefault();
      const entry = await popUndo();
      if (entry) toast.success(`되돌림: ${entry.label}`);
      else toast.message("되돌릴 작업이 없습니다");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [popUndo]);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="flex h-screen overflow-hidden relative">
      {isDesktop ? (
        <Sidebar />
      ) : (
        <>
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50"
              style={{ zIndex: Z_SIDEBAR_OVERLAY }}
              onClick={closeSidebar}
            />
          )}
          <div
            className={`fixed inset-y-0 left-0 transform transition-transform duration-base ease-out ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
            style={{ zIndex: Z_SIDEBAR }}
          >
            <Sidebar onNavigate={closeSidebar} />
          </div>
        </>
      )}

      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar onMenuClick={!isDesktop ? toggleSidebar : undefined} />
        <main className="flex-1 overflow-hidden bg-background">
          <Outlet />
        </main>
      </div>
      <SponsorButton />
      <GlobalIssueDialog />
      <RequestDialog />
    </div>
  );
}
