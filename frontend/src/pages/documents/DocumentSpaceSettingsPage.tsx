/**
 * 문서 스페이스 설정 — 일반(이름/설명) + 멤버.
 * 경로: /{workspaceSlug}/documents/space/{spaceId}/settings
 *
 * 멤버 모델 (프로젝트 스페이스 기준):
 *  - 프로젝트 멤버 (ProjectMember 레코드)와 스페이스 추가 멤버 (DocumentSpace.members)를
 *    하나의 통합 목록으로 보여줌. 출처 배지 표시.
 *  - 제거 동작:
 *      · 프로젝트 멤버 → ProjectMember 레코드 삭제 (프로젝트에서도 함께 빠짐) +
 *        space.members 에 들어 있다면 그 항목도 제거.
 *      · 스페이스 전용 멤버 → space.members 에서만 제거.
 *  - 추가는 항상 space.members 에 추가 (프로젝트 멤버 추가는 프로젝트 설정에서).
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Trash2, UserPlus, X, FolderKanban, UserCog } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { workspacesApi } from "@/api/workspaces";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import type { ProjectMember, User } from "@/types";

interface UnifiedMember {
  user: User;
  origin: "project" | "space";
  /** 프로젝트 멤버 레코드 ID — origin === "project" 일 때만 의미 있음 */
  projectMemberId?: string;
  /** 두 곳 모두에 있는지 — 제거 시 양쪽 다 정리 */
  alsoInSpace?: boolean;
}

export default function DocumentSpaceSettingsPage() {
  const { workspaceSlug, spaceId } = useParams<{ workspaceSlug: string; spaceId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: spaces = [] } = useQuery({
    queryKey: ["document-spaces", workspaceSlug],
    queryFn: () => documentsApi.spaces.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const space = spaces.find((s) => s.id === spaceId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (space) {
      setName(space.name);
      setDescription(space.description ?? "");
    }
  }, [space?.id, space?.name, space?.description]);

  const { data: wsMembers = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  const projectId = (space?.project as unknown as string) || null;

  const { data: projectMembers = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug!, projectId!),
    enabled: !!workspaceSlug && !!projectId,
  });

  const updateSpaceMut = useMutation({
    mutationFn: (data: { name?: string; description?: string; members?: string[] }) =>
      documentsApi.spaces.update(workspaceSlug!, spaceId!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
    },
    onError: () => toast.error("저장 실패 (편집 권한 확인)"),
  });

  const removeProjectMemberMut = useMutation({
    mutationFn: ({ pmId, userId }: { pmId: string; userId: string }) =>
      projectsApi.members.remove(workspaceSlug!, projectId!, pmId).then(() => userId),
    onSuccess: (userId) => {
      qc.invalidateQueries({ queryKey: ["project-members", workspaceSlug, projectId] });
      /* 만약 space.members 에도 있었다면 거기서도 제거 */
      const spaceMembers = ((space?.members as unknown as string[]) ?? []);
      if (spaceMembers.includes(userId)) {
        updateSpaceMut.mutate({ members: spaceMembers.filter((id) => id !== userId) });
      }
      toast.success("프로젝트와 문서 모두에서 제거됨");
    },
    onError: () => toast.error("제거 실패 (권한 확인)"),
  });

  const deleteSpaceMut = useMutation({
    mutationFn: () => documentsApi.spaces.delete(workspaceSlug!, spaceId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
      toast.success("스페이스 삭제됨");
      navigate(`/${workspaceSlug}/documents`);
    },
    onError: () => toast.error("삭제 실패"),
  });

  if (!space) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isProject = space.space_type === "project";
  const isPersonal = space.space_type === "personal";
  const spaceMemberIds: string[] = (space.members as unknown as string[]) ?? [];

  /* 통합 목록 — 프로젝트 멤버 (project 스페이스만) + 스페이스 추가 멤버, 중복 사용자는 한 항목으로 합침 */
  const unified: UnifiedMember[] = (() => {
    const map = new Map<string, UnifiedMember>();
    if (isProject) {
      for (const pm of projectMembers) {
        map.set(pm.member.id, {
          user: pm.member,
          origin: "project",
          projectMemberId: pm.id,
          alsoInSpace: spaceMemberIds.includes(pm.member.id),
        });
      }
    }
    for (const userId of spaceMemberIds) {
      if (map.has(userId)) {
        const existing = map.get(userId)!;
        existing.alsoInSpace = true;
        continue;
      }
      const wsm = wsMembers.find((m) => m.member.id === userId);
      if (wsm) map.set(userId, { user: wsm.member, origin: "space" });
    }
    return Array.from(map.values());
  })();

  const candidates = wsMembers
    .filter((m) => !unified.some((u) => u.user.id === m.member.id))
    .map((m) => m.member);

  const addAsSpaceMember = (userId: string) => {
    updateSpaceMut.mutate({ members: [...spaceMemberIds, userId] });
  };

  const handleRemove = (u: UnifiedMember) => {
    if (u.origin === "project") {
      if (!u.projectMemberId) return;
      if (!window.confirm(
        `${u.user.display_name || u.user.email} 님을 프로젝트와 이 문서 모두에서 제거할까요?\n` +
        `프로젝트 멤버 자격이 함께 해제됩니다.`,
      )) return;
      removeProjectMemberMut.mutate({ pmId: u.projectMemberId, userId: u.user.id });
    } else {
      updateSpaceMut.mutate({ members: spaceMemberIds.filter((id) => id !== u.user.id) });
      toast.success("스페이스 추가 멤버에서 제거됨");
    }
  };

  const saveGeneral = () => {
    updateSpaceMut.mutate({ name: name.trim(), description: description.trim() });
    toast.success("저장됨");
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}`)}
          className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted/40"
          title="스페이스로 돌아가기"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-semibold">{space.name} 설정</h1>
        <span className="text-2xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
          {isProject ? "프로젝트 스페이스" : isPersonal ? "개인 스페이스" : "공유 스페이스"}
        </span>
      </div>

      {/* 일반 */}
      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">일반</h2>
        <div className="space-y-1.5">
          <Label className="text-xs">이름</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={isProject} />
          {isProject && <p className="text-2xs text-muted-foreground">프로젝트 스페이스 이름은 프로젝트 이름과 동기화됩니다.</p>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">설명</Label>
          <textarea
            className="w-full min-h-[72px] rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={saveGeneral} disabled={updateSpaceMut.isPending}>
            {updateSpaceMut.isPending ? "저장 중..." : "저장"}
          </Button>
        </div>
      </section>

      {/* 멤버 — 개인 스페이스 제외 */}
      {!isPersonal && (
        <section className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">멤버</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {isProject
                ? "프로젝트 멤버와 이 스페이스에만 추가된 멤버 모두 표시됩니다. 프로젝트 멤버를 제거하면 프로젝트에서도 함께 제거됩니다."
                : "이 공유 스페이스의 멤버."}
            </p>
            {isProject && projectId && (
              <button
                onClick={() => navigate(`/${workspaceSlug}/projects/${projectId}/settings/members`)}
                className="text-2xs text-primary hover:underline mt-1 inline-flex items-center gap-1"
              >
                <UserCog className="h-3 w-3" />
                프로젝트 멤버 관리(역할/권한)
              </button>
            )}
          </div>

          {unified.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">멤버 없음</p>
          ) : (
            <ul className="space-y-1">
              {unified.map((u) => (
                <li key={u.user.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/40">
                  <AvatarInitials name={u.user.display_name || u.user.email} avatar={u.user.avatar} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm flex items-center gap-2">
                      {u.user.display_name || "(이름 없음)"}
                      {u.origin === "project" ? (
                        <span className="text-3xs px-1.5 py-0.5 rounded bg-primary/10 text-primary inline-flex items-center gap-1">
                          <FolderKanban className="h-2.5 w-2.5" />
                          프로젝트 멤버
                        </span>
                      ) : (
                        <span className="text-3xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          문서 추가
                        </span>
                      )}
                    </div>
                    <div className="text-2xs text-muted-foreground">{u.user.email}</div>
                  </div>
                  <button
                    onClick={() => handleRemove(u)}
                    className="text-muted-foreground hover:text-destructive p-1"
                    title={u.origin === "project" ? "프로젝트와 문서에서 모두 제거" : "스페이스 추가 멤버에서 제거"}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* 추가 picker — 항상 space.members 에 추가됨 (프로젝트 멤버로 추가는 프로젝트 설정 페이지에서) */}
          {candidates.length > 0 && (
            <details className="rounded border bg-background">
              <summary className="cursor-pointer flex items-center gap-2 px-3 py-2 text-xs font-medium text-primary">
                <UserPlus className="h-3.5 w-3.5" />
                {isProject ? "이 문서 스페이스에만 멤버 추가" : "멤버 추가"}
              </summary>
              <ul className="max-h-60 overflow-y-auto border-t">
                {candidates.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => addAsSpaceMember(m.id)}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-muted/40"
                    >
                      <AvatarInitials name={m.display_name || m.email} avatar={m.avatar} size="sm" />
                      <div className="flex-1 min-w-0 text-sm">
                        <div>{m.display_name}</div>
                        <div className="text-2xs text-muted-foreground">{m.email}</div>
                      </div>
                      <UserPlus className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* 위험 영역 */}
      {!isProject && (
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-destructive">위험 영역</h2>
          <p className="text-xs text-muted-foreground">
            스페이스를 삭제하면 안의 모든 문서가 함께 삭제됩니다. 되돌릴 수 없습니다.
          </p>
          <Button
            size="sm" variant="ghost"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => {
              if (window.confirm(`"${space.name}" 스페이스와 안의 모든 문서를 영구 삭제할까요?`)) {
                deleteSpaceMut.mutate();
              }
            }}
            disabled={deleteSpaceMut.isPending}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            스페이스 삭제
          </Button>
        </section>
      )}
    </div>
  );
}

/* 사용하지 않는 import 표시 회피 */
export const __used_pm = (_: ProjectMember) => null;
