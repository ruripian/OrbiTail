/**
 * 워크스페이스 설정 · 문서 스페이스 — 관리자 전용.
 *
 * 문서 화면은 관리자에게도 멤버가 아닌 비공개 스페이스를 보여 주지 않는다. 대신 여기서 모든 공용
 * 스페이스를 관리한다: 공개 여부, 멤버, 보관, 삭제. 문서 내용은 보이지 않는다 — 봐야 하면 자신을
 * 멤버로 추가한다(멤버 명단에 남는다). 개인·프로젝트 스페이스는 여기서 다루지 않는다.
 */
import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderLock, Globe, Lock, Users, X } from "lucide-react";

import { documentsApi, type ManagedSpace } from "@/api/documents";
import { workspacesApi } from "@/api/workspaces";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserPicker, membersToUsers } from "@/components/ui/user-picker";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DOC_SPACE_ROLE, type DocumentSpaceRole } from "@/types";

const ROLE_LABEL: Record<number, string> = {
  [DOC_SPACE_ROLE.VIEWER]: "뷰어",
  [DOC_SPACE_ROLE.EDITOR]: "편집자",
  [DOC_SPACE_ROLE.ADMIN]: "관리자",
};

export function WorkspaceSpacesPage() {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const { data: wsMembers = [], isLoading: membersLoading } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug),
    enabled: !!workspaceSlug,
  });
  const isAdmin = (wsMembers.find((m) => m.member.id === user?.id)?.role ?? 0) >= 20 || !!user?.is_superuser;

  const { data: spaces = [], isLoading } = useQuery({
    queryKey: ["admin-spaces", workspaceSlug],
    queryFn: () => documentsApi.adminSpaces.list(workspaceSlug),
    enabled: !!workspaceSlug && isAdmin,
  });

  const [managing, setManaging] = useState<ManagedSpace | null>(null);
  const [deleting, setDeleting] = useState<ManagedSpace | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-spaces", workspaceSlug] });
    qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
  };
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { is_private?: boolean; archived?: boolean } }) =>
      documentsApi.adminSpaces.update(workspaceSlug, id, data),
    onSuccess: invalidate,
    onError: (e) => toast.error(apiErrorMessage(e, "변경하지 못했습니다")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => documentsApi.adminSpaces.remove(workspaceSlug, id),
    onSuccess: () => { invalidate(); setDeleting(null); toast.success("스페이스를 삭제했습니다"); },
    onError: (e) => toast.error(apiErrorMessage(e, "삭제하지 못했습니다")),
  });

  if (!membersLoading && !isAdmin) {
    return <Navigate to={`/${workspaceSlug}/workspace-settings/archived`} replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">문서 스페이스</h1>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          워크스페이스의 모든 공용 스페이스를 관리합니다. 비공개 스페이스는 관리자라도 멤버가 아니면 문서 화면에
          보이지 않으며, 여기서도 문서 내용은 보이지 않습니다. 내용을 봐야 하면 자신을 멤버로 추가하세요.
        </p>
      </div>

      {isLoading || membersLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">불러오는 중...</p>
      ) : spaces.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">공용 스페이스가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {spaces.map((sp) => (
            <div key={sp.id} className={cn("flex items-center gap-3 rounded-lg border bg-background p-3", sp.archived_at && "opacity-70")}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {sp.is_private ? <FolderLock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium truncate">{sp.name}</p>
                  <span className={cn(
                    "text-2xs font-semibold px-1.5 py-0.5 rounded-md border shrink-0",
                    sp.is_private ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" : "bg-muted/40",
                  )}>
                    {sp.is_private ? "비공개" : "공개"}
                  </span>
                  {sp.archived_at && <span className="text-2xs text-muted-foreground">보관됨</span>}
                  {sp.is_private && !sp.i_am_member && (
                    <span className="text-2xs text-muted-foreground">· 나는 멤버 아님</span>
                  )}
                </div>
                <p className="text-2xs text-muted-foreground mt-0.5">
                  문서 {sp.document_count} · 멤버 {sp.member_count}
                  {sp.admins.length > 0 && <> · 관리자 {sp.admins.join(", ")}</>}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => setManaging(sp)}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent">
                  <Users className="h-3.5 w-3.5" /> 멤버
                </button>
                <button type="button" onClick={() => update.mutate({ id: sp.id, data: { is_private: !sp.is_private } })}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent">
                  {sp.is_private ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  {sp.is_private ? "공개로" : "비공개로"}
                </button>
                <button type="button" onClick={() => update.mutate({ id: sp.id, data: { archived: !sp.archived_at } })}
                  className="px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent">
                  {sp.archived_at ? "보관 해제" : "보관"}
                </button>
                <button type="button" onClick={() => setDeleting(sp)}
                  className="px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {managing && (
        <SpaceMembersDialog
          workspaceSlug={workspaceSlug}
          space={managing}
          wsMembers={wsMembers}
          onClose={() => { setManaging(null); invalidate(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={`'${deleting?.name ?? ""}' 스페이스를 삭제할까요?`}
        description="스페이스 안의 문서가 모두 함께 지워지고 되돌릴 수 없습니다."
        confirmLabel="삭제"
        variant="destructive"
        loading={remove.isPending}
        onConfirm={() => { if (deleting) remove.mutate(deleting.id); }}
      />
    </div>
  );
}

function SpaceMembersDialog({ workspaceSlug, space, wsMembers, onClose }: {
  workspaceSlug: string;
  space: ManagedSpace;
  wsMembers: Parameters<typeof membersToUsers>[0];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const key = ["admin-space-members", workspaceSlug, space.id];
  const { data: members = [] } = useQuery({
    queryKey: key,
    queryFn: () => documentsApi.adminSpaces.members.list(workspaceSlug, space.id),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const onError = (e: unknown) => toast.error(apiErrorMessage(e, "처리하지 못했습니다"));

  const add = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: DocumentSpaceRole }) =>
      documentsApi.adminSpaces.members.add(workspaceSlug, space.id, userId, role),
    onSuccess: refresh, onError,
  });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: DocumentSpaceRole }) =>
      documentsApi.adminSpaces.members.setRole(workspaceSlug, space.id, userId, role),
    onSuccess: refresh, onError,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => documentsApi.adminSpaces.members.remove(workspaceSlug, space.id, userId),
    onSuccess: refresh, onError,
  });

  const memberIds = new Set(members.map((m) => m.member));
  const candidates = membersToUsers(wsMembers).filter((u) => !memberIds.has(u.id));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{space.name} · 멤버</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <UserPicker
            users={candidates}
            value={[]}
            mode="single"
            placeholder="워크스페이스 멤버를 추가"
            onChange={(ids) => ids[0] && add.mutate({ userId: ids[0], role: DOC_SPACE_ROLE.EDITOR })}
          />
          <p className="text-2xs text-muted-foreground">추가하면 편집자로 시작합니다.</p>
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border divide-y">
          {members.length === 0 && <p className="p-4 text-xs text-muted-foreground">멤버 없음</p>}
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2">
              <AvatarInitials name={m.member_detail.display_name || m.member_detail.email} avatar={m.member_detail.avatar} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{m.member_detail.display_name || "(이름 없음)"}</div>
                <div className="text-2xs text-muted-foreground truncate">{m.member_detail.email}</div>
              </div>
              <Select value={String(m.role)} onValueChange={(v) => setRole.mutate({ userId: m.member, role: Number(v) as DocumentSpaceRole })}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button onClick={() => remove.mutate(m.member)} className="p-1 text-muted-foreground hover:text-destructive" title="스페이스에서 제거">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>닫기</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
