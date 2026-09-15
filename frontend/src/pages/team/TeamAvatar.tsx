/**
 * 팀 아바타 — icon_prop 이 있으면 ProjectIcon, 없으면 기존 첫 글자 아바타.
 *
 * 아이콘을 한 번도 지정하지 않은 팀에 ProjectIcon 기본값(Box)을 그리면 모든 팀이
 * 같은 모양이 된다. 기존 동작(첫 글자 + Team.color)을 fallback 으로 유지해
 * 아이콘을 설정한 팀만 아이콘으로 바뀌게 한다.
 */
import { ProjectIcon } from "@/components/ui/project-icon-picker";
import { cn } from "@/lib/utils";
import type { Team } from "@/types";

export function TeamAvatar({
  team, box, className,
}: {
  team: Pick<Team, "name" | "color" | "icon_prop">;
  /** 컨테이너 한 변 크기(px) */
  box: number;
  className?: string;
}) {
  if (team.icon_prop) {
    return (
      <ProjectIcon
        value={team.icon_prop}
        box={box}
        size={Math.round(box * 0.5)}
        className={cn("shrink-0", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg flex items-center justify-center font-bold shrink-0 bg-primary/10 text-primary",
        className,
      )}
      style={{
        width: box,
        height: box,
        fontSize: Math.round(box * 0.4),
        ...(team.color ? { backgroundColor: `${team.color}22`, color: team.color } : {}),
      }}
    >
      {team.name.charAt(0).toUpperCase()}
    </div>
  );
}
