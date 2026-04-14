import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Crown, Loader2, Plus, Search, Trash2, Users as UsersIcon,
} from "lucide-react";

import { adminApi } from "@/api/admin";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { UserPicker } from "./UserPicker";
import type { Workspace } from "@/types";

export function AdminWorkspacesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [transfer, setTransfer] = useState<Workspace | null>(null);

  // 슈퍼유저만 접근하지만 이중 안전장치
  if (!user?.is_superuser) {
    return <p className="text-sm text-muted-foreground">{t("admin.common.superOnly")}</p>;
  }

  const queryKey = ["admin_workspaces", search];
  const { data: workspaces = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => adminApi.listWorkspaces(search || undefined),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin_workspaces"] });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => adminApi.deleteWorkspace(slug),
    onSuccess: () => { toast.success(t("admin.workspaces.deleteSuccess")); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.detail || t("admin.common.error")),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{t("admin.workspaces.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("admin.workspaces.desc")}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          {t("admin.workspaces.createBtn")}
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-8 h-9"
          placeholder={t("admin.workspaces.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : workspaces.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("admin.workspaces.empty")}
          </div>
        ) : (
          workspaces.map((ws) => (
            <div
              key={ws.id}
              className="flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{ws.name}</p>
                  <span className="text-xs text-muted-foreground font-mono">/{ws.slug}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Crown className="h-3 w-3" />
                    {ws.owner.display_name} <span className="opacity-60">({ws.owner.email})</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <UsersIcon className="h-3 w-3" />
                    {ws.member_count}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTransfer(ws)}
                >
                  <Crown className="h-3.5 w-3.5 mr-1" />
                  {t("admin.workspaces.transferBtn")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                  onClick={() => {
                    if (confirm(t("admin.workspaces.deleteConfirm", { name: ws.name }))) {
                      deleteMutation.mutate(ws.slug);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} />
      <TransferOwnerDialog
        workspace={transfer}
        onClose={() => setTransfer(null)}
        onTransferred={invalidate}
      />
    </div>
  );
}

/* ─── 생성 다이얼로그 ─── */

function CreateWorkspaceDialog({
  open, onOpenChange, onCreated,
}: {
  open:          boolean;
  onOpenChange:  (v: boolean) => void;
  onCreated:     () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.createWorkspace({ name, slug, owner_id: ownerId! }),
    onSuccess: () => {
      toast.success(t("admin.workspaces.createSuccess"));
      setName(""); setSlug(""); setOwnerId(null);
      onOpenChange(false);
      onCreated();
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || t("admin.common.error")),
  });

  const canSubmit = name.trim() && slug.trim() && ownerId && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.workspaces.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>{t("admin.workspaces.nameLabel")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("admin.workspaces.slugLabel")}</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="my-workspace"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("admin.workspaces.ownerLabel")}</Label>
            <UserPicker value={ownerId} onChange={setOwnerId} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("admin.common.cancel")}
            </Button>
            <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.workspaces.createBtn")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── 소유자 이관 다이얼로그 ─── */

function TransferOwnerDialog({
  workspace, onClose, onTransferred,
}: {
  workspace:      Workspace | null;
  onClose:        () => void;
  onTransferred:  () => void;
}) {
  const { t } = useTranslation();
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => adminApi.transferWorkspaceOwner(workspace!.slug, ownerId!),
    onSuccess: () => {
      toast.success(t("admin.workspaces.transferSuccess"));
      setOwnerId(null);
      onTransferred();
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || t("admin.common.error")),
  });

  return (
    <Dialog open={!!workspace} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("admin.workspaces.transferTitle", { name: workspace?.name ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            {t("admin.workspaces.transferDesc", { current: workspace?.owner.email ?? "" })}
          </p>
          <div className="space-y-1.5">
            <Label>{t("admin.workspaces.newOwnerLabel")}</Label>
            <UserPicker value={ownerId} onChange={setOwnerId} excludeId={workspace?.owner.id} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>{t("admin.common.cancel")}</Button>
            <Button
              disabled={!ownerId || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : t("admin.workspaces.transferBtn")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
