/**
 * 팀 설정 · 멤버 — 목록 · 추가 · 권한(role) · 직책(title) · 제거.
 *
 * role 은 권한(15 멤버 / 20 관리자)이고 title 은 표시 전용 직책이다.
 * 백엔드 정책상 role 변경은 team admin 만, title 변경은 team admin 또는 본인.
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoreHorizontal, UserPlus, Shield } from "lucide-react";
import { apiErrorMessage } from "@/lib/api-error";
import { teamsApi } from "@/api/teams";
import { workspacesApi } from "@/api/workspaces";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { UserPicker, membersToUsers } from "@/components/ui/user-picker";
import type { TeamMember } from "@/types";

const ROLE_MEMBER = 15;
const ROLE_ADMIN = 20;

export function TeamMembersPage() {
  const { workspaceSlug = "", teamId = "" } = useParams<{ workspaceSlug: string; teamId: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [addOpen, setAddOpen] = useState(false);

  const { data: team } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => teamsApi.get(workspaceSlug, teamId),
    enabled: !!workspaceSlug && !!teamId,
  });

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => teamsApi.members.list(workspaceSlug, teamId),
    enabled: !!team,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["team-members", teamId] });
    qc.invalidateQueries({ queryKey: ["team", teamId] });
  };

  const roleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: number }) =>
      teamsApi.members.update(workspaceSlug, teamId, memberId, { role }),
    onSuccess: invalidate,
    onError: (e) => toast.error(apiErrorMessage(e, t("team.settings.members.roleUpdateFailed"))),
  });

  const titleMutation = useMutation({
    mutationFn: ({ memberId, title }: { memberId: string; title: string }) =>
      teamsApi.members.update(workspaceSlug, teamId, memberId, { title }),
    onSuccess: invalidate,
    onError: (e) => toast.error(apiErrorMessage(e, t("team.settings.members.titleUpdateFailed"))),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => teamsApi.members.remove(workspaceSlug, teamId, memberId),
    onSuccess: invalidate,
    onError: (e) => toast.error(apiErrorMessage(e, t("team.settings.members.removeFailed"))),
  });

  const isAdmin = team?.my_role === ROLE_ADMIN;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          {t("team.settings.members.title")}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{members.length}</span>
        </h1>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} className="gap-1.5">
            <UserPlus className="h-3.5 w-3.5" />
            {t("team.settings.members.add")}
          </Button>
        )}
      </div>

      <section className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">{t("team.loading")}</p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                isSelf={m.member.id === currentUser?.id}
                isAdmin={!!isAdmin}
                onRoleChange={(role) => roleMutation.mutate({ memberId: m.id, role })}
                onTitleChange={(title) => titleMutation.mutate({ memberId: m.id, title })}
                onRemove={() => removeMutation.mutate(m.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-2">
        <h2 className="text-sm font-semibold">{t("team.settings.members.permsTitle")}</h2>
        <dl className="text-xs space-y-1.5">
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 font-medium">{t("team.role.admin")}</dt>
            <dd className="text-muted-foreground">{t("team.settings.members.permsAdmin")}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 font-medium">{t("team.role.member")}</dt>
            <dd className="text-muted-foreground">{t("team.settings.members.permsMember")}</dd>
          </div>
        </dl>
      </section>

      {addOpen && (
        <AddMemberDialog
          workspaceSlug={workspaceSlug}
          teamId={teamId}
          excludeIds={members.map((m) => m.member.id)}
          onClose={() => setAddOpen(false)}
          onAdded={() => { invalidate(); setAddOpen(false); }}
        />
      )}
    </div>
  );
}

/* ────────────── 멤버 한 줄 ────────────── */
function MemberRow({
  member: m, isSelf, isAdmin, onRoleChange, onTitleChange, onRemove,
}: {
  member: TeamMember;
  isSelf: boolean;
  isAdmin: boolean;
  onRoleChange: (role: number) => void;
  onTitleChange: (title: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [editingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState(m.title);

  /* title 은 표시 전용이라 본인도 고칠 수 있다 — 백엔드 정책과 동일하게 맞춘다 */
  const canEditTitle = isAdmin || isSelf;
  const canRemove = isAdmin || isSelf;

  const commitTitle = () => {
    setEditingTitle(false);
    const next = draft.trim();
    if (next !== m.title) onTitleChange(next);
    else setDraft(m.title);
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <AvatarInitials name={m.member.display_name} avatar={m.member.avatar} size="sm" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {m.member.display_name}
          {isSelf && <span className="ml-2 text-2xs text-muted-foreground">{t("team.you")}</span>}
        </p>
        <p className="text-2xs text-muted-foreground truncate">{m.member.email}</p>
      </div>

      {/* 직책 — 인라인 편집 */}
      <div className="w-32 shrink-0">
        {editingTitle ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") { setDraft(m.title); setEditingTitle(false); }
            }}
            maxLength={50}
            placeholder={t("team.settings.members.titlePlaceholder")}
            className="h-7 text-xs"
          />
        ) : (
          <button
            type="button"
            disabled={!canEditTitle}
            onClick={() => { setDraft(m.title); setEditingTitle(true); }}
            className="w-full text-left text-xs truncate rounded px-1.5 py-1 enabled:hover:bg-accent transition-colors disabled:cursor-default"
            title={canEditTitle ? t("team.settings.members.titleLabel") : undefined}
          >
            {m.title || (
              <span className="text-muted-foreground/70">
                {canEditTitle ? t("team.settings.members.titleAdd") : "—"}
              </span>
            )}
          </button>
        )}
      </div>

      {/* 권한 — team admin 만 변경 */}
      <div className="w-24 shrink-0">
        {isAdmin && !isSelf ? (
          <Select value={String(m.role)} onValueChange={(v) => onRoleChange(Number(v))}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={String(ROLE_MEMBER)}>{t("team.role.member")}</SelectItem>
              <SelectItem value={String(ROLE_ADMIN)}>{t("team.role.admin")}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="flex items-center gap-1 text-2xs text-muted-foreground px-1.5">
            {m.role === ROLE_ADMIN && <Shield className="h-3 w-3" />}
            {t(m.role === ROLE_ADMIN ? "team.role.admin" : "team.role.member")}
          </span>
        )}
      </div>

      {/* 제거/탈퇴 — hover 로만 뜨던 X 버튼을 상시 노출 메뉴로 교체(터치 접근성) */}
      <div className="w-8 shrink-0 flex justify-end">
        {canRemove && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  const msg = isSelf
                    ? t("team.settings.members.leaveConfirm")
                    : t("team.settings.members.removeConfirm", { name: m.member.display_name });
                  if (window.confirm(msg)) onRemove();
                }}
              >
                {t(isSelf ? "team.settings.members.leave" : "team.settings.members.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

/* ────────────── 멤버 추가 (워크스페이스 멤버 검색) ────────────── */
function AddMemberDialog({
  workspaceSlug, teamId, excludeIds, onClose, onAdded,
}: {
  workspaceSlug: string;
  teamId: string;
  excludeIds: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const { data: wsMembers = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug),
  });

  const addMutation = useMutation({
    mutationFn: (memberId: string) => teamsApi.members.add(workspaceSlug, teamId, { member: memberId }),
    onSuccess: () => onAdded(),
    onError: (e) => toast.error(apiErrorMessage(e, t("team.settings.members.addFailed"))),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("team.settings.members.addDialogTitle")}</DialogTitle>
        </DialogHeader>
        {/* 단일 선택 — 고르면 즉시 추가. 이미 팀원은 excludeIds로 후보에서 제외 */}
        <UserPicker
          variant="field"
          mode="single"
          users={membersToUsers(wsMembers)}
          excludeIds={excludeIds}
          value={[]}
          onChange={(ids) => { if (ids[0]) addMutation.mutate(ids[0]); }}
          placeholder={t("team.settings.members.searchPlaceholder")}
        />
      </DialogContent>
    </Dialog>
  );
}
