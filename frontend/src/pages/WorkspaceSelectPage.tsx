import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { workspacesApi } from "@/api/workspaces";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";

export function WorkspaceSelectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { setCurrentWorkspace } = useWorkspaceStore();
  const user = useAuthStore((s) => s.user);
  // ?switch=1 쿼리가 있으면 "명시적 전환" 의도 — 워크스페이스가 1개뿐이어도 자동 진입 안 함
  const [searchParams] = useSearchParams();
  const explicitSwitch = searchParams.get("switch") === "1";

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: workspacesApi.list,
  });

  /* 워크스페이스 삭제 — 슈퍼어드민/Owner 전용. 프론트 표시는 is_staff만 */
  const deleteMutation = useMutation({
    mutationFn: (slug: string) => workspacesApi.delete(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success(t("workspaceSelect.deleteSuccess"));
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail ?? t("workspaceSelect.deleteFailed"));
    },
  });

  const handleDelete = (e: React.MouseEvent, slug: string, name: string) => {
    e.stopPropagation();
    const typed = window.prompt(t("workspaceSelect.deleteConfirm", { name }));
    if (typed === name) {
      deleteMutation.mutate(slug);
    } else if (typed !== null) {
      toast.error(t("workspaceSelect.deleteMismatch"));
    }
  };

  useEffect(() => {
    if (isLoading) return;
    // 명시적 전환 의도(?switch=1)면 자동 진입 생략 — 전환 페이지로 왔는데 바로 되돌아가는 flicker 방지
    if (explicitSwitch) return;
    // 워크스페이스가 정확히 1개만 있을 때만 자동 진입
    if (workspaces.length === 1) {
      setCurrentWorkspace(workspaces[0]);
      navigate(`/${workspaces[0].slug}`, { replace: true });
    }
  }, [workspaces, isLoading, explicitSwitch]);

  if (isLoading) return <div className="flex items-center justify-center h-screen">{t("workspaceSelect.loading")}</div>;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold">{t("workspaceSelect.title")}</h1>

        {workspaces.map((ws) => (
          <div
            key={ws.id}
            onClick={() => {
              setCurrentWorkspace(ws);
              navigate(`/${ws.slug}`);
            }}
            className="group w-full flex items-center gap-3 rounded-lg border p-3 hover:bg-accent text-left cursor-pointer"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 font-bold text-primary shrink-0">
              {ws.name[0].toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{ws.name}</p>
              <p className="text-xs text-muted-foreground">{ws.member_count} {t("workspaceSelect.members")}</p>
            </div>
            {/* 슈퍼어드민: 삭제 버튼 hover 시 노출 */}
            {user?.is_staff && (
              <button
                type="button"
                onClick={(e) => handleDelete(e, ws.slug, ws.name)}
                disabled={deleteMutation.isPending}
                title={t("workspaceSelect.delete")}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}

        {/* 워크스페이스 없는 비슈퍼어드민 안내 */}
        {workspaces.length === 0 && !user?.is_staff && (
          <div className="text-center text-sm text-muted-foreground space-y-1">
            <p>{t("workspaceSelect.noWorkspaces")}</p>
            <p>{t("workspaceSelect.contactAdmin")}</p>
          </div>
        )}

        {/* 슈퍼어드민만 워크스페이스 생성 가능 */}
        {user?.is_staff && (
          <Button asChild variant="outline" className="w-full">
            <Link to="/create-workspace">
              <Plus className="h-4 w-4" />
              {t("workspaceSelect.createNew")}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
