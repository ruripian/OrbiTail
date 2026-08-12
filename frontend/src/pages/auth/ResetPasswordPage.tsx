import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/api-error";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { authApi } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard, AuthCardHeader } from "@/components/auth/AuthCard";

const schema = z.object({
  new_password: z.string().min(8, "Password must be at least 8 characters"),
  confirm_password: z.string().min(8),
}).refine((data) => data.new_password === data.confirm_password, {
  message: "Passwords do not match",
  path: ["confirm_password"],
});

type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      if (!token) throw new Error("No token provided.");
      return authApi.confirmPasswordReset({ token, new_password: data.new_password });
    },
    onSuccess: () => {
      toast.success(t("auth.resetPassword.success"));
      navigate("/auth/login");
    },
    /* err.message 폴백은 뺐다 — "Request failed with status code 400" 같은 내부 문구가 노출된다 */
    onError: (e) => toast.error(apiErrorMessage(e, t("auth.resetPassword.error"))),
  });

  if (!token) {
    return (
      <AuthCard className="">
        <AuthCardHeader subtitle={t("auth.resetPassword.invalidToken")} />
        <Button onClick={() => navigate("/auth/login")} className="w-full mt-4" variant="outline">
          {t("auth.verifyEmail.toLogin")}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard className="">
      <AuthCardHeader subtitle={t("auth.resetPassword.subtitle")} />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <div className="space-y-1.5 relative">
          <Label className="text-xs tracking-wide text-muted-foreground uppercase">
            {t("auth.resetPassword.newPassword")}
          </Label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              {...register("new_password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.new_password && (
            <p className="text-xs text-destructive">{errors.new_password.message}</p>
          )}
        </div>

        <div className="space-y-1.5 relative">
          <Label className="text-xs tracking-wide text-muted-foreground uppercase">
            {t("auth.resetPassword.confirmPassword")}
          </Label>
          <div className="relative">
            <Input
              type={showConfirm ? "text" : "password"}
              {...register("confirm_password")}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground hover:text-foreground"
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.confirm_password && (
            <p className="text-xs text-destructive">{errors.confirm_password.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full font-semibold tracking-widest" disabled={mutation.isPending}>
          {mutation.isPending ? t("auth.resetPassword.submitting") : t("auth.resetPassword.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
