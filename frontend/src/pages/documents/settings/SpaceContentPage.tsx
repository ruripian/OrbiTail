/**
 * 문서 스페이스 설정 · 콘텐츠 — 라벨 · 조회 통계 · 내보내기 · 템플릿.
 *
 * 휴지통은 설정이 아니라 전용 화면(DocumentTrashPage)에 있다 — 문서를 되찾는 건
 * 설정을 바꾸는 일이 아니라 목록을 훑고 고르는 작업이라서.
 */
import { useState, useRef } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload, FileText, Trash2 } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api-error";
import { useSpaceSettings } from "./DocumentSpaceSettingsLayout";

export default function SpaceContentPage() {
  const { t } = useTranslation();
  const { space, workspaceSlug, spaceId } = useSpaceSettings();
  const qc = useQueryClient();
  const [exporting, setExporting] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ["document-templates", workspaceSlug, "space", spaceId],
    queryFn: () => documentsApi.templates.list(workspaceSlug, undefined, spaceId),
    /* 워크스페이스 공유 + 이 스페이스 전용만 추려 보여준다 — 개인 템플릿은 남의 설정 화면에 뜰 이유가 없다 */
    select: (list) => list.filter((t) => t.scope === "workspace" || t.scope === "space"),
  });

  const { data: labels = [] } = useQuery({
    queryKey: ["document-labels", workspaceSlug],
    queryFn: () => documentsApi.labels.list(workspaceSlug),
  });

  const { data: analytics } = useQuery({
    queryKey: ["space-analytics", workspaceSlug, spaceId],
    queryFn: () => documentsApi.spaces.analytics(workspaceSlug, spaceId, 30),
  });

  const renameLabel = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name?: string; color?: string }) =>
      documentsApi.labels.update(workspaceSlug, id, { name, color }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-labels", workspaceSlug] }),
    onError: (e) => toast.error(apiErrorMessage(e, t("documents.content.labelUpdateFailed"))),
  });

  const deleteLabel = useMutation({
    mutationFn: (id: string) => documentsApi.labels.delete(workspaceSlug, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-labels", workspaceSlug] });
      toast.success(t("documents.content.labelDeleted"));
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("documents.content.labelDeleteFailed"))),
  });

  const handleExport = async (type: "html" | "md") => {
    setExporting(true);
    try {
      const blob = await documentsApi.spaces.exportZip(workspaceSlug, spaceId, type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${space.name}${type === "md" ? "-markdown" : ""}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(apiErrorMessage(e, t("documents.content.exportFailed")));
    } finally {
      setExporting(false);
    }
  };

  const importFile = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const r = await documentsApi.spaces.importMarkdown(workspaceSlug, spaceId, file);
      /* 건너뛴 파일이 있으면 조용히 넘기지 않는다 — 이미지·첨부는 문서로 만들 수 없다 */
      const skipped = r.skipped > 0 ? ` · ${t("documents.content.importSkipped", { count: r.skipped, examples: r.skipped_examples.slice(0, 2).join(", ") })}` : "";
      toast.success(t("documents.content.imported", { docs: r.created, folders: r.folders }) + skipped);
      qc.invalidateQueries({ queryKey: ["documents", workspaceSlug, spaceId] });
    } catch (e) {
      toast.error(apiErrorMessage(e, t("documents.content.importFailed")));
    } finally {
      setImporting(false);
      if (importFile.current) importFile.current.value = "";
    }
  };

  return (
    <div className="max-w-regular space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{t("documents.spaceSettings.content")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("documents.content.subtitle")}
        </p>
      </div>

      {/* 라벨 — 워크스페이스 단위라 여기서 고치면 다른 스페이스 문서에도 반영된다 */}
      <section className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">{t("documents.labelPicker.trigger")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("documents.content.labelsNote")}
          </p>
        </div>
        {labels.length === 0 ? (
          <p className="p-5 text-xs text-muted-foreground">
            {t("documents.content.labelsEmpty")}
          </p>
        ) : (
          <ul className="divide-y">
            {labels.map((label) => (
              <li key={label.id} className="flex items-center gap-3 px-5 py-2.5">
                <input
                  type="color"
                  value={label.color}
                  onChange={(e) => renameLabel.mutate({ id: label.id, color: e.target.value })}
                  className="h-5 w-5 rounded cursor-pointer border-0 bg-transparent p-0"
                  title={t("documents.content.changeColor")}
                />
                <input
                  defaultValue={label.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== label.name) renameLabel.mutate({ id: label.id, name });
                  }}
                  className="flex-1 bg-transparent text-sm outline-none focus:border-b focus:border-primary"
                />
                <span className="text-2xs text-muted-foreground shrink-0">{t("workspaceSettings.usage.docCount", { count: label.document_count })}</span>
                <button
                  onClick={() => {
                    if (window.confirm(t("documents.content.labelDeleteConfirm", { name: label.name }))) {
                      deleteLabel.mutate(label.id);
                    }
                  }}
                  className="text-muted-foreground hover:text-destructive p-1"
                  title={t("documents.content.deleteLabel")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 조회 통계 — 개인별 이력은 두지 않고 집계만 보여준다 */}
      <section className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">{t("documents.content.mostViewed")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("documents.content.viewStats", { views: analytics?.total_views ?? 0, viewers: analytics?.unique_viewers ?? 0 })}
          </p>
        </div>
        {!analytics || analytics.top_documents.length === 0 ? (
          <p className="p-5 text-xs text-muted-foreground">{t("documents.content.noViews")}</p>
        ) : (
          <ul className="divide-y">
            {analytics.top_documents.map((row, i) => (
              <li key={row.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="w-5 text-2xs font-mono text-muted-foreground shrink-0">{i + 1}</span>
                <span className="flex-1 truncate text-sm">{row.title}</span>
                <span className="text-2xs text-muted-foreground shrink-0">
                  {t("documents.content.rowStats", { views: row.views, viewers: row.viewers })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 내보내기 */}
      <section className="rounded-xl border bg-card p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{t("documents.content.exportTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
          <Trans i18nKey="documents.content.exportNote" components={{ c: <code className="mx-1" /> }} />
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" disabled={exporting} onClick={() => handleExport("md")}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {exporting ? t("documents.content.preparing") : t("documents.content.markdown")}
          </Button>
          <Button size="sm" variant="outline" disabled={exporting} onClick={() => handleExport("html")}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            HTML
          </Button>
        </div>
      </section>

      {/* 반입 */}
      <section className="rounded-xl border bg-card p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{t("documents.content.importTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
          <Trans i18nKey="documents.content.importNote" components={{ c: <code />, m: <code className="mx-1" /> }} />
          </p>
        </div>
        <div className="shrink-0">
          <input
            ref={importFile}
            type="file"
            accept=".md,.zip"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }}
          />
          <Button size="sm" variant="outline" disabled={importing} onClick={() => importFile.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            {importing ? t("documents.content.importing") : t("documents.content.pickFile")}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">{t("documents.content.templates")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("documents.content.templatesNote")}
          </p>
        </div>
        {templates.length === 0 ? (
          <p className="p-5 text-xs text-muted-foreground">{t("documents.content.templatesEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-center gap-3 px-5 py-2.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{tpl.name}</div>
                  {tpl.description && (
                    <div className="text-2xs text-muted-foreground truncate">{tpl.description}</div>
                  )}
                </div>
                <span className="text-2xs text-muted-foreground shrink-0">
                  {tpl.scope === "space" ? t("documents.content.spaceOnly") : t("documents.templates.workspaceShared")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
