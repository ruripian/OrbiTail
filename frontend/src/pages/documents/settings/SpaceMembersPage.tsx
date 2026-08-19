/**
 * 문서 스페이스 설정 · 멤버 — 역할(뷰어/편집자/관리자) 관리.
 *
 * 프로젝트 스페이스는 프로젝트 멤버가 자기 권한을 그대로 상속하므로, 여기서 다루는 건
 * "이 스페이스에만 추가된 인원" 이다. 상속 멤버는 출처를 밝혀 함께 보여주되 역할은 프로젝트에서 바꾼다.
 */
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderKanban, UserCog, X } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { workspacesApi } from "@/api/workspaces";
import { projectsApi } from "@/api/projects";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { UserPicker, membersToUsers } from "@/components/ui/user-picker";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api-error";
import { useSpaceSettings } from "./DocumentSpaceSettingsLayout";
import { DOC_SPACE_ROLE, type DocumentSpaceRole } from "@/types";

const ROLE_OPTIONS: { value: DocumentSpaceRole; label: string; desc: string }[] = [
  { value: DOC_SPACE_ROLE.VIEWER, label: "뷰어",   desc: "읽기만" },
  { value: DOC_SPACE_ROLE.EDITOR, label: "편집자", desc: "문서 편집" },
  { value: DOC_SPACE_ROLE.ADMIN,  label: "관리자", desc: "설정·멤버·삭제" },
];

export default function SpaceMembersPage() {
  const { space, workspaceSlug, spaceId, isAdmin } = useSpaceSettings();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isProject = space.space_type === "project";
  const isPersonal = space.space_type === "personal";
  const projectId = space.project;

  const { data: members = [] } = useQuery({
    queryKey: ["space-members", workspaceSlug, spaceId],
    queryFn: () => documentsApi.spaces.members.list(workspaceSlug, spaceId),
  });

  const { data: wsMembers = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug),
  });

  const { data: projectMembers = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug, projectId!),
    enabled: isProject && !!projectId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["space-members", workspaceSlug, spaceId] });
    qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
  };

  const add = useMutation({
    mutationFn: (userId: string) =>
      documentsApi.spaces.members.add(workspaceSlug, spaceId, userId, DOC_SPACE_ROLE.EDITOR),
    onSuccess: () => { invalidate(); toast.success("멤버 추가됨"); },
    onError: (e) => toast.error(apiErrorMessage(e, "추가 실패")),
  });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: DocumentSpaceRole }) =>
      documentsApi.spaces.members.setRole(workspaceSlug, spaceId, userId, role),
    onSuccess: () => { invalidate(); toast.success("역할 변경됨"); },
    onError: (e) => toast.error(apiErrorMessage(e, "변경 실패")),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => documentsApi.spaces.members.remove(workspaceSlug, spaceId, userId),
    onSuccess: () => { invalidate(); toast.success("멤버 제거됨"); },
    onError: (e) => toast.error(apiErrorMessage(e, "제거 실패")),
  });

  if (isPersonal) {
    return (
      <div className="max-w-regular space-y-4">
        <h1 className="text-lg font-semibold">멤버</h1>
        <p className="text-sm text-muted-foreground">개인 스페이스는 본인만 사용합니다.</p>
      </div>
    );
  }

  const memberIds = new Set(members.map((m) => m.member));
  /* 프로젝트에서 상속된 인원 — 스페이스 멤버십이 따로 없는 사람만 (중복 표시 방지) */
  const inherited = isProject
    ? projectMembers.filter((pm) => !memberIds.has(pm.member.id))
    : [];

  const candidates = membersToUsers(wsMembers).filter(
    (u) => !memberIds.has(u.id) && !inherited.some((pm) => pm.member.id === u.id),
  );

  return (
    <div className="max-w-regular space-y-6">
      <div>
        <h1 className="text-lg font-semibold">멤버</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isProject
            ? "프로젝트 멤버는 프로젝트 권한을 그대로 씁니다. 이 스페이스에만 필요한 사람은 아래에서 추가하세요."
            : "이 스페이스에 접근할 사람과 역할을 관리합니다."}
        </p>
      </div>

      {isAdmin && (
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">멤버 추가</p>
          <UserPicker
            users={candidates}
            value={[]}
            mode="single"
            placeholder="워크스페이스 멤버 검색"
            onChange={(ids) => ids[0] && add.mutate(ids[0])}
          />
          <p className="text-2xs text-muted-foreground">추가하면 편집자로 시작합니다. 역할은 아래에서 바꿀 수 있습니다.</p>
        </div>
      )}

      <section className="rounded-xl border bg-card divide-y">
        {members.length === 0 && inherited.length === 0 && (
          <p className="p-5 text-xs text-muted-foreground">멤버 없음</p>
        )}

        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
            <AvatarInitials name={m.member_detail.display_name || m.member_detail.email} avatar={m.member_detail.avatar} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-sm">{m.member_detail.display_name || "(이름 없음)"}</div>
              <div className="text-2xs text-muted-foreground truncate">{m.member_detail.email}</div>
            </div>
            <Select
              value={String(m.role)}
              disabled={!isAdmin}
              onValueChange={(v) => setRole.mutate({ userId: m.member, role: Number(v) as DocumentSpaceRole })}
            >
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)}>
                    <span className="flex flex-col items-start">
                      <span>{r.label}</span>
                      <span className="text-2xs text-muted-foreground">{r.desc}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isAdmin && (
              <button
                onClick={() => remove.mutate(m.member)}
                className="text-muted-foreground hover:text-destructive p-1"
                title="스페이스에서 제거"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}

        {inherited.map((pm) => (
          <div key={pm.id} className="flex items-center gap-3 px-4 py-3">
            <AvatarInitials name={pm.member.display_name || pm.member.email} avatar={pm.member.avatar} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-sm flex items-center gap-2">
                {pm.member.display_name || "(이름 없음)"}
                <span className="text-3xs px-1.5 py-0.5 rounded bg-primary/10 text-primary inline-flex items-center gap-1">
                  <FolderKanban className="h-2.5 w-2.5" />
                  프로젝트 멤버
                </span>
              </div>
              <div className="text-2xs text-muted-foreground truncate">{pm.member.email}</div>
            </div>
            <span className="text-2xs text-muted-foreground">프로젝트 권한 적용</span>
          </div>
        ))}
      </section>

      {isProject && projectId && (
        <button
          onClick={() => navigate(`/${workspaceSlug}/projects/${projectId}/settings/members`)}
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          <UserCog className="h-3 w-3" />
          프로젝트 멤버 관리로 이동
        </button>
      )}
    </div>
  );
}
