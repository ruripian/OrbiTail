/**
 * 워크스페이스 설정 · 프로젝트 — 관리자 전용.
 *
 * 비공개 프로젝트는 관리자라도 멤버가 아니면 프로젝트 화면에 보이지 않는다. 여기서는 전체를 보고
 * 멤버·리드·보관·휴지통을 다룬다. 이슈 내용은 보이지 않는다 — 봐야 하면 자신을 멤버로 추가한다
 * (활동 기록에 남는다). 휴지통의 복구·영구 삭제는 보관함 화면이 맡는다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe, Lock, Search, Users, X } from "lucide-react";

import { manageApi, type ManagedProject } from "@/api/manage";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UserPicker, membersToUsers } from "@/components/ui/user-picker";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useWorkspaceAdmin } from "./useWorkspaceAdmin";

/* 역할 번호 → i18n 키. 문구가 아니라 키를 담아 화면에서 t() 로 푼다. */
export const PROJECT_ROLE_KEY: Record<number, string> = {
  10: "project.settings.members.role.viewer",
  15: "project.settings.members.role.member",
  20: "project.settings.members.role.admin",
};

export function WorkspaceProjectsManagePage() {
  const { t } = useTranslation();
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const qc = useQueryClient();
  const { isAdmin, isLoading: membersLoading, wsMembers } = useWorkspaceAdmin(workspaceSlug);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["manage-projects", workspaceSlug],
    queryFn: () => manageApi.projects.list(workspaceSlug),
    enabled: !!workspaceSlug && isAdmin,
  });

  const [query, setQuery] = useState("");
  const [managing, setManaging] = useState<ManagedProject | null>(null);
  const [trashing, setTrashing] = useState<ManagedProject | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["manage-projects", workspaceSlug] });
    qc.invalidateQueries({ queryKey: ["projects", workspaceSlug] });
  };
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { lead?: string | null; archived?: boolean } }) =>
      manageApi.projects.update(workspaceSlug, id, data),
    onSuccess: invalidate,
    onError: (e) => toast.error(apiErrorMessage(e, t("workspaceSettings.projects.changeFailed"))),
  });
  const trash = useMutation({
    mutationFn: (id: string) => manageApi.projects.trash(workspaceSlug, id),
    onSuccess: () => { invalidate(); setTrashing(null); toast.success(t("workspaceSettings.projects.trashed")); },
    onError: (e) => toast.error(apiErrorMessage(e, t("workspaceSettings.projects.trashFailed"))),
  });

  if (!membersLoading && !isAdmin) {
    return <Navigate to={`/${workspaceSlug}/workspace-settings/archived`} replace />;
  }

  const q = query.trim().toLowerCase();
  const visible = projects.filter((p) => !q || p.name.toLowerCase().includes(q) || p.identifier.toLowerCase().includes(q));
  const alive = visible.filter((p) => !p.deleted_at);
  const trashedCount = visible.length - alive.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t("workspaceSettings.projects.title")}</h1>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {t("workspaceSettings.projects.subtitle")}
        </p>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("workspaceSettings.projects.searchPlaceholder")} className="h-9 pl-8" />
      </div>

      {isLoading || membersLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("common.loading")}</p>
      ) : alive.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("workspaceSettings.projects.empty")}</p>
      ) : (
        <div className="space-y-2">
          {alive.map((p) => (
            <div key={p.id} className={cn("flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3", p.archived_at && "opacity-70")}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {p.visibility === "private" ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-[180px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-2xs text-muted-foreground">{p.identifier}</span>
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <span className={cn(
                    "text-2xs font-semibold px-1.5 py-0.5 rounded-md border shrink-0",
                    p.visibility === "private" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" : "bg-muted/40",
                  )}>
                    {p.visibility === "private" ? t("workspaceSettings.projects.private") : t("workspaceSettings.projects.public")}
                  </span>
                  {p.archived_at && <span className="text-2xs text-muted-foreground">{t("workspaceSettings.projects.archived")}</span>}
                  {p.visibility === "private" && !p.i_am_member && (
                    <span className="text-2xs text-muted-foreground">{t("workspaceSettings.projects.notMember")}</span>
                  )}
                </div>
                <p className="text-2xs text-muted-foreground mt-0.5">
                  {t("workspaceSettings.projects.counts", { issues: p.issue_count, members: p.member_count, lead: p.lead ? (p.lead.display_name || p.lead.email) : t("workspaceSettings.projects.noLead") })}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => setManaging(p)}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent">
                  <Users className="h-3.5 w-3.5" /> {t("workspaceSettings.projects.membersAndLead")}
                </button>
                <button type="button" onClick={() => update.mutate({ id: p.id, data: { archived: !p.archived_at } })}
                  className="px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent">
                  {p.archived_at ? t("workspaceSettings.projects.unarchive") : t("workspaceSettings.projects.archive")}
                </button>
                <button type="button" onClick={() => setTrashing(p)}
                  className="px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                  {t("common.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {trashedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("workspaceSettings.projects.trashNotice", { count: trashedCount })} ·{" "}
          <Link to={`/${workspaceSlug}/workspace-settings/archived`} className="underline hover:text-foreground">{t("workspaceSettings.projects.trashLink")}</Link>
        </p>
      )}

      {managing && (
        <ProjectMembersDialog
          workspaceSlug={workspaceSlug}
          project={projects.find((p) => p.id === managing.id) ?? managing}
          wsMembers={wsMembers}
          onLeadChange={(lead) => update.mutate({ id: managing.id, data: { lead } })}
          onClose={() => { setManaging(null); invalidate(); }}
        />
      )}

      <ConfirmDialog
        open={!!trashing}
        onOpenChange={(o) => { if (!o) setTrashing(null); }}
        title={t("workspaceSettings.projects.trashConfirmTitle", { name: trashing?.name ?? "" })}
        description={t("workspaceSettings.projects.trashConfirmDesc")}
        confirmLabel={t("workspaceSettings.projects.trashConfirmLabel")}
        variant="destructive"
        loading={trash.isPending}
        onConfirm={() => { if (trashing) trash.mutate(trashing.id); }}
      />
    </div>
  );
}

function ProjectMembersDialog({ workspaceSlug, project, wsMembers, onLeadChange, onClose }: {
  workspaceSlug: string;
  project: ManagedProject;
  wsMembers: Parameters<typeof membersToUsers>[0];
  onLeadChange: (lead: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["manage-project-members", workspaceSlug, project.id];
  const { data: members = [] } = useQuery({
    queryKey: key,
    queryFn: () => manageApi.projects.members.list(workspaceSlug, project.id),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["manage-projects", workspaceSlug] });
  };
  const onError = (e: unknown) => toast.error(apiErrorMessage(e, t("workspaceSettings.projects.actionFailed")));

  const add = useMutation({
    mutationFn: (userId: string) => manageApi.projects.members.add(workspaceSlug, project.id, userId, 15),
    onSuccess: refresh, onError,
  });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: number }) =>
      manageApi.projects.members.setRole(workspaceSlug, project.id, userId, role),
    onSuccess: refresh, onError,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => manageApi.projects.members.remove(workspaceSlug, project.id, userId),
    onSuccess: refresh, onError,
  });

  const memberIds = new Set(members.map((m) => m.user.id));
  const candidates = membersToUsers(wsMembers).filter((u) => !memberIds.has(u.id));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{project.name} · {t("project.settings.members.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <UserPicker
            users={candidates}
            value={[]}
            mode="single"
            placeholder={t("workspaceSettings.projects.addMemberPlaceholder")}
            onChange={(ids) => ids[0] && add.mutate(ids[0])}
          />
          <p className="text-2xs text-muted-foreground">{t("workspaceSettings.projects.addMemberHint")}</p>
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border divide-y">
          {members.length === 0 && <p className="p-4 text-xs text-muted-foreground">{t("workspaceSettings.projects.noMembers")}</p>}
          {members.map((m) => {
            const isLead = project.lead?.id === m.user.id;
            return (
              <div key={m.user.id} className="flex items-center gap-3 px-3 py-2">
                <AvatarInitials name={m.user.display_name || m.user.email} avatar={m.user.avatar} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">
                    {m.user.display_name || t("workspaceSettings.projects.noName")}
                    {isLead && <span className="ml-1.5 text-2xs font-semibold text-primary">{t("workspaceSettings.projects.lead")}</span>}
                  </div>
                  <div className="text-2xs text-muted-foreground truncate">{m.user.email}</div>
                </div>
                <button type="button" onClick={() => onLeadChange(isLead ? null : m.user.id)}
                  className="px-1.5 py-1 rounded-md text-2xs text-muted-foreground hover:text-foreground hover:bg-accent">
                  {isLead ? t("workspaceSettings.projects.unsetLead") : t("workspaceSettings.projects.setLead")}
                </button>
                <Select value={String(m.role)} onValueChange={(v) => setRole.mutate({ userId: m.user.id, role: Number(v) })}>
                  <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROJECT_ROLE_KEY).map(([value, key]) => (
                      <SelectItem key={value} value={value}>{t(key)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button onClick={() => remove.mutate(m.user.id)} className="p-1 text-muted-foreground hover:text-destructive" title={t("workspaceSettings.projects.removeFromProject")}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>{t("common.close")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
