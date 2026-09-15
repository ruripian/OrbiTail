/**
 * 워크스페이스 설정 · 사용량 — 관리자 전용. 규모·첨부 용량과 정리할 거리(주인 없는 개인 스페이스)를 보여 준다.
 * 개인 스페이스는 내용을 보지 않고 목록만 — 영구 삭제는 슈퍼유저 콘솔이 맡는다.
 */
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { manageApi } from "@/api/manage";
import { useWorkspaceAdmin } from "./useWorkspaceAdmin";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const ORPHAN_REASON: Record<string, string> = {
  owner_missing: "주인 계정 없음",
  owner_inactive: "탈퇴·비활성 계정",
  owner_left: "워크스페이스를 떠남",
};

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-2xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-2xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export function WorkspaceUsagePage() {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const { isAdmin, isLoading: membersLoading } = useWorkspaceAdmin(workspaceSlug);
  const { data, isLoading } = useQuery({
    queryKey: ["workspace-usage", workspaceSlug],
    queryFn: () => manageApi.usage(workspaceSlug),
    enabled: !!workspaceSlug && isAdmin,
  });

  if (!membersLoading && !isAdmin) {
    return <Navigate to={`/${workspaceSlug}/workspace-settings/archived`} replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">사용량</h1>
        <p className="text-xs text-muted-foreground mt-1">워크스페이스의 규모와 첨부 파일 용량, 정리할 항목입니다.</p>
      </div>

      {isLoading || membersLoading || !data ? (
        <p className="text-sm text-muted-foreground py-8 text-center">불러오는 중...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="멤버" value={data.members} />
            <Stat label="팀" value={data.teams} />
            <Stat label="프로젝트" value={data.projects} sub={`보관 ${data.projects_archived} · 휴지통 ${data.projects_trashed}`} />
            <Stat label="이슈" value={data.issues} sub={`휴지통 ${data.issues_trashed}`} />
            <Stat label="공용 스페이스" value={data.spaces} />
            <Stat label="문서" value={data.documents} sub={`휴지통 ${data.documents_trashed}`} />
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">첨부 파일</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Stat label="합계"
                value={formatBytes(data.storage.issue_attachments.bytes + data.storage.document_attachments.bytes)}
                sub={`${data.storage.issue_attachments.count + data.storage.document_attachments.count}개`} />
              <Stat label="이슈 첨부" value={formatBytes(data.storage.issue_attachments.bytes)} sub={`${data.storage.issue_attachments.count}개`} />
              <Stat label="문서 첨부" value={formatBytes(data.storage.document_attachments.bytes)} sub={`${data.storage.document_attachments.count}개`} />
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">주인 없는 개인 스페이스</h2>
            <p className="text-2xs text-muted-foreground">
              탈퇴했거나 워크스페이스를 떠난 사람의 개인 스페이스입니다. 개인 공간이라 내용은 보이지 않습니다.
              {data.can_delete_orphans ? (
                <> 영구 삭제는 <Link to={`/admin/workspaces/${workspaceSlug}/spaces`} className="underline hover:text-foreground">관리자 콘솔</Link>에서 할 수 있습니다.</>
              ) : (
                <> 영구 삭제는 시스템 관리자에게 요청하세요.</>
              )}
            </p>
            {data.orphan_personal_spaces.length === 0 ? (
              <p className="text-xs text-muted-foreground rounded-lg border bg-background p-3">정리할 스페이스가 없습니다.</p>
            ) : (
              <div className="rounded-lg border divide-y bg-background">
                {data.orphan_personal_spaces.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-medium truncate">{s.name}</span>
                    <span className="text-2xs text-muted-foreground">{s.owner_email ?? "—"}</span>
                    <span className="ml-auto text-2xs text-muted-foreground">
                      {ORPHAN_REASON[s.reason] ?? s.reason} · 문서 {s.document_count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
