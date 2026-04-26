import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { AuthCard, AuthCardHeader } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/button";

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [autoRequested, setAutoRequested] = useState<string | null>(null);

  const verifyMutation = useMutation({
    mutationFn: authApi.verifyEmail,
    onSuccess: (data: any) => {
      setStatus("success");
      setAutoRequested(data?.auto_requested_workspace ?? null);
    },
    onError: (err: any) => {
      setStatus("error");
      setErrorMessage(err.response?.data?.detail || t("auth.verifyEmail.defaultError"));
    },
  });

  useEffect(() => {
    if (token) {
      verifyMutation.mutate({ token });
    } else {
      setStatus("error");
      setErrorMessage(t("auth.verifyEmail.invalidAccess"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <AuthCard>
      <AuthCardHeader subtitle={t("auth.verifyEmail.title")} />

      <div className="py-6 flex flex-col items-center justify-center text-center space-y-4">
        {status === "loading" && (
          <p className="text-sm text-muted-foreground animate-pulse">
            {t("auth.verifyEmail.loading")}
          </p>
        )}

        {status === "success" && (
          <>
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            <p className="text-sm font-medium">
              {t("auth.verifyEmail.successTitle")}
            </p>
            <p className="text-xs text-muted-foreground">
              {autoRequested
                ? t("auth.verifyEmail.successAutoRequested", "워크스페이스 가입 신청이 자동으로 등록되었습니다. 워크스페이스 관리자의 승인을 기다려 주세요.")
                : t("auth.verifyEmail.successDesc")}
            </p>
            <Button onClick={() => navigate("/auth/login")} className="mt-4" variant="outline">
              {t("auth.verifyEmail.toLogin")}
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center text-destructive mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            </div>
            <p className="text-sm font-medium text-destructive">
              {t("auth.verifyEmail.errorTitle")}
            </p>
            <p className="text-xs text-muted-foreground">{errorMessage}</p>
            <Button onClick={() => navigate("/auth/login")} className="mt-4" variant="outline">
              {t("auth.verifyEmail.toLogin")}
            </Button>
          </>
        )}
      </div>
    </AuthCard>
  );
}
