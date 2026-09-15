/**
 * 팀 상세(홈) 페이지 — /<ws>/teams/<teamId>.
 *
 * 구성:
 *   - 헤더: 팀 아이콘/이름/설명 + 멤버 스택 + [설정] (admin 만)
 *   - 캘린더 (전체폭) — 멤버별 표시 토글은 캘린더 자체의 멤버 칩 바가 담당
 *
 * 편집·삭제·멤버 관리는 /settings 하위로 옮겼다. 이 화면은 매일 보는 캘린더가 주인공이다.
 */
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Settings, Shield } from "lucide-react";
import { teamsApi } from "@/api/teams";
import { TeamCalendarSection } from "./TeamCalendarSection";
import { TeamAvatar } from "./TeamAvatar";
import { Button } from "@/components/ui/button";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/types";

export function TeamDetailPage() {
  const { workspaceSlug = "", teamId = "" } = useParams<{ workspaceSlug: string; teamId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();

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

  if (isLoading) {
    return <div className="p-10 text-sm text-muted-foreground text-center">{t("team.loading")}</div>;
  }
  if (!team) {
    return <div className="p-10 text-sm text-muted-foreground text-center">{t("team.notFound")}</div>;
  }

  const isAdmin = team.my_role === 20;
  const settingsPath = `/${workspaceSlug}/teams/${teamId}/settings/general`;

  return (
    <div className="h-full overflow-y-auto bg-background">
      {/* 헤더와 캘린더 모두 전체폭 — 폭 제약을 걸면 넓은 화면에서 헤더가 캘린더 카드보다
          안쪽으로 들어가 좌우 모서리가 어긋난다 */}
      <div className="px-6 pt-8 pb-6">
        <button
          onClick={() => navigate(`/${workspaceSlug}/teams`)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("team.backToList")}
        </button>

        <header className="flex items-start gap-4 mb-8">
          <TeamAvatar team={team} box={56} className="rounded-xl" />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">{team.name}</h1>
            {team.description && (
              <p className="text-sm text-muted-foreground mt-1">{team.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <MemberStack workspaceSlug={workspaceSlug} teamId={teamId} members={members} />
            {isAdmin && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link to={settingsPath}>
                  <Settings className="h-3.5 w-3.5" />
                  {t("team.home.settings")}
                </Link>
              </Button>
            )}
          </div>
        </header>

        <section className="mb-6">
          <TeamCalendarSection
            workspaceSlug={workspaceSlug}
            teamId={teamId}
            teamMembers={members}
          />
        </section>
      </div>
    </div>
  );
}

/* ────────────── 헤더 멤버 스택 ──────────────
 * 캘린더가 85vh 라 멤버 목록을 아래에 두면 스크롤해야 보인다. 헤더로 올려 항상 보이게 한다.
 *
 * 직책(title)을 보여주는 곳이 여기다 — 설정 › 멤버 밖에서 직책이 보이는 유일한 화면.
 *   - 아바타 hover: "이름 · 직책" 툴팁 (한 명만 빠르게 확인)
 *   - 스택 클릭:    팀 명단 팝오버 (여러 명을 훑어볼 때)
 * 직책은 팀 단위 값이라 이슈 담당자·멘션 같은 팀 밖 화면에는 쓸 수 없다
 * (같은 사람이 팀마다 다른 직책을 가질 수 있어 어느 것을 보여줄지 정할 수 없다). */
function MemberStack({
  workspaceSlug, teamId, members,
}: {
  workspaceSlug: string;
  teamId: string;
  members: TeamMember[];
}) {
  const { t } = useTranslation();
  const SHOWN = 4;
  const rest = members.length - SHOWN;

  if (members.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg border px-2 py-1.5 hover:bg-accent/40 transition-colors"
        >
          <span className="flex -space-x-2">
            {members.slice(0, SHOWN).map((m) => (
              <Tooltip
                key={m.id}
                content={
                  m.title ? `${m.member.display_name} · ${m.title}` : m.member.display_name
                }
              >
                <span className="ring-2 ring-background rounded-full">
                  <AvatarInitials
                    name={m.member.display_name}
                    avatar={m.member.avatar}
                    size="xs"
                  />
                </span>
              </Tooltip>
            ))}
            {rest > 0 && (
              <span className="ring-2 ring-background rounded-full h-5 w-5 flex items-center justify-center bg-muted text-2xs font-medium text-muted-foreground">
                +{rest}
              </span>
            )}
          </span>
          <span className="text-2xs text-muted-foreground">
            {t("team.memberCount", { count: members.length })}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-0">
        <p className="px-3 pt-3 pb-2 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("team.home.membersTitle")}
        </p>
        <ul className="max-h-72 overflow-y-auto">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 px-3 py-2">
              <AvatarInitials
                name={m.member.display_name}
                avatar={m.member.avatar}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{m.member.display_name}</p>
                <p
                  className={cn(
                    "text-2xs truncate",
                    m.title ? "text-muted-foreground" : "text-muted-foreground/50 italic",
                  )}
                >
                  {m.title || t("team.home.noTitle")}
                </p>
              </div>
              {m.role === 20 && (
                <Shield className="h-3 w-3 shrink-0 text-primary" aria-label={t("team.role.admin")} />
              )}
            </li>
          ))}
        </ul>
        <div className="border-t px-3 py-2">
          <Link
            to={`/${workspaceSlug}/teams/${teamId}/settings/members`}
            className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("team.home.manageMembers")} →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
