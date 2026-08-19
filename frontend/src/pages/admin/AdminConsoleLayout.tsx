import { NavLink, Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Building2,
  Crown,
  FileStack,
  Gauge,
  Globe,
  ScrollText,
  Users as UsersIcon,
} from "lucide-react";

import { adminApi } from "@/api/admin";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

/**
 * 시스템 관리 콘솔 셸 — 슈퍼유저 전용, 워크스페이스 밖의 최상위 영역(`/admin/*`).
 *
 * 스코프 규칙: 사이드바의 항목은 **항상 시스템 전역**이다. 특정 워크스페이스만 다루는
 * 도구는 워크스페이스 상세(`/admin/workspaces/:slug`) 안으로만 들어간다.
 * 이 규칙이 있어야 "지금 보는 게 전체인지 이 워크스페이스인지" 헷갈리지 않는다.
 */

interface NavItem {
  to:    string;
  label: string;
  icon:  typeof UsersIcon;
  /** 처리 대기 건수 — 0이면 표시하지 않는다. */
  badge?: number;
}

export function AdminConsoleLayout() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const isSuper = !!user?.is_superuser;

  /* 승인 대기 건수는 사이드바 배지로 상시 노출 — 콘솔에 들어온 이유가 대개 이것이다. */
  const { data: overview } = useQuery({
    queryKey: ["admin_overview"],
    queryFn: adminApi.overview,
    enabled: isSuper,
    refetchInterval: 60_000,
  });

  if (!isSuper) return <Navigate to="/" replace />;

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: t("admin.group.status", "현황"),
      items: [{ to: "overview", label: t("admin.nav.overview", "개요"), icon: Gauge }],
    },
    {
      label: t("admin.group.people", "구성원"),
      items: [
        {
          to: "users",
          label: t("admin.nav.users"),
          icon: UsersIcon,
          badge: overview?.users.pending,
        },
        { to: "superusers", label: t("admin.nav.superusers"), icon: Crown },
      ],
    },
    {
      label: t("admin.group.org", "조직"),
      items: [
        { to: "workspaces", label: t("admin.nav.workspaces"), icon: Building2 },
      ],
    },
    {
      label: t("admin.group.content", "콘텐츠"),
      items: [{ to: "content", label: t("admin.nav.content", "첨부 탐색"), icon: FileStack }],
    },
    {
      label: t("admin.group.records", "기록"),
      items: [{ to: "audit", label: t("admin.nav.audit"), icon: ScrollText }],
    },
  ];

  return (
    <div className="flex h-screen bg-background">
      <aside className="w-56 shrink-0 border-r bg-card/40 flex flex-col">
        <div className="px-4 pt-4 pb-3 border-b">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
            <Globe className="h-3 w-3" />
            {t("admin.nav.systemAdmin", "시스템 관리")}
          </div>
          <p className="mt-1 text-sm font-bold">{t("admin.nav.scopeAll", "전체 시스템")}</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {groups.map((group) => (
            <div key={group.label} className="space-y-0.5">
              <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
              {group.items.map(({ to, label, icon: Icon, badge }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{label}</span>
                  {!!badge && (
                    <span className="shrink-0 rounded-full bg-primary/15 text-primary text-2xs font-semibold px-1.5 py-0.5 tabular-nums">
                      {badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* 콘솔은 워크스페이스 밖이라 앱 사이드바가 없다 — 나가는 길을 항상 열어둔다. */}
        <div className="border-t p-2">
          <NavLink
            to="/"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            {t("admin.nav.backToApp", "워크스페이스로 돌아가기")}
          </NavLink>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-wide px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
