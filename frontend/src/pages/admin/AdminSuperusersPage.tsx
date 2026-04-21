import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Crown, Loader2, Search, UserPlus, UserX } from "lucide-react";

import { adminApi } from "@/api/admin";
import { useAuthStore } from "@/stores/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserPicker } from "./UserPicker";

export function AdminSuperusersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  if (!currentUser?.is_superuser) {
    return <p className="text-sm text-muted-foreground">{t("admin.common.superOnly")}</p>;
  }

  const [pickerValue, setPickerValue] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: superusers = [], isLoading } = useQuery({
    queryKey: ["admin_users", "superusers", search],
    queryFn: () =>
      adminApi.listUsers({ status: "superusers", search: search || undefined }).then((r) => r.results),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin_users"] });

  const promote = useMutation({
    mutationFn: (id: string) => adminApi.toggleSuperuser(id, true),
    onSuccess: () => {
      toast.success(t("admin.superusers.promoteSuccess"));
      setPickerValue(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || t("admin.common.error")),
  });

  const demote = useMutation({
    mutationFn: (id: string) => adminApi.toggleSuperuser(id, false),
    onSuccess: () => { toast.success(t("admin.superusers.demoteSuccess")); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.detail || t("admin.common.error")),
  });

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold">{t("admin.superusers.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("admin.superusers.desc")}</p>
      </div>

      {/* ─── 승격 ─── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("admin.superusers.promoteSection")}</h2>
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <UserPicker value={pickerValue} onChange={setPickerValue} />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!pickerValue || promote.isPending}
              onClick={() => pickerValue && promote.mutate(pickerValue)}
            >
              {promote.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-1" />
                  {t("admin.superusers.promoteBtn")}
                </>
              )}
            </Button>
          </div>
        </div>
      </section>

      {/* ─── 현재 슈퍼유저 목록 ─── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold">{t("admin.superusers.listSection")}</h2>
          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 w-56"
              placeholder={t("admin.users.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          {isLoading ? (
            <div className="py-6 flex justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : superusers.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t("admin.superusers.empty")}
            </div>
          ) : (
            superusers.map((u) => {
              const isSelf = u.id === currentUser.id;
              return (
                <div
                  key={u.id}
                  className="flex items-center justify-between rounded-lg border bg-card p-3 shadow-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 shrink-0 rounded-full bg-amber-500/15 flex items-center justify-center">
                      <Crown className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {u.display_name}
                        {isSelf && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            {t("admin.common.you")}
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSelf || demote.isPending}
                    onClick={() => {
                      if (confirm(t("admin.superusers.demoteConfirm", { email: u.email }))) {
                        demote.mutate(u.id);
                      }
                    }}
                  >
                    <UserX className="h-3.5 w-3.5 mr-1" />
                    {t("admin.superusers.demoteBtn")}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
