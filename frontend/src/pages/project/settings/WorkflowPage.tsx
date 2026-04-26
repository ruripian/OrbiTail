import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { StatesPage } from "./StatesPage";
import { LabelsPage } from "./LabelsPage";

/**
 * PASS4-3 — Workflow: states + labels 한 페이지 두 섹션. Templates 는 3-bis 에서 contextual 화.
 *
 * deep-link: #states, #labels 앵커 — 섹션에 id 부여, hash 가 있으면 진입 시 scroll.
 * 기존 StatesPage / LabelsPage 자체를 그대로 import (각자 자체 h1 보유 → 섹션 헤더로 동작).
 */
export function WorkflowPage() {
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
        <h1 className="text-xl font-semibold">{t("project.settings.tabs.workflow")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("project.settings.workflow.subtitle", "이슈를 분류하는 도구 — 상태와 라벨")}
        </p>
      </header>

      <section id="states"><StatesPage /></section>
      <hr className="border-border" />
      <section id="labels"><LabelsPage /></section>
    </div>
  );
}
