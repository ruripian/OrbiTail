import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AutoArchivePage } from "./AutoArchivePage";
import { NotificationsPage as IntegrationsPage } from "./NotificationsPage";

/**
 * PASS4-3 — Automation: auto-archive + integrations 한 페이지 두 섹션.
 * deep-link: #auto-archive, #integrations 앵커.
 */
export function AutomationPage() {
  const { t } = useTranslation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  return (
    <div className="max-w-4xl space-y-12">
      <header>
        <h1 className="text-xl font-semibold">{t("project.settings.tabs.automation")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("project.settings.automation.subtitle", "정책 — 자동 보관과 외부 통합")}
        </p>
      </header>

      <section id="auto-archive"><AutoArchivePage /></section>
      <hr className="border-border" />
      <section id="integrations"><IntegrationsPage /></section>
    </div>
  );
}
