import { useState } from "react";
import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Ban, Crown, Loader2, MailWarning, Search, ShieldCheck,
  Trash2, UserCheck, UserX,
} from "lucide-react";

import { adminApi, type UserStatusFilter } from "@/api/admin";
import { useAuthStore } from "@/stores/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminUser } from "@/types";

type Tab = UserStatusFilter | "all";

const TABS: Tab[] = ["pending", "approved", "suspended", "superusers", "all"];

export function AdminUsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isSuper = !!currentUser?.is_superuser;

  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");

  const {
    data,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["admin_users", tab, search],
    queryFn: ({ pageParam = 1 }) =>
      adminApi.listUsers({
        status: tab === "all" ? undefined : tab,
        search: search || undefined,
        page: pageParam,
      }),
    getNextPageParam: (lastPage) => {
      if (!lastPage.next) return undefined;
      const url = new URL(lastPage.next);
      return Number(url.searchParams.get("page"));
    },
    initialPageParam: 1,
  });

  const users = data?.pages.flatMap((p) => p.results) ?? [];
  const totalCount = data?.pages[0]?.count ?? 0;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin_users"] });

  const approveMutation = useMutation({
    mutationFn: (id: string) => adminApi.approveUser(id),
    onSuccess: () => { toast.success(t("admin.users.approveSuccess")); invalidate(); },
    onError:   (e: any) => toast.error(e.response?.data?.detail || t("admin.users.approveError")),
  });

  const suspendMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      adminApi.suspendUser(id, value),
    onSuccess: (_data, vars) => {
      toast.success(vars.value ? t("admin.users.suspendSuccess") : t("admin.users.unsuspendSuccess"));
      invalidate();
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || t("admin.users.actionError")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => { toast.success(t("admin.users.deleteSuccess")); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.detail || t("admin.users.actionError")),
  });

  const superuserMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      adminApi.toggleSuperuser(id, value),
    onSuccess: () => { toast.success(t("admin.users.superuserToggled")); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.detail || t("admin.users.actionError")),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold">{t("admin.users.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("admin.users.desc")}</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {TABS.map((v) => (
          <Button
            key={v}
            size="sm"
            variant={tab === v ? "default" : "outline"}
            onClick={() => setTab(v)}
          >
            {t(`admin.users.tab.${v}`)}
          </Button>
        ))}
        <div className="ml-auto relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 w-64"
            placeholder={t("admin.users.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("admin.users.noUsers")}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {t("admin.pagination.showing", { shown: users.length, total: totalCount })}
            </p>
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isSuper={isSuper}
                isSelf={u.id === currentUser?.id}
                onApprove={() => approveMutation.mutate(u.id)}
                onSuspend={(v) => suspendMutation.mutate({ id: u.id, value: v })}
                onDelete={() => {
                  if (confirm(t("admin.users.deleteConfirm", { email: u.email }))) {
                    deleteMutation.mutate(u.id);
                  }
                }}
                onSuperuserToggle={(v) => superuserMutation.mutate({ id: u.id, value: v })}
                busy={
                  approveMutation.isPending ||
                  suspendMutation.isPending ||
                  deleteMutation.isPending ||
                  superuserMutation.isPending
                }
              />
            ))}
            {hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : null}
                  {t("admin.pagination.loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function UserRow({
  user, isSuper, isSelf, onApprove, onSuspend, onDelete, onSuperuserToggle, busy,
}: {
  user:               AdminUser;
  isSuper:            boolean;
  isSelf:             boolean;
  onApprove:          () => void;
  onSuspend:          (value: boolean) => void;
  onDelete:           () => void;
  onSuperuserToggle:  (value: boolean) => void;
  busy:               boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-semibold">
          {user.display_name.charAt(0).toUpperCase()}
        </div>
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-medium leading-none truncate">
            {user.display_name}
            <span className="text-xs text-muted-foreground font-normal ml-2">
              ({user.last_name}{user.first_name})
            </span>
          </p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>

          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {user.is_superuser && (
              <Badge className="gap-1 bg-amber-500/15 text-amber-600 border-amber-500/30 hover:bg-amber-500/15">
                <Crown className="h-3 w-3" /> {t("admin.users.badgeSuperuser")}
              </Badge>
            )}
            {user.is_approved ? (
              <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 gap-1 pl-1">
                <UserCheck className="h-3 w-3" />
                {t("users.statusApproved")}
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 pl-1">
                <ShieldCheck className="h-3 w-3" />
                {t("users.statusPending")}
              </Badge>
            )}
            {!user.is_email_verified && (
              <Badge variant="outline" className="text-destructive border-destructive/30 gap-1 pl-1">
                <MailWarning className="h-3 w-3" />
                {t("users.statusUnverified")}
              </Badge>
            )}
            {user.is_suspended && (
              <Badge variant="outline" className="text-orange-500 border-orange-500/30 gap-1 pl-1">
                <Ban className="h-3 w-3" />
                {t("admin.users.badgeSuspended")}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-4">
        {!user.is_approved && (
          <Button size="sm" onClick={onApprove} disabled={busy || !user.is_email_verified}>
            {t("admin.users.approveBtn")}
          </Button>
        )}
        {isSuper && !isSelf && !user.is_superuser && (
          <>
            {user.is_suspended ? (
              <Button size="sm" variant="outline" onClick={() => onSuspend(false)} disabled={busy}>
                <UserCheck className="h-3.5 w-3.5 mr-1" />
                {t("admin.users.unsuspendBtn")}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => onSuspend(true)} disabled={busy}>
                <Ban className="h-3.5 w-3.5 mr-1" />
                {t("admin.users.suspendBtn")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
              onClick={onDelete}
              disabled={busy}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {isSuper && user.is_superuser && !isSelf && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSuperuserToggle(false)}
            disabled={busy}
          >
            <UserX className="h-3.5 w-3.5 mr-1" />
            {t("admin.users.demoteBtn")}
          </Button>
        )}
      </div>
    </div>
  );
}
