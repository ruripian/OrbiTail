/**
 * 문서 스페이스 설정 레이아웃 — 프로젝트 설정과 같은 탭 구조.
 *
 * 스페이스 데이터와 "내 등급"은 여기서 한 번만 조회해 Outlet context 로 내려준다.
 * 탭마다 같은 쿼리를 반복하지 않기 위함.
 */
import { NavLink, Outlet, useParams, useNavigate, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Settings, Users, FolderOpen, Link2, Loader2 } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { DOC_SPACE_ROLE, type DocumentSpace, type DocumentSpaceRole } from "@/types";

const TABS = [
  { to: "general",     label: "일반",   icon: Settings },
  { to: "members",     label: "멤버",   icon: Users },
  { to: "content",     label: "콘텐츠", icon: FolderOpen },
  { to: "integration", label: "연동",   icon: Link2 },
];

export interface SpaceSettingsContext {
  space: DocumentSpace;
  workspaceSlug: string;
  spaceId: string;
  /** 이 스페이스에서 내 등급 — 없으면 멤버십이 없는 것(워크스페이스 관리자는 ADMIN 으로 계산됨) */
  myRole: DocumentSpaceRole | null;
  isAdmin: boolean;
}

export function useSpaceSettings() {
  return useOutletContext<SpaceSettingsContext>();
}

export default function DocumentSpaceSettingsLayout() {
  const { workspaceSlug, spaceId } = useParams<{ workspaceSlug: string; spaceId: string }>();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const isSuperuser = useAuthStore((s) => s.user?.is_superuser);

  const { data: spaces = [], isLoading } = useQuery({
    queryKey: ["document-spaces", workspaceSlug],
    queryFn: () => documentsApi.spaces.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const space = spaces.find((s) => s.id === spaceId);

  if (isLoading || !space) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const myMembership = space.space_members?.find((m) => m.member === userId);
  /* 개인 스페이스는 owner 가 곧 관리자 — 멤버십 레코드를 두지 않는다 */
  const myRole: DocumentSpaceRole | null =
    isSuperuser || space.owner === userId
      ? DOC_SPACE_ROLE.ADMIN
      : myMembership?.role ?? null;

  const context: SpaceSettingsContext = {
    space,
    workspaceSlug: workspaceSlug!,
    spaceId: spaceId!,
    myRole,
    isAdmin: myRole === DOC_SPACE_ROLE.ADMIN,
  };

  const base = `/${workspaceSlug}/documents/space/${spaceId}/settings`;

  return (
    <div className="flex h-full overflow-y-auto">
      <aside className="w-52 shrink-0 border-r bg-background p-4 space-y-1 sticky top-0 self-start max-h-full">
        <button
          onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}`)}
          className="flex items-center gap-2 px-2 py-1.5 mb-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          스페이스로
        </button>
        <p className="px-2 mb-3 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
          {space.name}
        </p>
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={`${base}/${to}`}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </aside>

      <main className="flex-1 p-6 sm:p-8 min-w-0">
        <Outlet context={context} />
      </main>
    </div>
  );
}
