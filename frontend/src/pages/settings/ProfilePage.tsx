import { useRef, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Trash2, User as UserIcon } from "lucide-react";
import { settingsApi } from "@/api/settings";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarCropDialog } from "@/components/ui/avatar-crop-dialog";

export function ProfilePage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);

  // ── 프로필 폼 스키마 (t() 사용을 위해 컴포넌트 내부에 정의) ──
  const profileSchema = z.object({
    display_name: z.string().min(1, t("settings.profile.displayNameRequired")),
    first_name: z.string().max(50).optional(),
    last_name: z.string().max(50).optional(),
  });
  type ProfileForm = z.infer<typeof profileSchema>;

  // ── 프로필 수정 ───────────────────────────────────────
  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: user?.display_name ?? "",
      first_name: user?.first_name ?? "",
      last_name: user?.last_name ?? "",
    },
  });

  const profileMutation = useMutation({
    mutationFn: (data: ProfileForm) => settingsApi.updateProfile(data),
    onSuccess: (updated) => {
      updateUser(updated);
      toast.success(t("common.profileSaved"));
    },
    onError: () => toast.error(t("common.profileSaveFailed")),
  });

  // ── 아바타 업로드/삭제 ───────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

  // 크롭 다이얼로그 — 파일 선택 시 objectURL 을 만들어 넘기고, 닫힐 때 해제.
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  const avatarUploadMutation = useMutation({
    mutationFn: (file: File | Blob) => {
      // Blob 인 경우 File 로 래핑 (파일명/확장자 보존)
      const f = file instanceof File ? file : new File([file], "avatar.jpg", { type: "image/jpeg" });
      return settingsApi.uploadAvatar(f);
    },
    onSuccess: (updated) => {
      updateUser(updated);
      setCropSrc(null);
      toast.success(t("settings.profile.avatarUpdated", "프로필 사진이 변경되었습니다."));
    },
    onError: () =>
      toast.error(t("settings.profile.avatarUpdateFailed", "프로필 사진 변경에 실패했습니다.")),
  });

  const avatarRemoveMutation = useMutation({
    mutationFn: () => settingsApi.removeAvatar(),
    onSuccess: (updated) => {
      updateUser(updated);
      toast.success(t("settings.profile.avatarRemoved", "프로필 사진이 삭제되었습니다."));
    },
    onError: () =>
      toast.error(t("settings.profile.avatarRemoveFailed", "프로필 사진 삭제에 실패했습니다.")),
  });

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("settings.profile.avatarInvalidType", "이미지 파일만 업로드할 수 있습니다."));
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t("settings.profile.avatarTooLarge", "5MB 이하 이미지만 업로드할 수 있습니다."));
      return;
    }
    // 크롭 다이얼로그로 이미지 넘김 — 확정 시 blob 업로드
    setCropSrc(URL.createObjectURL(file));
  };

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-lg font-semibold">{t("settings.profile.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("settings.profile.subtitle")}
        </p>
      </div>

      {/* ── 아바타 섹션 ── */}
      <div className="flex items-center gap-5">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border flex items-center justify-center">
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserIcon className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarSelect}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploadMutation.isPending}
            >
              <Upload className="mr-2 h-3.5 w-3.5" />
              {avatarUploadMutation.isPending
                ? t("settings.profile.avatarUploading", "업로드 중...")
                : t("settings.profile.avatarUpload", "사진 업로드")}
            </Button>
            {user?.avatar && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => avatarRemoveMutation.mutate()}
                disabled={avatarRemoveMutation.isPending}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                {t("settings.profile.avatarRemove", "삭제")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.profile.avatarHint", "PNG/JPG, 최대 5MB")}
          </p>
        </div>
      </div>

      <hr className="border-border" />

      {/* ── 프로필 섹션 ── */}
      <form
        onSubmit={profileForm.handleSubmit((d) => profileMutation.mutate(d))}
        className="space-y-5"
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="first_name">{t("settings.profile.firstName")}</Label>
            <Input id="first_name" {...profileForm.register("first_name")} placeholder={t("settings.profile.firstNamePlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last_name">{t("settings.profile.lastName")}</Label>
            <Input id="last_name" {...profileForm.register("last_name")} placeholder={t("settings.profile.lastNamePlaceholder")} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="display_name">{t("settings.profile.displayName")}</Label>
          <Input
            id="display_name"
            {...profileForm.register("display_name")}
            placeholder={t("settings.profile.displayNameHint")}
          />
          {profileForm.formState.errors.display_name && (
            <p className="text-xs text-destructive">
              {profileForm.formState.errors.display_name.message}
            </p>
          )}
        </div>

        <Button type="submit" size="sm" disabled={profileMutation.isPending}>
          {profileMutation.isPending ? t("settings.profile.saving") : t("settings.profile.save")}
        </Button>
      </form>

      {/* ── 구분선 ── */}
      <hr className="border-border" />

      {/* ── 이메일 (읽기 전용) — PASS3-1: input 어포던스 제거, 평문 + 변경 안내 */}
      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("settings.profile.emailTitle")}
        </Label>
        <p className="mt-1 text-sm font-medium">{user?.email}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.profile.emailChangeHint")}
        </p>
      </div>

      {/* ── 프로필 사진 크롭 다이얼로그 ── */}
      {cropSrc && (
        <AvatarCropDialog
          open={!!cropSrc}
          onOpenChange={(o) => {
            if (!o) setCropSrc(null);
          }}
          imageSrc={cropSrc}
          isPending={avatarUploadMutation.isPending}
          onConfirm={(blob) => avatarUploadMutation.mutate(blob)}
        />
      )}
    </div>
  );
}
