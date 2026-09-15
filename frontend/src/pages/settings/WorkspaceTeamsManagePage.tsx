/**
 * 워크스페이스 설정 · 팀 — 관리자 전용. 전체 팀을 한눈에 보고, 필요 없는 팀을 지운다.
 * 팀 안의 멤버 구성은 팀 화면(팀 관리자)이 맡는다.
 */
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UsersRound } from "lucide-react";

import { manageApi, type ManagedTeam } from "@/api/manage";
import { apiErrorMessage } from "@/lib/api-error";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatLongDate } from "@/utils/date-format";
import { useWorkspaceAdmin } from "./useWorkspaceAdmin";

export function WorkspaceTeamsManagePage() {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const qc = useQueryClient();
  const { isAdmin, isLoading: membersLoading } = useWorkspaceAdmin(workspaceSlug);

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["manage-teams", workspaceSlug],
    queryFn: () => manageApi.teams.list(workspaceSlug),
    enabled: !!workspaceSlug && isAdmin,
  });
  const [deleting, setDeleting] = useState<ManagedTeam | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => manageApi.teams.remove(workspaceSlug, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manage-teams", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["teams", workspaceSlug] });
      setDeleting(null);
      toast.success("팀을 삭제했습니다");
    },
    onError: (e) => toast.error(apiErrorMessage(e, "삭제하지 못했습니다")),
  });

  if (!membersLoading && !isAdmin) {
    return <Navigate to={`/${workspaceSlug}/workspace-settings/archived`} replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">팀</h1>
        <p className="text-xs text-muted-foreground mt-1">
          워크스페이스의 모든 팀입니다. 팀 멤버 구성은 각 팀 화면에서 팀 관리자가 다룹니다.
        </p>
      </div>

      {isLoading || membersLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">불러오는 중...</p>
      ) : teams.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">팀이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {teams.map((team) => (
            <div key={team.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <UsersRound className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-[180px]">
                <Link to={`/${workspaceSlug}/teams/${team.id}`} className="text-sm font-medium hover:underline">{team.name}</Link>
                <p className="text-2xs text-muted-foreground mt-0.5">
                  멤버 {team.member_count}
                  {team.admins.length > 0 && <> · 관리자 {team.admins.join(", ")}</>}
                  {" · "}{formatLongDate(team.created_at)} 생성
                  {team.created_by && <> ({team.created_by.display_name || team.created_by.email})</>}
                </p>
              </div>
              <button type="button" onClick={() => setDeleting(team)}
                className="px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={`'${deleting?.name ?? ""}' 팀을 삭제할까요?`}
        description="팀과 팀 멤버 구성이 지워집니다. 멤버의 프로젝트·이슈는 그대로 남습니다."
        confirmLabel="삭제"
        variant="destructive"
        loading={remove.isPending}
        onConfirm={() => { if (deleting) remove.mutate(deleting.id); }}
      />
    </div>
  );
}
