import { useState, useMemo, useRef, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Trash2, Crown, Search, ChevronDown } from "lucide-react";
import type { ProjectMember } from "@/types";

const ROLES = [
  { value: 10, key: "viewer" },
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
  const [addUserId, setAddUserId] = useState("");

  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug!, projectId!),
  });

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

      {/* 멤버 추가 — 검색 가능한 드롭다운 */}
      {available.length > 0 && (
        <SearchableMemberAdd
          available={available}
          addUserId={addUserId}
          setAddUserId={setAddUserId}
          onAdd={(id) => addMutation.mutate(id)}
          isPending={addMutation.isPending}
          t={t}
        />
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
              {/* 아바타 */}
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary shrink-0">
                {pm.member.display_name[0]?.toUpperCase()}
              </span>

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

              {/* 리더 버튼: 리더가 아니고 Admin이면 "리더로 지정", 리더면 "리더 해제" */}
              {isLead ? (
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
              ) : null}

              {/* 역할 변경 */}
              <Select
                value={String(pm.role)}
                onValueChange={(v) => roleMutation.mutate({ id: pm.id, role: Number(v) })}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={String(r.value)}>
                      {t(`project.settings.members.role.${r.key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* 제거 — 리더도 제거 가능(백엔드에서 자동으로 lead=null 처리) */}
              <button
                onClick={() => removeMutation.mutate(pm.id)}
                className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* ── 세분화 권한 — Admin 미만 멤버에게만 적용. Admin은 전체 자동 허용 ── */}
      <div className="mt-8 space-y-2">
        <h2 className="text-sm font-semibold">{t("project.settings.members.permsTitle")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("project.settings.members.permsHint")}</p>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">{t("project.settings.members.permMember")}</th>
                <th className="text-center px-3 py-2 font-semibold">{t("project.settings.members.permEdit")}</th>
                <th className="text-center px-3 py-2 font-semibold">{t("project.settings.members.permArchive")}</th>
                <th className="text-center px-3 py-2 font-semibold">{t("project.settings.members.permDelete")}</th>
                <th className="text-center px-3 py-2 font-semibold">{t("project.settings.members.permPurge")}</th>
              </tr>
            </thead>
            <tbody>
              {members.filter((m) => m.role < 20).map((pm) => {
                const togglePerm = (k: "can_edit" | "can_archive" | "can_delete" | "can_purge") =>
                  permsMutation.mutate({ id: pm.id, data: { [k]: !pm[k] } });
                return (
                  <tr key={pm.id} className="border-t border-border">
                    <td className="px-3 py-2">{pm.member.display_name}</td>
                    {(["can_edit", "can_archive", "can_delete", "can_purge"] as const).map((k) => (
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
              {members.filter((m) => m.role < 20).length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                    {t("project.settings.members.permEmpty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── 검색 가능한 멤버 추가 드롭다운 ── */

function SearchableMemberAdd({
  available, addUserId, setAddUserId, onAdd, isPending, t,
}: {
  available: { member: { id: string; display_name: string; email: string } }[];
  addUserId: string;
  setAddUserId: (id: string) => void;
  onAdd: (id: string) => void;
  isPending: boolean;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (wm) =>
        wm.member.display_name.toLowerCase().includes(q) ||
        wm.member.email.toLowerCase().includes(q),
    );
  }, [available, query]);

  const selected = available.find((wm) => wm.member.id === addUserId);

  return (
    <div className="flex items-center gap-2 max-w-md">
      <div ref={containerRef} className="relative flex-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full min-h-9 items-center gap-2 rounded-md border border-border bg-input/60 px-3 py-1.5 text-sm text-left transition-colors hover:border-primary/50"
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              <AvatarInitials name={selected.member.display_name} size="xs" />
              {selected.member.display_name}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("project.settings.members.selectUser")}</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border glass shadow-lg overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("project.settings.members.selectUser")}
                autoComplete="off"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="overflow-y-auto py-1" style={{ maxHeight: 200 }}>
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("issues.picker.noResults")}
                </div>
              ) : (
                filtered.map((wm) => (
                  <button
                    key={wm.member.id}
                    type="button"
                    onClick={() => {
                      setAddUserId(wm.member.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <AvatarInitials name={wm.member.display_name} size="sm" />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-xs font-medium truncate">{wm.member.display_name}</div>
                      <div className="text-2xs text-muted-foreground truncate">{wm.member.email}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      <Button
        size="sm"
        disabled={!addUserId || isPending}
        onClick={() => addUserId && onAdd(addUserId)}
      >
        {t("project.settings.members.add")}
      </Button>
    </div>
  );
}
