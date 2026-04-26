import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2, LogOut, Clock, X } from "lucide-react";
import { workspacesApi } from "@/api/workspaces";
import { api } from "@/lib/axios";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";

export function WorkspaceSelectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { setCurrentWorkspace } = useWorkspaceStore();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  /* 로그아웃 — 다른 계정으로 진입하거나 잘못된 자동 로그인 상태에서 빠져나올 때 */
  const handleLogout = async () => {
    try {
      const refresh = localStorage.getItem("refresh_token");
      if (refresh) await api.post("/auth/logout/", { refresh });
    } catch {
      /* 서버 폐기 실패해도 로컬 상태는 비움 */
    } finally {
      clearAuth();
      navigate("/auth/login", { replace: true });
    }
  };

  // ?switch=1 쿼리가 있으면 "명시적 전환" 의도 — 1개여도 자동 진입 안 함
  const [searchParams] = useSearchParams();
  const explicitSwitch = searchParams.get("switch") === "1";

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: workspacesApi.list,
  });

  /* 가입 후보 + 내 신청 목록 — 멤버십 0개일 때만 조회 */
  const showJoinFlow = !isLoading && !explicitSwitch && workspaces.length === 0 && !user?.is_staff;

  const { data: joinable = [], isLoading: joinableLoading } = useQuery({
    queryKey: ["workspaces", "joinable"],
    queryFn: workspacesApi.joinable,
    enabled: showJoinFlow,
  });

  const { data: myRequests = [], isLoading: myRequestsLoading } = useQuery({
    queryKey: ["workspaces", "join-requests", "mine"],
    queryFn: workspacesApi.joinRequests.listMine,
    enabled: showJoinFlow,
    refetchInterval: showJoinFlow ? 15000 : false, // 어드민 승인 폴링
  });

  const pendingRequests = (myRequests as any[]).filter((r) => r.status === "pending");
  const pendingSlugs = new Set(pendingRequests.map((r) => r.workspace_slug));
  const approvedRequest = (myRequests as any[]).find((r) => r.status === "approved");

  /* 신청 생성 / 취소 mutation */
  const requestMutation = useMutation({
    mutationFn: (slug: string) => workspacesApi.joinRequests.create(slug),
    onSuccess: (data) => {
      // 이미 멤버이거나(슈퍼유저 가입 등) → 바로 진입
      if (data?.already_member && data?.workspace_slug) {
        qc.invalidateQueries({ queryKey: ["workspaces"] });
        navigate(`/${data.workspace_slug}`, { replace: true });
        return;
      }
      qc.invalidateQueries({ queryKey: ["workspaces", "join-requests", "mine"] });
      toast.success(t("workspaceSelect.requested", "가입 신청을 보냈습니다. 관리자 승인을 기다려 주세요."));
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail ?? t("workspaceSelect.requestFailed", "가입 신청에 실패했습니다."));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (requestId: string) => workspacesApi.joinRequests.cancel(requestId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces", "join-requests", "mine"] });
    },
  });

  /* 워크스페이스 삭제 — 슈퍼어드민/Owner 전용 */
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
    if (typed === name) deleteMutation.mutate(slug);
    else if (typed !== null) toast.error(t("workspaceSelect.deleteMismatch"));
  };

  /* 자동 신청: 가입 후보가 정확히 1개고 아직 신청 안 한 경우 */
  const autoRequested = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (explicitSwitch) return;

    // 1) 멤버십 1개면 바로 진입
    if (workspaces.length === 1) {
      setCurrentWorkspace(workspaces[0]);
      navigate(`/${workspaces[0].slug}`, { replace: true });
      return;
    }

    // 2) 어드민이 승인한 신청이 있으면 워크스페이스 목록을 다시 조회
    //    (refetch 로 멤버십이 잡히면 위 1) 분기로 다음 사이클에 진입)
    if (approvedRequest) {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    }

    // 3) join-flow 진입 + 후보 1개 + 아직 신청 안 함 → 자동 신청
    if (
      showJoinFlow && !joinableLoading && !myRequestsLoading
      && joinable.length === 1
      && pendingRequests.length === 0
      && !autoRequested.current
      && !requestMutation.isPending
    ) {
      autoRequested.current = true;
      requestMutation.mutate((joinable[0] as any).slug);
    }
  }, [
    workspaces, isLoading, explicitSwitch,
    showJoinFlow, joinable, joinableLoading,
    myRequestsLoading, pendingRequests.length, approvedRequest,
  ]);

  if (isLoading || (showJoinFlow && (joinableLoading || myRequestsLoading))) {
    return <div className="flex items-center justify-center h-screen">{t("workspaceSelect.loading")}</div>;
  }

  /* 후보에서 PENDING 진행 중인 워크스페이스는 별도 카드로 분리 */
  const joinableNotPending = (joinable as any[]).filter((ws) => !pendingSlugs.has(ws.slug));

  return (
    <div className="relative flex min-h-screen items-center justify-center">
      <button
        type="button"
        onClick={handleLogout}
        className="absolute top-4 right-4 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <LogOut className="h-3.5 w-3.5" />
        {t("topbar.logout")}
      </button>

      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold">{t("workspaceSelect.title")}</h1>

        {/* 멤버 워크스페이스 */}
        {(workspaces as any[]).map((ws) => (
          <div
            key={ws.id}
            onClick={() => {
              setCurrentWorkspace(ws);
              navigate(`/${ws.slug}`);
            }}
            className="group w-full flex items-center gap-3 rounded-lg border p-3 hover:bg-accent text-left cursor-pointer"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 font-bold text-primary shrink-0">
              {ws.name?.[0]?.toUpperCase() ?? "?"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{ws.name}</p>
              <p className="text-xs text-muted-foreground">{ws.member_count} {t("workspaceSelect.members")}</p>
            </div>
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

        {/* 진행 중 가입 신청 — 승인 대기 카드 */}
        {pendingRequests.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground/80 font-semibold">
              {t("workspaceSelect.pendingTitle", "승인 대기 중")}
            </p>
            {pendingRequests.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 shrink-0">
                  <Clock className="h-4 w-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{r.workspace_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("workspaceSelect.pendingHint", "관리자 승인을 기다리는 중입니다")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => cancelMutation.mutate(r.id)}
                  disabled={cancelMutation.isPending}
                  title={t("workspaceSelect.cancelRequest", "신청 취소")}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 가입 후보 — 아직 신청 안 한 워크스페이스만 노출 */}
        {showJoinFlow && joinableNotPending.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground/80 font-semibold">
              {t("workspaceSelect.pickToJoin", "가입할 워크스페이스를 선택하세요")}
            </p>
            {joinableNotPending.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => requestMutation.mutate(ws.slug)}
                disabled={requestMutation.isPending}
                className="group w-full flex items-center gap-3 rounded-lg border p-3 hover:bg-accent text-left disabled:opacity-50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 font-bold text-primary shrink-0">
                  {ws.name?.[0]?.toUpperCase() ?? "?"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{ws.name}</p>
                  <p className="text-xs text-muted-foreground">{ws.member_count} {t("workspaceSelect.members")}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* 멤버 0개 + 후보도 없고 신청도 없음 → 안내 */}
        {workspaces.length === 0 && !user?.is_staff
          && pendingRequests.length === 0 && joinableNotPending.length === 0 && (
          <div className="text-center text-sm text-muted-foreground space-y-1">
            <p>{t("workspaceSelect.noWorkspaces")}</p>
            <p>{t("workspaceSelect.contactAdmin")}</p>
          </div>
        )}

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
