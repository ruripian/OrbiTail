/**
 * WorkspaceHeader — 좌측 상단 워크스페이스 아이콘 + 이름 + 드롭다운(개인 설정 / 워크스페이스 설정 / 전환).
 *
 * Sidebar (이슈 뷰) 와 DocumentLayout (문서 뷰) 양쪽에서 **동일하게** 사용되도록 단일 컴포넌트로 통일.
 * 변경 시 두 뷰가 즉시 동일하게 반영됨.
 */

import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Layers, Settings } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/stores/authStore";
import { workspacesApi } from "@/api/workspaces";
import { OrbitAvatar } from "@/components/ui/orbit-glyph";

export function WorkspaceHeader() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  // 워크스페이스 어드민(어느 워크스페이스든 Admin 이상)만 노출.
  // 슈퍼유저(시스템 관리자)는 시스템 관리 페이지(/admin) 별개 영역.
  const canAccessWorkspaceSettings = Boolean(user?.is_workspace_admin);

  /* Phase 3.1 — workspace.brand_color 를 OrbitAvatar 색으로. 캐시는 setAuth/clearAuth 가 비움. */
  const { data: workspace } = useQuery({
    queryKey: ["workspace", workspaceSlug],
    queryFn: () => workspacesApi.get(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const brand = workspace?.brand_color?.trim() || undefined;

  return (
    /* 이름 영역은 홈으로, 메뉴는 화살표로 — 워크스페이스 이름은 "지금 어디에 있는지" 라서
       누르면 그 워크스페이스 홈으로 가는 게 자연스럽다. 설정/전환은 자주 쓰지 않으므로 화살표에 접어 둔다. */
    <div className="flex h-11 w-full items-center border-b border-border">
      <button
        onClick={() => navigate(`/${workspaceSlug}`)}
        title={t("sidebar.goHome", "홈으로")}
        className="flex flex-1 min-w-0 items-center gap-3 h-full pl-4 pr-2 hover:bg-accent/50 transition-colors"
      >
        {/* Phase 3.1 — 워크스페이스 아바타: 행성 1~3개의 작은 궤도 글리프.
            brand_color 가 설정되어 있으면 그 색, 없으면 currentColor(text-primary) 사용. */}
        <span
          className="shrink-0 text-primary"
          style={brand ? { color: brand } : undefined}
        >
          <OrbitAvatar size={28} planets={1} label={workspaceSlug} />
        </span>
        <div className="flex flex-col min-w-0 text-left">
          <span className="truncate text-sm font-semibold text-sidebar-foreground leading-tight">
            {workspaceSlug}
          </span>
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            title={t("sidebar.workspaceMenu", "워크스페이스 메뉴")}
            aria-label={t("sidebar.workspaceMenu", "워크스페이스 메뉴")}
            className="flex h-full items-center px-2.5 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-accent/50 transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canAccessWorkspaceSettings && (
            <DropdownMenuItem onClick={() => navigate(`/${workspaceSlug}/workspace-settings/members`)}>
              <Settings className="h-3.5 w-3.5 mr-2" />
              {t("sidebar.workspaceSettings", "워크스페이스 설정")}
            </DropdownMenuItem>
          )}
          {canAccessWorkspaceSettings && <DropdownMenuSeparator />}
          {/* ?switch=1 쿼리 — 워크스페이스 1개여도 WorkspaceSelectPage 가 자동진입 안 하도록 신호 */}
          <DropdownMenuItem onClick={() => navigate("/?switch=1")}>
            <Layers className="h-3.5 w-3.5 mr-2" />
            {t("sidebar.switchWorkspace")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
