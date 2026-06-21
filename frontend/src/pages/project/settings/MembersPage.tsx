import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPicker, membersToUsers } from "@/components/ui/user-picker";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { useAuthStore } from "@/stores/authStore";
import { Trash2, Crown } from "lucide-react";
import type { ProjectMember } from "@/types";

/* 수동 배정 가능한 역할 — Viewer(10)는 제외.
   Viewer는 탐색 '프로젝트 보기'로만 자동 부여되고, 여기선 Member/Admin 으로만 올린다. */
const ASSIGNABLE_ROLES = [
  { value: 15, key: "member" },
  { value: 20, key: "admin" },
] as const;

export function MembersPage() {
  const { workspaceSlug, projectId } = useParams<{
    workspaceSlug: string;
    projectId: string;
  }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [addUserId, setAddUserId] = useState("");

  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug!, projectId!),
  });

  /* 본인이 이 프로젝트 Admin인지 — 멤버 추가·역할변경·제거·권한토글은 Admin만.
     (백엔드도 강제하지만 UI에서도 가드해 비관리자에겐 컨트롤을 숨긴다) */
  const isAdmin = members.some(
    (m: ProjectMember) => m.member.id === currentUser?.id && m.role === 20,
  );

  const { data: wsMembers = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug!),
  });

  /* 현재 프로젝트 정보 — 리더(lead) id 확인용 */
  const { data: project } = useQuery({
    queryKey: ["project", workspaceSlug, projectId],
    queryFn: () => projectsApi.get(workspaceSlug!, projectId!),
    enabled: !!workspaceSlug && !!projectId,
  });
  const leadId = project?.lead ?? null;

  // 이미 프로젝트 멤버인 유저를 제외한 워크스페이스 멤버
  const memberIds = new Set(members.map((m: ProjectMember) => m.member.id));
  const available = wsMembers.filter((wm) => !memberIds.has(wm.member.id));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project-members", workspaceSlug, projectId] });
  };

  const addMutation = useMutation({
    mutationFn: (memberId: string) =>
      projectsApi.members.add(workspaceSlug!, projectId!, { member_id: memberId }),
    onSuccess: () => { invalidate(); setAddUserId(""); },
    onError: () => toast.error(t("project.settings.members.addFailed")),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: number }) =>
      projectsApi.members.updateRole(workspaceSlug!, projectId!, id, { role }),
    onSuccess: invalidate,
    onError: () => toast.error(t("project.settings.members.updateFailed")),
  });

  const permsMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProjectMember> }) =>
      projectsApi.members.updatePerms(workspaceSlug!, projectId!, id, data),
    onSuccess: invalidate,
    onError: () => toast.error(t("project.settings.members.updateFailed")),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) =>
      projectsApi.members.remove(workspaceSlug!, projectId!, id),
    onSuccess: invalidate,
    onError: () => toast.error(t("project.settings.members.removeFailed")),
  });

  /* 리더 지정 — Project.lead 업데이트 */
  const setLeadMutation = useMutation({
    mutationFn: (memberUserId: string) =>
      projectsApi.update(workspaceSlug!, projectId!, { lead: memberUserId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", workspaceSlug, projectId] });
      qc.invalidateQueries({ queryKey: ["project-members", workspaceSlug, projectId] });
      toast.success(t("project.settings.members.leadUpdated"));
    },
    onError: () => toast.error(t("project.settings.members.leadUpdateFailed")),
  });

  /* 리더 해제 — Project.lead = null */
  const clearLeadMutation = useMutation({
    mutationFn: () =>
      projectsApi.update(workspaceSlug!, projectId!, { lead: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", workspaceSlug, projectId] });
      toast.success(t("project.settings.members.leadCleared"));
    },
    onError: () => toast.error(t("project.settings.members.leadUpdateFailed")),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">{t("project.settings.members.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("project.settings.members.subtitle")}
        </p>
      </div>

      {/* 멤버 추가 — Admin만. 검색 가능한 단일 선택 + 추가 버튼 */}
      {isAdmin && available.length > 0 && (
        <div className="flex items-center gap-2 max-w-md">
          <div className="flex-1">
            <UserPicker
              variant="field"
              mode="single"
              users={membersToUsers(available)}
              value={addUserId ? [addUserId] : []}
              onChange={(ids) => setAddUserId(ids[0] ?? "")}
              placeholder={t("project.settings.members.selectUser")}
            />
          </div>
          <Button
            size="sm"
            disabled={!addUserId || addMutation.isPending}
            onClick={() => addUserId && addMutation.mutate(addUserId)}
          >
            {t("project.settings.members.add")}
          </Button>
        </div>
      )}

      {/* 멤버 목록 */}
      <div className="space-y-2">
        {members.map((pm: ProjectMember) => {
          const isLead = pm.member.id === leadId;
          return (
            <div
              key={pm.id}
              className="flex items-center gap-3 rounded-lg border glass p-3"
            >
              {/* 아바타 — 실제 프로필 사진 우선(없으면 이니셜) */}
              <AvatarInitials name={pm.member.display_name} avatar={pm.member.avatar} size="md" className="h-8 w-8 shrink-0" />

              {/* 이름/이메일 + 리더 배지 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium truncate">{pm.member.display_name}</p>
                  {isLead && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-2xs font-medium text-amber-600 dark:text-amber-400">
                      <Crown className="h-3 w-3" />
                      {t("project.settings.members.leadBadge")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{pm.member.email}</p>
              </div>

              {/* 리더 버튼 — Admin만. 리더면 "해제", Admin 멤버면 "리더로 지정" */}
              {isAdmin && (isLead ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => clearLeadMutation.mutate()}
                  disabled={clearLeadMutation.isPending}
                  className="text-xs"
                >
                  {t("project.settings.members.clearLead")}
                </Button>
              ) : pm.role === 20 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLeadMutation.mutate(pm.member.id)}
                  disabled={setLeadMutation.isPending}
                  className="text-xs"
                >
                  {t("project.settings.members.setLead")}
                </Button>
              ) : null)}

              {/* 역할 — Admin만 변경. 비관리자에겐 라벨로 표시. Viewer는 수동 배정 불가(현재 viewer면 표시용 disabled) */}
              {isAdmin ? (
                <Select
                  value={String(pm.role)}
                  onValueChange={(v) => roleMutation.mutate({ id: pm.id, role: Number(v) })}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pm.role === 10 && (
                      <SelectItem value="10" disabled>
                        {t("project.settings.members.role.viewer")}
                      </SelectItem>
                    )}
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r.value} value={String(r.value)}>
                        {t(`project.settings.members.role.${r.key}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="w-28 text-center text-xs text-muted-foreground">
                  {t(`project.settings.members.role.${pm.role === 10 ? "viewer" : pm.role === 20 ? "admin" : "member"}`)}
                </span>
              )}

              {/* 제거 — Admin만. 리더도 제거 가능(백엔드에서 자동으로 lead=null 처리) */}
              {isAdmin && (
                <button
                  onClick={() => removeMutation.mutate(pm.id)}
                  className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── 세분화 권한 — Admin만 관리. Member(15)에게만 적용; Viewer는 읽기 전용, Admin은 전체 자동 허용 ── */}
      {isAdmin && (
      <div className="mt-8 space-y-2">
        <h2 className="text-sm font-semibold">{t("project.settings.members.permsTitle")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("project.settings.members.permsHint")}</p>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">{t("project.settings.members.permMember")}</th>
                {(["can_edit", "can_archive", "can_delete", "can_purge", "can_schedule"] as const).map((k) => {
                  const nonAdmins = members.filter((m) => m.role === 15);
                  const allOn  = nonAdmins.length > 0 && nonAdmins.every((m) => m[k]);
                  const someOn = !allOn && nonAdmins.some((m) => m[k]);
                  const tKey = k === "can_edit" ? "permEdit" : k === "can_archive" ? "permArchive" : k === "can_delete" ? "permDelete" : k === "can_purge" ? "permPurge" : "permSchedule";
                  const toggleAll = () => {
                    /* 일부라도 켜져있으면 모두 끄고, 모두 꺼져있으면 모두 켜기 */
                    const next = !(allOn || someOn);
                    nonAdmins.forEach((m) => {
                      if (m[k] !== next) permsMutation.mutate({ id: m.id, data: { [k]: next } });
                    });
                  };
                  return (
                    <th key={k} className="text-center px-3 py-2 font-semibold">
                      <button
                        type="button"
                        onClick={toggleAll}
                        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                        title={t("project.settings.members.toggleAllHint", "전체 토글")}
                      >
                        <input
                          type="checkbox"
                          checked={allOn}
                          ref={(el) => { if (el) el.indeterminate = someOn; }}
                          readOnly
                          className="h-3 w-3 pointer-events-none"
                        />
                        {t(`project.settings.members.${tKey}`)}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {members.filter((m) => m.role === 15).map((pm) => {
                const togglePerm = (k: "can_edit" | "can_archive" | "can_delete" | "can_purge" | "can_schedule") =>
                  permsMutation.mutate({ id: pm.id, data: { [k]: !pm[k] } });
                return (
                  <tr key={pm.id} className="border-t border-border">
                    <td className="px-3 py-2">{pm.member.display_name}</td>
                    {(["can_edit", "can_archive", "can_delete", "can_purge", "can_schedule"] as const).map((k) => (
                      <td key={k} className="text-center px-3 py-2">
                        <input
                          type="checkbox"
                          checked={pm[k]}
                          onChange={() => togglePerm(k)}
                          className="h-4 w-4 rounded border-border"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
              {members.filter((m) => m.role === 15).length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-xs text-muted-foreground py-4">
                    {t("project.settings.members.permEmpty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

