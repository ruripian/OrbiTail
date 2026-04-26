import { NavLink, Navigate, Outlet, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ShieldAlert,
  Users as UsersIcon,
  FolderKanban,
  Crown,
  ScrollText,
  Trash2,
  Paperclip,
  Globe,
} from "lucide-react";

import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

/**
 * 관리자 페이지 공통 레이아웃.
 *
 * 접근 제어:
 *  - 워크스페이스 관리자(어떤 워크스페이스에서든 ADMIN 이상) 또는 슈퍼유저
 *  - 워크스페이스 관리자는 `사용자 관리` 탭만 볼 수 있음
 *  - 슈퍼유저는 모든 탭 접근 가능
 *
 * 경로: /:workspaceSlug/admin/*
 */
export function AdminLayout() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const user = useAuthStore((s) => s.user);
  const base = `/${workspaceSlug}/admin`;

  const isSuper = !!user?.is_superuser;
  const canEnter = isSuper || !!user?.is_workspace_admin;

  if (!canEnter) {
    return <Navigate to={`/${workspaceSlug}/settings/profile`} replace />;
  }

  const tabs = [
    { to: "users",          label: t("admin.nav.users"),        icon: UsersIcon,    show: true },
    { to: "orphan-spaces",  label: "탈퇴자 스페이스",            icon: Trash2,       show: true },
    { to: "attachments",    label: "첨부 검색",                  icon: Paperclip,    show: true },
    { to: "workspaces",     label: t("admin.nav.workspaces"),    icon: FolderKanban, show: isSuper },
    { to: "superusers",     label: t("admin.nav.superusers"),    icon: Crown,        show: isSuper },
    { to: "audit",          label: t("admin.nav.audit"),         icon: ScrollText,   show: isSuper },
  ];

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r bg-background p-4 space-y-1 flex flex-col">
        {/* 헤더 — "시스템 관리(슈퍼어드민)" 라벨로 워크스페이스 설정과 시각적으로 구분.
            슈퍼어드민과 워크스페이스 어드민이 모두 들어올 수 있지만 스코프는 시스템 전역. */}
        <div className="px-2 mb-4 pb-3 border-b">
          <div className={cn(
            "flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest",
            isSuper ? "text-amber-600 dark:text-amber-400" : "text-violet-600 dark:text-violet-400",
          )}>
            {isSuper ? <Globe className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
            {isSuper
              ? t("admin.nav.systemAdmin", "시스템 관리 (슈퍼어드민)")
              : t("admin.nav.adminPanel", "관리자 패널")}
          </div>
          <p className="mt-1 text-sm font-bold truncate">
            {isSuper
              ? t("admin.nav.scopeAll", "전체 시스템")
              : t("admin.nav.scopeWsAdmin", "워크스페이스 어드민 도구")}
          </p>
        </div>
        {tabs.filter((t) => t.show).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={`${base}/${to}`}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
