/**
 * 보관된 프로젝트 목록 — 보관 해제 가능.
 * 아래에 휴지통(삭제한 프로젝트)을 함께 둔다 — "지운 프로젝트가 어디 갔나"를 찾는 곳이 여기다.
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { projectsApi, type TrashedProject } from "@/api/projects";
import { apiErrorMessage } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Project } from "@/types";

export function ArchivedProjectsPage() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const qc = useQueryClient();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", workspaceSlug, { archived: "true" }],
    queryFn: () => projectsApi.list(workspaceSlug!, { archived: "true" }),
    enabled: !!workspaceSlug,
  });

  const archivedProjects = projects.filter((p: Project) => p.archived_at !== null);

  const unarchiveMutation = useMutation({
    mutationFn: (projectId: string) => projectsApi.unarchive(workspaceSlug!, projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", workspaceSlug] });
      toast.success(t("project.settings.general.unarchived"));
    },
  });

  const { data: trashed = [] } = useQuery({
    queryKey: ["projects-trash", workspaceSlug],
    queryFn: () => projectsApi.trash.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const [purging, setPurging] = useState<TrashedProject | null>(null);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["projects-trash", workspaceSlug] });
    qc.invalidateQueries({ queryKey: ["projects", workspaceSlug] });
  };
  const restoreMutation = useMutation({
    mutationFn: (projectId: string) => projectsApi.trash.restore(workspaceSlug!, projectId),
    onSuccess: () => { refreshAll(); toast.success(t("archivedProjects.restored")); },
    onError: (e) => toast.error(apiErrorMessage(e, t("archivedProjects.failed"))),
  });
  const purgeMutation = useMutation({
    mutationFn: (projectId: string) => projectsApi.trash.purge(workspaceSlug!, projectId),
    onSuccess: () => { refreshAll(); setPurging(null); toast.success(t("archivedProjects.purged")); },
    onError: (e) => toast.error(apiErrorMessage(e, t("archivedProjects.failed"))),
  });

  const daysLeft = (purgeAt: string) =>
    Math.max(0, Math.ceil((new Date(purgeAt).getTime() - Date.now()) / 86_400_000));

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading...</div>;
  }

  return (
    <div className="p-8 max-w-regular">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">{t("sidebar.archived")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("archivedProjects.subtitle")}</p>
      </div>

      {archivedProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
          <Archive className="h-10 w-10 opacity-30" />
          <p className="text-sm">{t("archivedProjects.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {archivedProjects.map((project: Project) => (
            <div
              key={project.id}
              className="flex items-center gap-4 rounded-xl border glass p-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{project.name}</p>
                <p className="text-xs text-muted-foreground truncate">{project.identifier}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => unarchiveMutation.mutate(project.id)}
                disabled={unarchiveMutation.isPending}
              >
                <RotateCcw className="h-3 w-3" />
                {t("views.archive.restore")}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10 mb-4">
        <h2 className="text-base font-semibold flex items-center gap-1.5">
          <Trash2 className="h-4 w-4" />
          {t("archivedProjects.trashTitle")}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">{t("archivedProjects.trashSubtitle")}</p>
      </div>
      {trashed.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{t("archivedProjects.trashEmpty")}</p>
      ) : (
        <div className="space-y-2">
          {trashed.map((project) => (
            <div key={project.id} className="flex items-center gap-4 rounded-xl border glass p-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{project.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {project.identifier}
                  {project.deleted_by && <> · {t("archivedProjects.deletedBy", { name: project.deleted_by })}</>}
                  {" · "}
                  <span className="text-amber-600 dark:text-amber-400">
                    {t("archivedProjects.daysLeft", { days: daysLeft(project.purge_at) })}
                  </span>
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => restoreMutation.mutate(project.id)}
                disabled={restoreMutation.isPending}
              >
                <RotateCcw className="h-3 w-3" />
                {t("archivedProjects.restore")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setPurging(project)}
              >
                {t("archivedProjects.purge")}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!purging}
        onOpenChange={(o) => { if (!o) setPurging(null); }}
        title={t("archivedProjects.purgeTitle", { name: purging?.name ?? "" })}
        description={t("archivedProjects.purgeDescription")}
        confirmLabel={t("archivedProjects.purge")}
        variant="destructive"
        loading={purgeMutation.isPending}
        onConfirm={() => { if (purging) purgeMutation.mutate(purging.id); }}
      />
    </div>
  );
}
