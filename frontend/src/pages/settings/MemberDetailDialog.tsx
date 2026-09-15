/**
 * 워크스페이스 멤버 상세 — 어느 프로젝트·스페이스·팀에 속해 있고 맡은 일이 얼마나 남았는지.
 * 내보내거나 역할을 바꾸기 전에 영향을 확인하는 용도. 이슈 제목 같은 내용은 싣지 않는다.
 */
import { useQuery } from "@tanstack/react-query";

import { manageApi } from "@/api/manage";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatLongDate } from "@/utils/date-format";
import { PROJECT_ROLE_LABEL } from "./WorkspaceProjectsManagePage";

const SPACE_ROLE_LABEL: Record<number, string> = { 5: "뷰어", 15: "편집자", 20: "관리자" };
const TEAM_ROLE_LABEL: Record<number, string> = { 15: "멤버", 20: "관리자" };

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">{title} {count}</h3>
      {count === 0 ? <p className="text-2xs text-muted-foreground">없음</p> : <div className="rounded-md border divide-y">{children}</div>}
    </section>
  );
}

export function MemberDetailDialog({ workspaceSlug, userId, onClose }: {
  workspaceSlug: string;
  userId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["manage-member", workspaceSlug, userId],
    queryFn: () => manageApi.member(workspaceSlug, userId),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>멤버 상세</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground py-6 text-center">불러오는 중...</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <AvatarInitials name={data.user.display_name || data.user.email} avatar={data.user.avatar} size="lg" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {data.user.display_name}
                  {(!data.user.is_active || data.user.is_suspended) && (
                    <span className="ml-1.5 text-2xs text-destructive">{data.user.is_suspended ? "정지됨" : "비활성"}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground truncate">{data.user.email}</p>
                <p className="text-2xs text-muted-foreground mt-0.5">
                  {formatLongDate(data.joined_at)} 가입
                  {" · "}마지막 로그인 {data.user.last_login ? formatLongDate(data.user.last_login) : "기록 없음"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border p-2">
                <p className="text-lg font-bold tabular-nums">{data.open_issue_count}</p>
                <p className="text-2xs text-muted-foreground">맡은 미완료 이슈</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-lg font-bold tabular-nums">{data.active_api_tokens}</p>
                <p className="text-2xs text-muted-foreground">활성 API 토큰</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-lg font-bold">{data.has_personal_space ? "있음" : "없음"}</p>
                <p className="text-2xs text-muted-foreground">개인 스페이스</p>
              </div>
            </div>

            <Section title="프로젝트" count={data.projects.length}>
              {data.projects.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="w-12 shrink-0 font-mono text-2xs text-muted-foreground">{p.identifier}</span>
                  <span className="truncate">{p.name}</span>
                  {p.visibility === "private" && <span className="text-2xs text-muted-foreground">비공개</span>}
                  {p.trashed && <span className="text-2xs text-muted-foreground">휴지통</span>}
                  <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                    {p.is_lead && <span className="font-semibold text-primary mr-1">리드</span>}
                    {PROJECT_ROLE_LABEL[p.role] ?? p.role}
                  </span>
                </div>
              ))}
            </Section>

            <Section title="문서 스페이스" count={data.spaces.length}>
              {data.spaces.map((s) => (
                <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="truncate">{s.name}</span>
                  {s.is_private && <span className="text-2xs text-muted-foreground">비공개</span>}
                  <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{SPACE_ROLE_LABEL[s.role] ?? s.role}</span>
                </div>
              ))}
            </Section>

            <Section title="팀" count={data.teams.length}>
              {data.teams.map((t) => (
                <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="truncate">{t.name}</span>
                  {t.title && <span className="text-2xs text-muted-foreground">{t.title}</span>}
                  <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{TEAM_ROLE_LABEL[t.role] ?? t.role}</span>
                </div>
              ))}
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
