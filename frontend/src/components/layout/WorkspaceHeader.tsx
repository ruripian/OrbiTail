/**
 * WorkspaceHeader — 좌측 상단 워크스페이스 아이콘 + 이름 + 드롭다운(개인 설정 / 워크스페이스 설정 / 전환).
 *
 * Sidebar (이슈 뷰) 와 DocumentLayout (문서 뷰) 양쪽에서 **동일하게** 사용되도록 단일 컴포넌트로 통일.
 * 변경 시 두 뷰가 즉시 동일하게 반영됨.
 */

import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Layers, Settings, User as UserIcon } from "lucide-react";
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
  const canAccessWorkspaceSettings = Boolean(
    user?.is_superuser || user?.is_workspace_admin,
  );

  /* Phase 3.1 — workspace.brand_color 를 OrbitAvatar 색으로. 캐시는 setAuth/clearAuth 가 비움. */
  const { data: workspace } = useQuery({
    queryKey: ["workspace", workspaceSlug],
    queryFn: () => workspacesApi.get(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const brand = workspace?.brand_color?.trim() || undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-11 w-full items-center gap-3 border-b border-border px-4 hover:bg-accent/50 transition-colors">
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
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => navigate(`/${workspaceSlug}/settings`)}>
          <UserIcon className="h-3.5 w-3.5 mr-2" />
          {t("sidebar.personalSettings")}
        </DropdownMenuItem>
        {canAccessWorkspaceSettings && (
          <DropdownMenuItem onClick={() => navigate(`/${workspaceSlug}/settings/workspace-members`)}>
            <Settings className="h-3.5 w-3.5 mr-2" />
            {t("sidebar.settings")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {/* ?switch=1 쿼리 — 워크스페이스 1개여도 WorkspaceSelectPage 가 자동진입 안 하도록 신호 */}
        <DropdownMenuItem onClick={() => navigate("/?switch=1")}>
          <Layers className="h-3.5 w-3.5 mr-2" />
          {t("sidebar.switchWorkspace")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
