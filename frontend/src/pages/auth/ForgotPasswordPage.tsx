import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/api-error";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { authApi } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard, AuthCardHeader } from "@/components/auth/AuthCard";

const schema = z.object({
  email: z.string().email(),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [isSuccess, setIsSuccess] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: authApi.requestPasswordReset,
    onSuccess: () => {
      setIsSuccess(true);
      toast.success(t("auth.forgotPassword.successToast"));
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("auth.forgotPassword.error"))),
  });

  return (
    <AuthCard className="">
      <AuthCardHeader subtitle={t("auth.forgotPassword.subtitle")} />

      {isSuccess ? (
        <div className="py-6 flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8"></path><polyline points="22 7 12 14 2 7"></polyline><path d="m16 19 2 2 4-4"></path></svg>
          </div>
          <p className="text-sm font-medium">
            {t("auth.forgotPassword.successTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("auth.forgotPassword.successDesc")}
          </p>
          <Button onClick={() => navigate("/auth/login")} className="mt-4" variant="outline">
            {t("auth.verifyEmail.toLogin")}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4 mt-4">
          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("auth.login.email")}
            </Label>
            <Input
              type="email"
              placeholder={t("auth.login.emailPlaceholder")}
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          <Button type="submit" className="w-full font-semibold tracking-widest" disabled={mutation.isPending}>
            {mutation.isPending ? t("auth.forgotPassword.submitting") : t("auth.forgotPassword.submit")}
          </Button>
          
          <p className="mt-7 text-center text-xs text-muted-foreground">
            <Link to="/auth/login" className="text-primary hover:text-primary/80 font-medium transition-colors">
              {t("auth.verifyEmail.toLogin")}
            </Link>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
