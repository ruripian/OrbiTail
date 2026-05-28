/**
 * 팀 상세 페이지 — /<ws>/teams/<teamId>.
 *
 * 구성:
 *   - 헤더: 팀 이름/설명/색 + admin 액션 (편집/삭제)
 *   - 멤버 목록 + 멤버 추가/제거/역할 변경
 *   - 캘린더 (B3 단계에서 추가 — 현재는 placeholder)
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Settings, Trash2, UserPlus, Shield, X as XIcon,
} from "lucide-react";
import { teamsApi } from "@/api/teams";
import { workspacesApi } from "@/api/workspaces";
import { useAuthStore } from "@/stores/authStore";
import { TeamCalendarSection } from "./TeamCalendarSection";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { cn } from "@/lib/utils";

export function TeamDetailPage() {
  const { workspaceSlug = "", teamId = "" } = useParams<{ workspaceSlug: string; teamId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [editOpen, setEditOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);

  const { data: team, isLoading } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => teamsApi.get(workspaceSlug, teamId),
    enabled: !!workspaceSlug && !!teamId,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => teamsApi.members.list(workspaceSlug, teamId),
    enabled: !!team,
  });

  const deleteMutation = useMutation({
    mutationFn: () => teamsApi.delete(workspaceSlug, teamId),
    onSuccess: () => {
      toast.success("팀이 삭제되었습니다.");
      qc.invalidateQueries({ queryKey: ["teams", workspaceSlug] });
      navigate(`/${workspaceSlug}/teams`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "삭제 실패"),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => teamsApi.members.remove(workspaceSlug, teamId, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
      qc.invalidateQueries({ queryKey: ["team", teamId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "멤버 제거 실패"),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: number }) =>
      teamsApi.members.update(workspaceSlug, teamId, memberId, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "역할 변경 실패"),
  });

  if (isLoading) {
    return <div className="p-10 text-sm text-muted-foreground text-center">로딩 중...</div>;
  }
  if (!team) {
    return <div className="p-10 text-sm text-muted-foreground text-center">팀을 찾을 수 없거나 접근 권한이 없습니다.</div>;
  }

  const isAdmin = team.my_role === 20;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <button
          onClick={() => navigate(`/${workspaceSlug}/teams`)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          팀 목록
        </button>

        {/* 헤더 */}
        <header className="flex items-start gap-4 mb-6">
          <div
            className="h-14 w-14 rounded-xl flex items-center justify-center text-xl font-bold shrink-0 bg-primary/10 text-primary"
            style={team.color ? { backgroundColor: `${team.color}22`, color: team.color } : undefined}
          >
            {team.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">{team.name}</h1>
            {team.description && <p className="text-sm text-muted-foreground mt-1">{team.description}</p>}
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
                <Settings className="h-3.5 w-3.5" />
                팀 설정
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  if (window.confirm(`"${team.name}" 팀을 정말 삭제하시겠습니까?`)) deleteMutation.mutate();
                }}
                className="text-destructive hover:text-destructive gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                삭제
              </Button>
            </div>
          )}
        </header>

        {/* 팀 캘린더 — 멤버 칩 토글 + 본인 PE + 비공개 프로젝트 누수 차단(요청자별) */}
        <section className="mb-6">
          <TeamCalendarSection
            workspaceSlug={workspaceSlug}
            teamId={teamId}
            teamMembers={members}
          />
        </section>

        {/* 멤버 목록 */}
        <section className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 className="text-sm font-semibold">멤버 ({members.length})</h2>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setAddMemberOpen(true)} className="gap-1.5">
                <UserPlus className="h-3.5 w-3.5" />
                멤버 추가
              </Button>
            )}
          </div>
          <ul className="divide-y">
            {members.map((m) => {
              const isSelf = m.member.id === currentUser?.id;
              return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3 group">
                  <AvatarInitials name={m.member.display_name} avatar={m.member.avatar} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {m.member.display_name}
                      {isSelf && <span className="ml-2 text-2xs text-muted-foreground">(나)</span>}
                    </p>
                    <p className="text-2xs text-muted-foreground truncate">{m.member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 역할 표시/변경 — admin 만 다른 사람 역할 변경 가능 */}
                    {isAdmin && !isSelf ? (
                      <select
                        value={m.role}
                        onChange={(e) => updateRoleMutation.mutate({ memberId: m.id, role: Number(e.target.value) })}
                        className="text-2xs bg-background border rounded-md px-1.5 py-1 outline-none focus:border-primary/60"
                      >
                        <option value={15}>멤버</option>
                        <option value={20}>관리자</option>
                      </select>
                    ) : (
                      <span className={cn(
                        "text-2xs px-2 py-1 rounded-md",
                        m.role === 20 ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground",
                      )}>
                        {m.role === 20 ? (
                          <span className="inline-flex items-center gap-0.5"><Shield className="h-2.5 w-2.5" /> 관리자</span>
                        ) : "멤버"}
                      </span>
                    )}
                    {(isAdmin || isSelf) && (
                      <button
                        onClick={() => {
                          const msg = isSelf ? "팀에서 탈퇴하시겠습니까?" : `${m.member.display_name}님을 팀에서 제거하시겠습니까?`;
                          if (window.confirm(msg)) removeMemberMutation.mutate(m.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                        title={isSelf ? "팀 탈퇴" : "팀에서 제거"}
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* 편집 다이얼로그 */}
      {editOpen && (
        <EditTeamDialog
          team={team}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["team", teamId] });
            qc.invalidateQueries({ queryKey: ["teams", workspaceSlug] });
            setEditOpen(false);
          }}
        />
      )}

      {/* 멤버 추가 다이얼로그 */}
      {addMemberOpen && (
        <AddMemberDialog
          workspaceSlug={workspaceSlug}
          teamId={teamId}
          excludeIds={members.map((m) => m.member.id)}
          onClose={() => setAddMemberOpen(false)}
          onAdded={() => {
            qc.invalidateQueries({ queryKey: ["team-members", teamId] });
            qc.invalidateQueries({ queryKey: ["team", teamId] });
            setAddMemberOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ────────────── 팀 설정 편집 ────────────── */
function EditTeamDialog({
  team, onClose, onSaved,
}: {
  team: { id: string; name: string; description: string; color: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description);
  const [color, setColor] = useState(team.color);

  const updateMutation = useMutation({
    mutationFn: () => teamsApi.update(workspaceSlug, team.id, { name: name.trim(), description, color }),
    onSuccess: () => { toast.success("팀 설정이 저장되었습니다."); onSaved(); },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "저장 실패"),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>팀 설정</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) updateMutation.mutate(); }}
          className="space-y-3"
        >
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">팀 이름 *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              maxLength={100} required
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">설명</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 resize-y"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">팀 색</label>
            <div className="flex items-center gap-2">
              <input type="color" value={color || "#888888"} onChange={(e) => setColor(e.target.value)}
                className="h-8 w-12 rounded border cursor-pointer" />
              <input type="text" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#hex"
                className="flex-1 text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60" />
              {color && <button type="button" onClick={() => setColor("")} className="text-2xs text-muted-foreground hover:text-foreground">지우기</button>}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>취소</Button>
            <Button type="submit" disabled={!name.trim() || updateMutation.isPending}>
              {updateMutation.isPending ? "저장 중..." : "저장"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  const { data: wsMembers = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug),
  });

  const addMutation = useMutation({
    mutationFn: (memberId: string) => teamsApi.members.add(workspaceSlug, teamId, { member: memberId }),
    onSuccess: () => onAdded(),
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "추가 실패"),
  });

  const filtered = wsMembers.filter((wm) => {
    if (excludeIds.includes(wm.member.id)) return false;
    if (!q.trim()) return true;
    const ql = q.toLowerCase();
    return wm.member.display_name.toLowerCase().includes(ql) || wm.member.email.toLowerCase().includes(ql);
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>멤버 추가</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 또는 이메일 검색"
            autoFocus
            className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60"
          />
          <div className="max-h-72 overflow-y-auto -mx-2">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                {q ? "검색 결과 없음" : "추가 가능한 워크스페이스 멤버 없음"}
              </p>
            ) : (
              <ul>
                {filtered.map((wm) => (
                  <li key={wm.id}>
                    <button
                      disabled={adding !== null}
                      onClick={() => {
                        setAdding(wm.member.id);
                        addMutation.mutate(wm.member.id, { onSettled: () => setAdding(null) });
                      }}
                      className={cn(
                        "flex items-center gap-2 w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted/40 transition-colors",
                        adding && "opacity-60 cursor-wait",
                      )}
                    >
                      <AvatarInitials name={wm.member.display_name} avatar={wm.member.avatar} size="xs" />
                      <span className="flex-1 truncate">{wm.member.display_name}</span>
                      <span className="text-2xs text-muted-foreground truncate">{wm.member.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
