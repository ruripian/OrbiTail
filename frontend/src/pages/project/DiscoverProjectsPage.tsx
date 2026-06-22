import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Search, Globe } from "lucide-react";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Project } from "@/types";

export function DiscoverProjectsPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects-discover", workspaceSlug],
    queryFn: () => projectsApi.discover(workspaceSlug!),
  });

  // 참여 — MEMBER 로 합류해 편집 권한을 얻고 사이드바에 고정. '보기'와 구분된다.
  const joinMutation = useMutation({
    mutationFn: (projectId: string) => projectsApi.join(workspaceSlug!, projectId),
    onSuccess: (_, projectId) => {
      qc.invalidateQueries({ queryKey: ["projects", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["projects-discover", workspaceSlug] });
      toast.success(t("discover.joined", "프로젝트에 참여했습니다"));
      navigate(`/${workspaceSlug}/projects/${projectId}/issues`);
    },
    onError: () => toast.error(t("discover.joinFailed")),
  });

  // 보기 — 멤버십을 만들지 않고 공개 열람만. 편집은 백엔드가 차단한다.
  const openView = (projectId: string) =>
    navigate(`/${workspaceSlug}/projects/${projectId}/issues`);

  const filtered = projects.filter((p: Project) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-lg font-semibold">{t("discover.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("discover.subtitle")}</p>
      </div>

      {/* 검색 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("discover.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* 프로젝트 목록 */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("discover.loading")}</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Globe className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">{search ? t("discover.noResults") : t("discover.empty")}</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project: Project) => (
            <div
              key={project.id}
              className="flex items-center gap-4 rounded-xl border glass p-4"
            >
              {/* 아이콘 */}
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary shrink-0">
                {project.identifier[0]}
              </span>

              {/* 정보 */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{project.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {project.identifier} · {project.description || t("discover.noDescription")}
                </p>
              </div>

              {/* 보기(열람만) / 참여(멤버 합류) 분리 */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openView(project.id)}
                >
                  {t("discover.view", "보기")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => joinMutation.mutate(project.id)}
                  disabled={joinMutation.isPending}
                >
                  {t("discover.join", "참여")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
