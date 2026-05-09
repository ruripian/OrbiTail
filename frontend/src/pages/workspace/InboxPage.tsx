import { useMemo } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, MessageSquare, UserPlus, UserMinus, AtSign, RefreshCw, FilePlus, Reply, Archive, ArchiveRestore } from "lucide-react";
import { notificationsApi } from "@/api/notifications";
import { useIssueDialogStore } from "@/stores/issueDialogStore";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { formatRelative } from "@/utils/date-format";
import { cn } from "@/lib/utils";
import { QUERY_TIERS } from "@/lib/query-defaults";
import type { Notification, NotificationType } from "@/types";

/* PASS10 — Inbox 페이지. 워크스페이스 알림을 today/week/earlier 그룹으로 노출 + 필터.
   archive 액션은 backend Notification 에 archived_at 필드 추가 시 활성화 (현재 frontend-only) */

type Filter = "all" | "unread" | "mentions" | "assigned" | "archived";

const TYPE_ICON: Record<NotificationType, React.ElementType> = {
  mentioned: AtSign,
  issue_assigned: UserPlus,
  issue_unassigned: UserMinus,
  issue_updated: RefreshCw,
  issue_created: FilePlus,
  comment_added: MessageSquare,
  comment_replied: Reply,
};

function classify(n: Notification, now: number): "today" | "week" | "earlier" {
  const t = new Date(n.created_at).getTime();
  const dayMs = 86_400_000;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  if (t >= startOfToday.getTime()) return "today";
  if (t >= now - 7 * dayMs) return "week";
  return "earlier";
}

export function InboxPage() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = (searchParams.get("filter") as Filter | null) ?? "all";

  /* archived 탭은 별도 호출(쿼리 키도 분리)해야 백엔드의 archived=true 필터 사용 가능 */
  const isArchivedTab = filter === "archived";
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications", workspaceSlug, isArchivedTab ? "archived" : "active"],
    queryFn: () => notificationsApi.list(workspaceSlug!, { archived: isArchivedTab }),
    enabled: !!workspaceSlug,
    ...QUERY_TIERS.realtime,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notifications", workspaceSlug] });
    qc.invalidateQueries({ queryKey: ["notifications-unread", workspaceSlug] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markAsRead(workspaceSlug!, id),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(workspaceSlug!),
    onSuccess: invalidate,
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => notificationsApi.archive(workspaceSlug!, id),
    onSuccess: invalidate,
  });
  const unarchiveMut = useMutation({
    mutationFn: (id: string) => notificationsApi.unarchive(workspaceSlug!, id),
    onSuccess: invalidate,
  });

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (filter === "unread") return !n.read;
      if (filter === "mentions") return n.type === "mentioned";
      if (filter === "assigned") return n.type === "issue_assigned";
      /* archived 탭은 백엔드에서 이미 필터됨 — 여기선 통과 */
      return true;
    });
  }, [notifications, filter]);

  const groups = useMemo(() => {
    const now = Date.now();
    const out: Record<"today" | "week" | "earlier", Notification[]> = { today: [], week: [], earlier: [] };
    for (const n of filtered) out[classify(n, now)].push(n);
    return out;
  }, [filtered]);

  const setFilter = (f: Filter) => {
    setSearchParams((p) => { if (f === "all") p.delete("filter"); else p.set("filter", f); return p; });
  };

  const handleClick = (n: Notification) => {
    if (!n.read) markRead.mutate(n.id);
    if (n.issue && n.project_id && workspaceSlug) {
      useIssueDialogStore.getState().openIssue(workspaceSlug, n.project_id, n.issue);
    }
  };

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all",       label: t("inbox.filter.all", "전체") },
    { id: "unread",    label: t("inbox.filter.unread", "읽지 않음") },
    { id: "mentions",  label: t("inbox.filter.mentions", "@언급") },
    { id: "assigned",  label: t("inbox.filter.assigned", "내가 담당") },
    { id: "archived",  label: t("inbox.filter.archived", "보관함") },
  ];

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="p-5 sm:p-8 max-w-3xl mx-auto">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("inbox.title", "인박스")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {unreadCount > 0
              ? t("inbox.unreadSummary", { count: unreadCount, defaultValue: "{{count}}개의 새 알림" })
              : t("inbox.allCaughtUp", "전부 확인했습니다")}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            disabled={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {t("notifications.markAllRead", "모두 읽음")}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1 mb-5 border-b">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              filter === f.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("common.loading", "로딩 중...")}</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-10 w-10" />}
          title={t("empty.notifications.title")}
          description={t("empty.notifications.description")}
        />
      ) : (
        <div className="space-y-6">
          {(["today", "week", "earlier"] as const).map((g) => {
            const items = groups[g];
            if (items.length === 0) return null;
            return (
              <section key={g}>
                <h2 className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-2">
                  {t(`inbox.group.${g}`, g)}
                </h2>
                <ul className="rounded-2xl border bg-card overflow-hidden">
                  {items.map((n) => {
                    const Icon = TYPE_ICON[n.type] ?? Bell;
                    return (
                      <li
                        key={n.id}
                        className={cn(
                          "border-b last:border-0 group flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors",
                          !n.read && !isArchivedTab && "bg-primary/5",
                        )}
                      >
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full shrink-0 mt-2",
                            n.read ? "bg-transparent" : "bg-primary",
                          )}
                          aria-label={n.read ? "읽음" : "읽지 않음"}
                        />
                        <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                        <AvatarInitials
                          name={n.actor_detail?.display_name}
                          avatar={n.actor_detail?.avatar}
                          size="sm"
                        />
                        <button
                          onClick={() => handleClick(n)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <p className="text-sm leading-snug">
                            <span className="font-medium">{n.actor_detail?.display_name}</span>
                            {" "}
                            <span className="text-muted-foreground">{n.message}</span>
                          </p>
                          {n.issue_title && (
                            <p className="text-xs text-muted-foreground/80 truncate mt-0.5">
                              {n.project_identifier && (
                                <span className="font-mono mr-1.5">{n.project_identifier}-{n.issue_sequence_id}</span>
                              )}
                              {n.issue_title}
                            </p>
                          )}
                        </button>
                        <span className="text-2xs text-muted-foreground/70 shrink-0 ml-2 mt-0.5">
                          {formatRelative(n.created_at, t)}
                        </span>
                        {/* Archive / Unarchive 액션 — hover 시에만 표시 */}
                        <button
                          onClick={() => isArchivedTab ? unarchiveMut.mutate(n.id) : archiveMut.mutate(n.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity p-1 rounded hover:bg-muted/60 shrink-0"
                          title={isArchivedTab ? t("inbox.unarchive", "복원") : t("inbox.archive", "보관")}
                        >
                          {isArchivedTab
                            ? <ArchiveRestore className="h-3.5 w-3.5" />
                            : <Archive className="h-3.5 w-3.5" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className="text-2xs text-muted-foreground/60 mt-8 text-center">
        <Link to={`/${workspaceSlug}/settings/preferences`} className="hover:underline">
          {t("inbox.managePreferences", "알림 환경설정 →")}
        </Link>
      </p>
    </div>
  );
}
