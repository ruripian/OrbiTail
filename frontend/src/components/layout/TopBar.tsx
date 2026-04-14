import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Settings, LogOut, User, Sun, Moon, Bell, CheckCheck, MessageSquare, UserPlus, RefreshCw, Menu, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";
import { useMotion } from "@/lib/motion-provider";
import { useAuthStore } from "@/stores/authStore";
import { useTheme } from "@/lib/theme-provider";
import { api } from "@/lib/axios";
import { notificationsApi } from "@/api/notifications";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandSearchDialog } from "@/components/search/CommandSearchDialog";
import type { Notification, NotificationType } from "@/types";

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { theme, setTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const qc = useQueryClient();
  const { isRich } = useMotion();

  /* 알림 미읽음 수 — 30초마다 polling */
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications-unread", workspaceSlug],
    queryFn: () => notificationsApi.unreadCount(workspaceSlug!),
    enabled: !!workspaceSlug,
    refetchInterval: 30_000,
  });

  /* 알림 목록 — 드롭다운 열 때 fetch */
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", workspaceSlug],
    queryFn: () => notificationsApi.list(workspaceSlug!),
    enabled: !!workspaceSlug,
    refetchInterval: 30_000,
  });

  /* 개별 읽음 처리 */
  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markAsRead(workspaceSlug!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["notifications-unread", workspaceSlug] });
    },
  });

  /* 전체 읽음 처리 */
  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(workspaceSlug!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["notifications-unread", workspaceSlug] });
    },
  });

  /* 알림 클릭 → 해당 이슈로 이동 + 읽음 처리 */
  const handleNotificationClick = useCallback((n: Notification) => {
    if (!n.read) markReadMutation.mutate(n.id);
    if (n.project_id && n.issue) {
      navigate(`/${workspaceSlug}/projects/${n.project_id}/issues?issue=${n.issue}`);
    }
  }, [workspaceSlug, navigate, markReadMutation]);

  // Cmd+K / Ctrl+K 글로벌 단축키
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleLogout = async () => {
    try {
      const refresh = localStorage.getItem("refresh_token");
      if (refresh) await api.post("/auth/logout/", { refresh });
    } catch {
      // 실패해도 로컬 상태는 정리
    } finally {
      clearAuth();
      navigate("/auth/login", { replace: true });
    }
  };

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border glass-sidebar px-3 sm:px-5 gap-2 sm:gap-4">

      {/* 모바일 햄버거 메뉴 */}
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-accent text-muted-foreground transition-colors lg:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu size={20} />
        </button>
      )}

      {/* 검색창 — 클릭 시 검색 다이얼로그 열기 */}
      <div
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2.5 rounded-xl border bg-muted/30 px-4 h-9 text-sm text-muted-foreground w-auto sm:w-72 flex-1 sm:flex-none cursor-pointer hover:bg-muted/50 hover:border-border transition-all duration-150 group"
      >
        <Search className="h-4.5 w-4.5 shrink-0 group-hover:text-foreground transition-colors" />
        <span className="group-hover:text-foreground/70 transition-colors">{t("topbar.search")}</span>
      </div>

      {/* 전역 검색 다이얼로그 */}
      <CommandSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />

      {/* 우측 패널 — 알림 + 테마 토글 + 프로필 */}
      <div className="flex items-center gap-2">
        {/* 알림 벨 */}
        {workspaceSlug && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative flex h-9 w-9 items-center justify-center rounded-xl hover:bg-accent text-muted-foreground transition-colors outline-none" aria-label={t("notifications.title")}>
                <Bell size={18} />
                {unreadCount > 0 && (
                  isRich ? (
                    <motion.span
                      key={unreadCount}
                      className="absolute -top-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rotate-45 rounded-[2px] bg-gradient-to-br from-amber-500 to-amber-600 shadow-[0_2px_8px_rgba(229,168,0,0.5)]"
                      initial={{ scale: 0 }}
                      animate={{ scale: [0, 1.3, 1] }}
                      transition={{ type: "spring", stiffness: 500, damping: 20 }}
                    >
                      <span className="-rotate-45 text-3xs font-extrabold text-amber-950">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    </motion.span>
                  ) : (
                    <span className="absolute -top-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rotate-45 rounded-[2px] bg-gradient-to-br from-amber-500 to-amber-600 shadow-[0_2px_8px_rgba(229,168,0,0.5)]">
                      <span className="-rotate-45 text-3xs font-extrabold text-amber-950">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    </span>
                  )
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 rounded-xl p-0">
              {/* 알림 헤더 */}
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <span className="text-sm font-semibold">{t("notifications.title")}</span>
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllReadMutation.mutate()}
                    className="inline-flex items-center gap-1 text-2xs text-primary hover:underline"
                  >
                    <CheckCheck className="h-3 w-3" />
                    {t("notifications.markAllRead")}
                  </button>
                )}
              </div>

              {/* 알림 목록 */}
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Bell className="h-8 w-8 mb-2 opacity-30" />
                    <p className="text-xs">{t("notifications.empty")}</p>
                  </div>
                ) : (
                  notifications.slice(0, 20).map((n: Notification) => (
                    <div
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border last:border-0",
                        !n.read && "bg-primary/5"
                      )}
                    >
                      {/* 알림 타입 아이콘 */}
                      <div className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5",
                        !n.read ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                      )}>
                        <NotificationIcon type={n.type} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-xs leading-relaxed", !n.read ? "text-foreground" : "text-muted-foreground")}>
                          {n.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {n.project_identifier && n.issue_sequence_id && (
                            <span className="text-2xs font-mono text-muted-foreground">
                              {n.project_identifier}-{n.issue_sequence_id}
                            </span>
                          )}
                          <span className="text-2xs text-muted-foreground">
                            {formatTimeAgo(n.created_at, t)}
                          </span>
                        </div>
                      </div>
                      {/* 미읽음 인디케이터 */}
                      {!n.read && (
                        <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-2" />
                      )}
                    </div>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-accent text-muted-foreground transition-colors outline-none"
          aria-label="Toggle theme"
        >
          {/* 현재 테마 상태를 나타냄 — 다크면 달, 라이트면 해. 클릭 시 반대로 전환 */}
          {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 rounded-xl px-3 py-1.5 hover:bg-accent transition-all duration-150 outline-none group">
                {/* 아바타 */}
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/20 text-sm font-bold text-primary ring-2 ring-primary/20 group-hover:ring-primary/40 transition-all">
                  {user.display_name[0].toUpperCase()}
                </div>
                {/* 표시 이름 */}
                <div className="hidden sm:flex flex-col items-start">
                  <span className="text-xs text-foreground font-semibold leading-tight">
                    {user.display_name}
                  </span>
                  <span className="text-2xs text-muted-foreground leading-tight">
                    {user.email}
                  </span>
                </div>
                <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground ml-1 hidden sm:block" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
              {/* 유저 정보 헤더 */}
              <DropdownMenuLabel className="font-normal px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 text-sm font-bold text-primary ring-2 ring-primary/20 shrink-0">
                    {user.display_name[0].toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-foreground truncate">{user.display_name}</span>
                    <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator className="my-1" />

              <DropdownMenuItem
                onClick={() => navigate(`/${workspaceSlug}/settings/profile`)}
                className="cursor-pointer rounded-lg gap-2.5 px-3 py-2"
              >
                <User className="h-4 w-4" />
                {t("topbar.profileSettings")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate(`/${workspaceSlug}/settings/preferences`)}
                className="cursor-pointer rounded-lg gap-2.5 px-3 py-2"
              >
                <Settings className="h-4 w-4" />
                {t("topbar.preferences")}
              </DropdownMenuItem>

              {(user.is_superuser || user.is_workspace_admin) && (
                <>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuItem
                    onClick={() => navigate(`/${workspaceSlug}/admin/users`)}
                    className="cursor-pointer rounded-lg gap-2.5 px-3 py-2"
                  >
                    <ShieldAlert className="h-4 w-4" />
                    {t("topbar.adminPanel")}
                  </DropdownMenuItem>
                </>
              )}

              <DropdownMenuSeparator className="my-1" />

              <DropdownMenuItem
                onClick={handleLogout}
                className="cursor-pointer rounded-lg gap-2.5 px-3 py-2 text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                {t("topbar.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

/* ──────────────── 알림 타입별 아이콘 ──────────────── */

function NotificationIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case "issue_assigned": return <UserPlus className="h-3.5 w-3.5" />;
    case "comment_added":  return <MessageSquare className="h-3.5 w-3.5" />;
    case "issue_updated":  return <RefreshCw className="h-3.5 w-3.5" />;
    case "mentioned":      return <User className="h-3.5 w-3.5" />;
    default:               return <Bell className="h-3.5 w-3.5" />;
  }
}

/* ──────────────── 상대 시간 포맷 ──────────────── */

function formatTimeAgo(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("dashboard.justNow");
  if (mins < 60) return t("dashboard.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("dashboard.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("dashboard.daysAgo", { count: days });
}

/* 인라인 아이콘 — import 없이 */
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
