import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard, AuthCardHeader } from "@/components/auth/AuthCard";
import { OrbiTailOrbit } from "@/components/auth/OrbiTailOrbit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect");

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setAuth(data.user, data.access, data.refresh);
      // 초대 등에서 redirect 파라미터가 있으면 해당 경로로 이동
      navigate(redirectTo || "/");
    },
    onError: () => {
      toast.error(t("auth.login.error"));
    },
  });

  return (
    <>
      <OrbiTailOrbit size={1200} strokeW={5} offsetY={-40} />
      <AuthCard>
        <AuthCardHeader subtitle={t("auth.login.subtitle")} />

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("auth.login.email")}
            </Label>
            <Input
              type="email"
              placeholder={t("auth.login.emailPlaceholder")}
              tabIndex={1}
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("auth.login.password")}
            </Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder={t("auth.login.passwordPlaceholder")}
                tabIndex={2}
                {...register("password")}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          {mutation.isError && (
            <p className="text-xs text-destructive">{t("auth.login.error")}</p>
          )}

          <Button type="submit" tabIndex={3} className="w-full font-semibold tracking-widest" disabled={mutation.isPending}>
            {mutation.isPending ? t("auth.login.submitting") : t("auth.login.submit")}
          </Button>
        </form>

        <div className="mt-5 flex flex-col items-center justify-center space-y-4 text-xs text-muted-foreground">
          <p>
            {t("auth.login.noAccount")}{" "}
            <Link to="/auth/register" className="text-primary hover:text-primary/80 font-medium transition-colors">
              {t("auth.login.signUpLink")}
            </Link>
          </p>

          <Link
            to="/auth/forgot-password"
            className="text-muted-foreground hover:text-primary transition-colors hover:underline underline-offset-4"
          >
            {t("auth.login.forgotPassword")}
          </Link>
        </div>
      </AuthCard>
    </>
  );
}
