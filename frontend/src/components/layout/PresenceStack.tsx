import { useAuthStore } from "@/stores/authStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { AvatarInitials } from "@/components/ui/avatar-initials";

/**
 * PresenceStack — 워크스페이스에 현재 접속 중인 다른 사용자 아바타 stack (PASS10).
 *
 * useWebSocket 이 서버 presence.update 를 받으면 store 갱신 → 자동 리렌더.
 * 본인은 표시 X. 최대 5명 + "+N more".
 */

const MAX_VISIBLE = 5;

export function PresenceStack() {
  const me = useAuthStore((s) => s.user);
  const users = usePresenceStore((s) => s.users);

  /* 본인 제외 */
  const others = users.filter((u) => u.id !== me?.id);
  if (others.length === 0) return null;

  const visible = others.slice(0, MAX_VISIBLE);
  const overflow = others.length - visible.length;

  return (
    <div
      className="flex -space-x-1.5"
      role="group"
      aria-label={`접속 중인 사용자 ${others.length}명`}
    >
      {visible.map((u) => (
        <div key={u.id} title={u.display_name} className="relative">
          <AvatarInitials name={u.display_name} avatar={u.avatar ?? undefined} size="xs" ring />
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-background"
          />
        </div>
      ))}
      {overflow > 0 && (
        <span
          className="h-5 w-5 rounded-full bg-muted text-3xs flex items-center justify-center border-2 border-background text-muted-foreground"
          title={`+${overflow}명 더`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
