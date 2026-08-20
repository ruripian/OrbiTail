import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, FolderKanban, FileText, CalendarRange } from "lucide-react";
import { toast } from "sonner";

import { demoApi } from "@/api/demo";
import { AuthCard, AuthCardHeader } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";

/** 데모 배포의 첫 화면.
 *
 *  샌드박스는 이 화면의 버튼을 눌러야 만들어진다. 페이지 진입만으로 만들면
 *  크롤러가 훑을 때마다 워크스페이스가 생성되므로, 클릭을 한 단계 둔다. */
export function DemoLandingPage({ ttlHours, onStart }: { ttlHours: number | null; onStart: () => void }) {
  const { t } = useTranslation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const startDemo = useDemoStore((s) => s.startDemo);

  const { mutate, isPending } = useMutation({
    mutationFn: demoApi.createSession,
    onSuccess: (data) => {
      setAuth(data.user, data.access, data.refresh);
      startDemo(data.expires_at);
      onStart();
    },
    onError: () => toast.error(t("demo.startFailed")),
  });

  const highlights = [
    { icon: FolderKanban, text: t("demo.highlightIssues") },
    { icon: FileText, text: t("demo.highlightDocs") },
    { icon: CalendarRange, text: t("demo.highlightPlanning") },
  ];

  return (
    <AuthCard>
      <AuthCardHeader subtitle={t("demo.subtitle")} />

      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("demo.description")}
      </p>

      <ul className="mt-5 space-y-2.5">
        {highlights.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2.5 text-sm text-foreground">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{text}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-sm border border-dashed px-3.5 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {ttlHours
            ? t("demo.noticeWithTtl", { hours: ttlHours })
            : t("demo.notice")}
        </p>
      </div>

      <Button className="mt-6 w-full" onClick={() => mutate()} disabled={isPending}>
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isPending ? t("demo.starting") : t("demo.start")}
      </Button>
    </AuthCard>
  );
}
