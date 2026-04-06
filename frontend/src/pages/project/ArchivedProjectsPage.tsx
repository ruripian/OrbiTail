/**
 * 보관된 프로젝트 목록 — 보관 해제 가능
 */
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Archive, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
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

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading...</div>;
  }

  return (
    <div className="p-8 max-w-3xl">
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
    </div>
  );
}
