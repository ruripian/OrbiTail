import { useState, useCallback, useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SponsorButton } from "./SponsorButton";
import { useWorkspaceColors } from "@/hooks/useWorkspaceColors";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useUndoStore } from "@/stores/undoStore";
import { Z_SIDEBAR_OVERLAY, Z_SIDEBAR } from "@/constants/z-index";

export function AppLayout() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const isDesktop = useIsDesktop();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 워크스페이스 색상 설정을 CSS 변수로 주입 (priority_colors)
  useWorkspaceColors();

  // WebSocket 실시간 업데이트 — 워크스페이스별 연결
  const wsStatus = useWebSocket(workspaceSlug);

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
        <Sidebar wsStatus={wsStatus} />
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
            className={`fixed inset-y-0 left-0 transform transition-transform duration-200 ease-out ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
            style={{ zIndex: Z_SIDEBAR }}
          >
            <Sidebar onNavigate={closeSidebar} wsStatus={wsStatus} />
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
    </div>
  );
}
