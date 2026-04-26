import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * DangerZone — 위험한 액션(계정 탈퇴, 프로젝트 archive/leave/delete)을 위한 통합 컴포넌트.
 *
 * confirmText 가 있으면 정확히 입력해야 버튼 활성화.
 * requiresPassword 가 true 면 비밀번호 input 추가.
 * severity="subtle" 은 archive/leave 같은 약한 위험, "destructive" 는 delete 같은 강한 위험.
 *
 * 모달이 필요한 경우 외부에서 <Dialog><DangerZone/></Dialog> 로 감싸 사용. 컴포넌트 자체는 layout-agnostic.
 */
export interface DangerZoneProps {
  title: string;
  description: string;
  /** 사용자가 정확히 입력해야 confirm 활성. undefined 면 input 없이 바로 활성 */
  confirmText?: string;
  /** confirm input placeholder ("Type \"DELETE\""). 미지정 시 자동 생성 */
  confirmPlaceholder?: string;
  /** 비밀번호 input 표시 여부. 보통 계정 탈퇴에만 true */
  requiresPassword?: boolean;
  passwordPlaceholder?: string;
  buttonLabel: string;
  onConfirm: (params: { password?: string }) => void | Promise<void>;
  isPending?: boolean;
  severity?: "subtle" | "destructive";
  /** 추가 컨테이너 클래스 */
  className?: string;
}

export function DangerZone({
  title,
  description,
  confirmText,
  confirmPlaceholder,
  requiresPassword = false,
  passwordPlaceholder = "Password",
  buttonLabel,
  onConfirm,
  isPending = false,
  severity = "destructive",
  className,
}: DangerZoneProps) {
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");

  const isReady =
    (!confirmText || confirm === confirmText) &&
    (!requiresPassword || password.length > 0);

  const handleClick = async () => {
    if (!isReady || isPending) return;
    await onConfirm({ password: requiresPassword ? password : undefined });
    /* 액션 후 입력 초기화 — 같은 zone 재사용 시 stale 입력 방지 */
    setConfirm("");
    setPassword("");
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        severity === "destructive"
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-muted/30",
        className,
      )}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground whitespace-pre-line">{description}</p>

      {requiresPassword && (
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={passwordPlaceholder}
          autoComplete="current-password"
          className="mt-3"
        />
      )}

      {confirmText && (
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={confirmPlaceholder ?? `Type "${confirmText}"`}
          className="mt-2 font-mono"
        />
      )}

      <Button
        variant={severity === "destructive" ? "destructive" : "outline"}
        size="sm"
        disabled={!isReady || isPending}
        onClick={handleClick}
        className="mt-3"
      >
        {isPending ? "..." : buttonLabel}
      </Button>
    </div>
  );
}
