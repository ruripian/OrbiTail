import { AvatarInitials } from "./avatar-initials";
import { formatRelativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

interface Props {
  name: string | null | undefined;
  avatar?: string | null;
  timestamp: string;
  editedAt?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}

/** 아바타 + 이름 + 상대 시간. 카드 헤더 공통 */
export function UserLine({ name, avatar, timestamp, editedAt, size = "sm", className }: Props) {
  const displayName = name || "—";
  const edited = editedAt && new Date(editedAt).getTime() - new Date(timestamp).getTime() > 2000;
  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      <AvatarInitials name={displayName} avatar={avatar} size={size} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold truncate text-foreground leading-tight">{displayName}</p>
        <p className="text-2xs text-muted-foreground leading-tight mt-0.5">
          {formatRelativeTime(timestamp)}
          {edited && <span className="ml-1 text-muted-foreground/70">· edited</span>}
        </p>
      </div>
    </div>
  );
}
