import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { workspacesApi } from "@/api/workspaces";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
});

type FormValues = z.infer<typeof schema>;

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { setCurrentWorkspace } = useWorkspaceStore();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const handleLogout = () => {
    clearAuth();
    navigate("/auth/login");
  };

  /* 비슈퍼어드민은 워크스페이스 생성 불가 → 선택 페이지로 리다이렉트 */
  useEffect(() => {
    if (user && !user.is_staff) {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: workspacesApi.create,
    onSuccess: (workspace) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setCurrentWorkspace(workspace);
      navigate(`/${workspace.slug}`);
    },
    onError: () => {
      toast.error(t("workspace.create.error"));
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center relative">
      {/* 우측 상단 — 현재 로그인 계정 + 로그아웃 */}
      {user && (
        <div className="absolute top-4 right-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate max-w-[200px]">{user.email}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted/60 hover:text-foreground transition-colors"
            title={t("sidebar.logout")}
          >
            <LogOut className="h-3.5 w-3.5" />
            {t("sidebar.logout")}
          </button>
        </div>
      )}

      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-xl font-bold">{t("workspace.create.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("workspace.create.subtitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">{t("workspace.create.name")}</Label>
            <Input
              id="name"
              placeholder={t("workspace.create.namePlaceholder")}
              {...register("name")}
              onChange={(e) => {
                setValue("name", e.target.value);
                setValue("slug", e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
              }}
            />
            {errors.name && <p className="text-xs text-destructive">{t("workspace.create.nameRequired")}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="slug">{t("workspace.create.slug")}</Label>
            <Input id="slug" {...register("slug")} />
            {errors.slug && <p className="text-xs text-destructive">{t("workspace.create.slugInvalid")}</p>}
          </div>

          {mutation.isError && (
            <p className="text-xs text-destructive">{t("workspace.create.error")}</p>
          )}

          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? t("workspace.create.submitting") : t("workspace.create.submit")}
          </Button>
        </form>
      </div>
    </div>
  );
}
