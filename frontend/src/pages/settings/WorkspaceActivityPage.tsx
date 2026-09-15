/**
 * 워크스페이스 설정 · 활동 기록 — 관리자 전용.
 * 누가 언제 프로젝트·스페이스·멤버·토큰·웹훅을 바꿨는지. 특히 관리자가 비공개 공간에 자신을 추가한 기록이 여기 남는다.
 */
import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { manageApi, type WorkspaceActivityEntry } from "@/api/manage";
import { cn } from "@/lib/utils";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { formatLongDate, formatTime } from "@/utils/date-format";
import { PROJECT_ROLE_LABEL } from "./WorkspaceProjectsManagePage";
import { useWorkspaceAdmin } from "./useWorkspaceAdmin";

const CATEGORIES = [
  { value: "", label: "전체" },
  { value: "project", label: "프로젝트" },
  { value: "space", label: "문서 스페이스" },
  { value: "member", label: "멤버" },
  { value: "invitation", label: "초대" },
  { value: "join", label: "가입 승인" },
  { value: "team", label: "팀" },
  { value: "api_token", label: "API 토큰" },
  { value: "webhook", label: "웹훅" },
];

const ACTION_LABEL: Record<string, string> = {
  "project.trashed": "프로젝트를 휴지통으로 옮김",
  "project.restored": "프로젝트를 복구함",
  "project.purged": "프로젝트를 영구 삭제함",
  "project.archived": "프로젝트를 보관함",
  "project.unarchived": "프로젝트 보관을 해제함",
  "project.lead_changed": "프로젝트 리드를 바꿈",
  "project.member_added": "프로젝트 멤버를 추가함",
  "project.member_removed": "프로젝트 멤버를 제거함",
  "project.member_role": "프로젝트 멤버 역할을 바꿈",
  "space.visibility": "스페이스 공개 범위를 바꿈",
  "space.archived": "스페이스를 보관함",
  "space.unarchived": "스페이스 보관을 해제함",
  "space.deleted": "스페이스를 삭제함",
  "space.member_added": "스페이스 멤버를 추가함",
  "space.member_removed": "스페이스 멤버를 제거함",
  "space.member_role": "스페이스 멤버 역할을 바꿈",
  "space.personal_deleted": "개인 스페이스를 삭제함",
  "member.role": "워크스페이스 역할을 바꿈",
  "member.removed": "워크스페이스에서 내보냄",
  "invitation.sent": "초대를 보냄",
  "invitation.revoked": "초대를 취소함",
  "join.approved": "가입을 승인함",
  "join.rejected": "가입을 거절함",
  "team.deleted": "팀을 삭제함",
  "api_token.created": "API 토큰을 만듦",
  "api_token.revoked": "API 토큰을 폐기함",
  "webhook.created": "웹훅을 만듦",
  "webhook.updated": "웹훅을 수정함",
  "webhook.deleted": "웹훅을 삭제함",
};

const WS_ROLE_LABEL: Record<number, string> = { 10: "게스트", 15: "멤버", 20: "관리자", 25: "소유자" };
const SPACE_ROLE_LABEL: Record<number, string> = { 5: "뷰어", 15: "편집자", 20: "관리자" };

function roleLabel(action: string, role: unknown) {
  if (typeof role !== "number") return String(role);
  const map = action.startsWith("project.") ? PROJECT_ROLE_LABEL : action.startsWith("space.") ? SPACE_ROLE_LABEL : WS_ROLE_LABEL;
  return map[role] ?? String(role);
}

/** 사람이 읽을 수 있는 세부 — 알려진 키만 보여 주고 나머지는 숨긴다(내부 식별자 노출 방지) */
function details(a: WorkspaceActivityEntry): string[] {
  const m = a.metadata;
  const out: string[] = [];
  if (typeof m.member === "string") out.push(m.member);
  if (typeof m.email === "string") out.push(m.email);
  if ("lead" in m) out.push(`리드 → ${m.lead ?? "없음"}`);
  if ("role" in m) out.push(roleLabel(a.action, m.role));
  if ("old_role" in m && "new_role" in m) out.push(`${roleLabel(a.action, m.old_role)} → ${roleLabel(a.action, m.new_role)}`);
  if ("is_private" in m && a.action === "space.visibility") out.push(m.is_private ? "비공개로" : "공개로");
  if (Array.isArray(m.changed)) out.push(`변경: ${m.changed.join(", ")}`);
  if (m.via === "workspace_settings") out.push("워크스페이스 설정에서");
  return out;
}

export function WorkspaceActivityPage() {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const { isAdmin, isLoading: membersLoading } = useWorkspaceAdmin(workspaceSlug);
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["workspace-activity", workspaceSlug, category, page],
    queryFn: () => manageApi.activity(workspaceSlug, { category: category || undefined, page }),
    enabled: !!workspaceSlug && isAdmin,
    placeholderData: keepPreviousData,
  });

  if (!membersLoading && !isAdmin) {
    return <Navigate to={`/${workspaceSlug}/workspace-settings/archived`} replace />;
  }

  const rows = data?.results ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">활동 기록</h1>
        <p className="text-xs text-muted-foreground mt-1">
          워크스페이스 관리 동작의 기록입니다. 관리자가 비공개 프로젝트·스페이스에 자신을 추가한 경우 따로 표시합니다.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button key={c.value} type="button" onClick={() => { setCategory(c.value); setPage(1); }}
            aria-pressed={category === c.value}
            className={cn(
              "px-2.5 py-1 rounded-full border text-xs transition-colors",
              category === c.value ? "bg-primary/10 border-primary/40 text-foreground" : "text-muted-foreground hover:bg-accent",
            )}>
            {c.label}
          </button>
        ))}
      </div>

      {isLoading || membersLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">기록이 없습니다.</p>
      ) : (
        <div className={cn("rounded-lg border divide-y bg-background", isFetching && "opacity-70")}>
          {rows.map((a) => {
            const selfAddedPrivate = a.metadata.self_added === true && a.metadata.is_private === true;
            return (
              <div key={a.id} className="flex items-start gap-3 px-3 py-2.5">
                <AvatarInitials name={a.actor.display_name || a.actor.email} avatar={a.actor.avatar} size="sm" className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{a.actor.display_name || a.actor.email}</span>
                    <span className="text-muted-foreground"> · {ACTION_LABEL[a.action] ?? a.action}</span>
                    {a.target_label && <span className="font-medium"> · {a.target_label}</span>}
                    {selfAddedPrivate && (
                      <span className="ml-2 text-2xs font-semibold px-1.5 py-0.5 rounded-md border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                        비공개에 자신을 추가
                      </span>
                    )}
                  </p>
                  {details(a).length > 0 && (
                    <p className="text-2xs text-muted-foreground mt-0.5 truncate">{details(a).join(" · ")}</p>
                  )}
                </div>
                <time className="shrink-0 text-2xs text-muted-foreground tabular-nums" dateTime={a.created_at}>
                  {formatLongDate(a.created_at)} {formatTime(a.created_at)}
                </time>
              </div>
            );
          })}
        </div>
      )}

      {(data?.previous || data?.next) && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={!data?.previous} onClick={() => setPage((p) => p - 1)}>이전</Button>
          <span className="text-xs text-muted-foreground">{page} 쪽</span>
          <Button variant="outline" size="sm" disabled={!data?.next} onClick={() => setPage((p) => p + 1)}>다음</Button>
        </div>
      )}
    </div>
  );
}
