/**
 * WorkspaceHeader — 좌측 상단 워크스페이스 아이콘 + 이름 + 드롭다운(개인 설정 / 워크스페이스 설정 / 전환).
 *
 * Sidebar (이슈 뷰) 와 DocumentLayout (문서 뷰) 양쪽에서 **동일하게** 사용되도록 단일 컴포넌트로 통일.
 * 변경 시 두 뷰가 즉시 동일하게 반영됨.
 */

import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, Layers, Settings, User as UserIcon } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/stores/authStore";

export function WorkspaceHeader() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canAccessWorkspaceSettings = Boolean(
    user?.is_superuser || user?.is_workspace_admin,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-11 w-full items-center gap-3 border-b border-border px-4 hover:bg-accent/50 transition-colors">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-black text-primary-foreground shadow-sm">
            ∞
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
        <DropdownMenuItem onClick={() => navigate("/workspaces")}>
          <Layers className="h-3.5 w-3.5 mr-2" />
          {t("sidebar.switchWorkspace")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
