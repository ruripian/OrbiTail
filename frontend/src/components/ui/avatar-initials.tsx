import { cn } from "@/lib/utils";

/**
 * AvatarInitials — 사용자 원형 아바타
 *
 * avatar URL 이 있으면 이미지를, 없으면 이름 첫 글자 이니셜을 표시.
 * 이미지 로딩 실패 시에도 이니셜 fallback.
 *
 * 재사용 대상: 이슈 목록/담당자/멤버 리스트/멘션/TopBar 등 프로젝트 전반
 */

type AvatarSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "h-5 w-5 text-3xs",
  sm: "h-6 w-6 text-2xs",
  md: "h-7 w-7 text-xs",
  lg: "h-9 w-9 text-sm",
};

export interface AvatarInitialsProps {
  /** 표시 이름(첫 글자만 이니셜로 사용) */
  name: string | null | undefined;
  /** 프로필 사진 URL — 있으면 이미지 우선, 실패 시 이니셜 fallback */
  avatar?: string | null | undefined;
  /** 크기 (기본 sm = h-6 w-6) */
  size?: AvatarSize;
  /** 툴팁 */
  title?: string;
  /** 추가 클래스 */
  className?: string;
  /** 테두리(ring) 표시 — 겹친 아바타 리스트용 */
  ring?: boolean;
}

export function AvatarInitials({
  name,
  avatar,
  size = "sm",
  title,
  className,
  ring = false,
}: AvatarInitialsProps) {
  const initial = name?.[0]?.toUpperCase() ?? "?";
  const hasAvatar = !!avatar && avatar.trim().length > 0;
  return (
    <span
      title={title ?? name ?? undefined}
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-full bg-primary/20 font-bold text-primary shrink-0",
        SIZE_CLASSES[size],
        ring && "border-2 border-background",
        className,
      )}
    >
      {hasAvatar ? (
        <img
          src={avatar!}
          alt=""
          className="h-full w-full object-cover"
          onError={(e) => {
            // 이미지 로드 실패 시 이니셜 fallback — img 숨기면 부모의 배경/글자가 보임
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        initial
      )}
    </span>
  );
}
