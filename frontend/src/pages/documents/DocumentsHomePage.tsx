/**
 * 문서 홈 — 스페이스 목록 + 최근 문서 + 탐색
 */

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileText, FolderOpen, Plus, Loader2, Users, User as UserIcon, Layers, Star, Clock, FileSearch, Lock, Globe, Compass, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { documentsApi } from "@/api/documents";
import { workspacesApi } from "@/api/workspaces";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProjectIcon } from "@/components/ui/project-icon-picker";
import { MemberMultiSelect } from "@/components/ui/member-multi-select";
import { PageTransition } from "@/components/motion";
import type { DocumentSpace } from "@/types";

const SPACE_FALLBACK_ICON: Record<string, React.ReactNode> = {
  project: <Layers className="h-5 w-5 text-primary" />,
  personal: <UserIcon className="h-5 w-5 text-amber-500" />,
  shared: <Users className="h-5 w-5 text-blue-500" />,
};

/** project 스페이스는 프로젝트 아이콘 동기화(icon_prop), 그 외는 타입별 fallback. */
function SpaceIcon({ space, size = 20 }: { space: DocumentSpace; size?: number }) {
  if (space.space_type === "project" && space.icon_prop) {
    return <ProjectIcon value={space.icon_prop} size={Math.round(size * 0.7)} className="shrink-0" />;
  }
  return <>{SPACE_FALLBACK_ICON[space.space_type]}</>;
}

/** 비공개 표시 — project 는 project_network=2, shared 는 is_private */
function isSpacePrivate(space: DocumentSpace): boolean {
  if (space.space_type === "project") return space.project_network === 2;
  if (space.space_type === "shared") return !!space.is_private;
  return false;
}

export default function DocumentsHomePage() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIdentifier, setNewIdentifier] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
  const [newIsPrivate, setNewIsPrivate] = useState(false);

  const { data: spaces = [], isLoading } = useQuery({
    queryKey: ["document-spaces", workspaceSlug],
    queryFn: () => documentsApi.spaces.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  /* 스페이스 즐겨찾기 — 카드 별 토글 + "즐겨찾기 스페이스" 섹션 정렬 */
  const { data: spaceBookmarks = [] } = useQuery({
    queryKey: ["document-space-bookmarks", workspaceSlug],
    queryFn: () => documentsApi.spaceBookmarks.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const bookmarkedSpaceIds = new Set(spaceBookmarks.map((s) => s.id));
  const toggleSpaceBookmark = useMutation({
    mutationFn: ({ id, currently }: { id: string; currently: boolean }) =>
      currently
        ? documentsApi.spaceBookmarks.remove(workspaceSlug!, id)
        : documentsApi.spaceBookmarks.add(workspaceSlug!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-space-bookmarks", workspaceSlug] }),
  });

  /* 워크스페이스 멤버 목록 — 다이얼로그 멤버 셀렉트용 */
  const { data: wsMembers = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug!),
    enabled: !!workspaceSlug && createOpen,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const payload: {
        name: string;
        icon: string;
        identifier?: string;
        description?: string;
        members?: string[];
        is_private?: boolean;
      } = { name: newName.trim(), icon: "📚" };
      if (newIdentifier.trim()) payload.identifier = newIdentifier.trim().toUpperCase();
      if (newDescription.trim()) payload.description = newDescription.trim();
      /* 본인은 backend 에서 자동 추가하므로 lockedIds 만 제외하고 보냄 */
      const others = newMemberIds.filter((id) => id !== currentUser?.id);
      if (others.length > 0) payload.members = others;
      payload.is_private = newIsPrivate;
      return documentsApi.spaces.create(workspaceSlug!, payload);
    },
    onSuccess: (space) => {
      qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["document-spaces-discover", workspaceSlug] });
      setCreateOpen(false);
      setNewName("");
      setNewIdentifier("");
      setNewDescription("");
      setNewMemberIds([]);
      setNewIsPrivate(false);
      toast.success(t("documents.spaceCreated"));
      navigate(`/${workspaceSlug}/documents/space/${space.id}`);
    },
  });

  // 스페이스 유형별 그룹
  const projectSpaces = spaces.filter((s) => s.space_type === "project");
  const personalSpaces = spaces.filter((s) => s.space_type === "personal");
  const sharedSpaces = spaces.filter((s) => s.space_type === "shared");

  const SpaceCard = ({ space }: { space: DocumentSpace }) => {
    const isPrivate = isSpacePrivate(space);
    const isBookmarked = bookmarkedSpaceIds.has(space.id);
    return (
      <div
        onClick={() => navigate(`/${workspaceSlug}/documents/space/${space.id}`)}
        className="flex items-start gap-4 p-5 rounded-xl border bg-card hover:bg-accent/50 transition-all text-left shadow-sm hover:shadow-md group cursor-pointer"
      >
        <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center text-lg shrink-0">
          <SpaceIcon space={space} size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="font-semibold text-sm group-hover:text-primary transition-colors truncate">
              {space.name}
            </p>
            {isPrivate && (
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-label="비공개" />
            )}
          </div>
          {space.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{space.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1.5">
            {space.document_count} {t("documents.docCount")}
            {space.project_identifier && (
              <span className="ml-2 text-primary/70">
                {space.project_identifier}
              </span>
            )}
          </p>
        </div>
        {/* 스페이스 즐겨찾기 별 — 즐찾이면 항상 amber, 아니면 hover 시 노출 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleSpaceBookmark.mutate({ id: space.id, currently: isBookmarked });
          }}
          title={isBookmarked ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
          className={cn(
            "shrink-0 h-7 w-7 rounded-md flex items-center justify-center transition-all",
            isBookmarked
              ? "text-amber-500 hover:bg-amber-500/10"
              : "text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground",
          )}
        >
          <Star className={cn("h-4 w-4", isBookmarked && "fill-current")} />
        </button>
      </div>
    );
  };

  const SpaceSection = ({ title, items }: { title: string; items: DocumentSpace[] }) => {
    if (items.length === 0) return null;
    return (
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => <SpaceCard key={s.id} space={s} />)}
        </div>
      </div>
    );
  };

  /* 멤버 셀렉트 옵션 — 본인은 lockedIds로 항상 포함 */
  const memberOptions = wsMembers.map((wm) => ({
    id: wm.member.id,
    name: wm.member.display_name,
    email: wm.member.email,
    avatar: wm.member.avatar,
  }));
  const lockedIds = currentUser?.id ? [currentUser.id] : [];
  const allSelected = Array.from(new Set([...lockedIds, ...newMemberIds]));

  return (
    <PageTransition className="p-5 sm:p-8 overflow-y-auto h-full">
      <div className="max-w-5xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              {t("documents.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("documents.homeDesc")}</p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t("documents.newSpace")}
          </Button>
        </div>

        {/* 탭 */}
        <DocumentTabs workspaceSlug={workspaceSlug!}>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : spaces.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-12 text-center">
              <FolderOpen className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-lg text-muted-foreground">{t("documents.empty")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("documents.emptyHint")}</p>
            </div>
          ) : (
            <div className="space-y-8">
              <SpaceSection title="즐겨찾기" items={spaces.filter((s) => bookmarkedSpaceIds.has(s.id))} />
              <SpaceSection title={t("documents.projectSpaces")} items={projectSpaces} />
              <SpaceSection title={t("documents.sharedSpaces")} items={sharedSpaces} />
              <SpaceSection title={t("documents.personalSpaces")} items={personalSpaces} />
            </div>
          )}
        </DocumentTabs>
      </div>

      {/* 스페이스 생성 다이얼로그 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("documents.newSpace")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("documents.spaceName", "스페이스 이름")}
                <span className="text-rose-500 ml-0.5">*</span>
              </label>
              <Input
                placeholder={t("documents.spaceNamePlaceholder", "예: 기술 문서")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("documents.spaceIdentifier", "구분자 (선택)")}
              </label>
              <Input
                placeholder="TECH"
                maxLength={12}
                value={newIdentifier}
                onChange={(e) => setNewIdentifier(e.target.value.toUpperCase())}
              />
              <p className="text-2xs text-muted-foreground/70">
                {t("documents.spaceIdentifierHint", "영문 대문자/숫자, 최대 12자. 문서 URL 및 참조에 사용됩니다.")}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("documents.spaceDescription", "설명 (선택)")}
              </label>
              <textarea
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={t("documents.spaceDescriptionPlaceholder", "이 스페이스의 목적을 간단히 설명하세요")}
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>

            {/* 공개 / 비공개 카드 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">공개 범위</label>
              <div className="grid grid-cols-2 gap-2">
                <NetworkCard
                  selected={newIsPrivate}
                  onClick={() => setNewIsPrivate(true)}
                  icon={<Lock className="h-3.5 w-3.5" />}
                  title="비공개"
                  description="아래 참여자만 접근 가능"
                />
                <NetworkCard
                  selected={!newIsPrivate}
                  onClick={() => setNewIsPrivate(false)}
                  icon={<Globe className="h-3.5 w-3.5" />}
                  title="공개"
                  description="워크스페이스 전체 + 탐색 노출"
                />
              </div>
            </div>

            {/* 참여자 — 워크스페이스 멤버에서 선택 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                참여자 {newIsPrivate && <span className="text-rose-500">*</span>}
              </label>
              <MemberMultiSelect
                options={memberOptions}
                selectedIds={allSelected}
                lockedIds={lockedIds}
                getBadge={(id) => (id === currentUser?.id ? "(나)" : null)}
                placeholder="참여자 추가"
                onChange={(ids) => {
                  const lockedSet = new Set(lockedIds);
                  setNewMemberIds(ids.filter((id) => !lockedSet.has(id)));
                }}
              />
              <p className="text-2xs text-muted-foreground/70">
                {newIsPrivate
                  ? "비공개 스페이스 — 추가된 참여자만 볼 수 있습니다."
                  : "공개 스페이스 — 워크스페이스 멤버 모두 접근 가능. 여기서 추가하면 탐색 없이 바로 참여."}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                {t("admin.common.cancel")}
              </Button>
              <Button
                disabled={!newName.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("documents.create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}

/* 공개/비공개 선택 카드 — CreateProjectPage 의 NetworkCard 와 동일 패턴 */
function NetworkCard({
  selected, onClick, icon, title, description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-all",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-md",
            selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {icon}
        </span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <span className="text-2xs text-muted-foreground line-clamp-1">{description}</span>
    </button>
  );
}

/* ── 탐색 탭 — 전체 스페이스 / 내가 만든 / 즐겨찾기 / 최근 / 탐색 ── */

type TabKey = "spaces" | "discover" | "mine" | "bookmarks" | "recent";

function DocumentTabs({ workspaceSlug, children }: { workspaceSlug: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("spaces");

  const { data: mine = [], isLoading: loadingMine } = useQuery({
    queryKey: ["doc-mine", workspaceSlug],
    queryFn: () => documentsApi.mine(workspaceSlug),
    enabled: tab === "mine",
  });
  const { data: recent = [], isLoading: loadingRecent } = useQuery({
    queryKey: ["doc-recent", workspaceSlug],
    queryFn: () => documentsApi.recent(workspaceSlug),
    enabled: tab === "recent",
  });
  const { data: bookmarks = [], isLoading: loadingBm } = useQuery({
    queryKey: ["doc-bookmarks", workspaceSlug],
    queryFn: () => documentsApi.bookmarks.list(workspaceSlug),
    enabled: tab === "bookmarks",
  });
  const { data: discoverSpaces = [], isLoading: loadingDiscover } = useQuery({
    queryKey: ["document-spaces-discover", workspaceSlug],
    queryFn: () => documentsApi.spaces.discoverable(workspaceSlug),
    enabled: tab === "discover",
  });

  const joinMutation = useMutation({
    mutationFn: (spaceId: string) => documentsApi.spaces.join(workspaceSlug, spaceId),
    onSuccess: (space) => {
      qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["document-spaces-discover", workspaceSlug] });
      navigate(`/${workspaceSlug}/documents/space/${space.id}`);
    },
  });

  const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
    { key: "spaces", label: "전체 스페이스", icon: FolderOpen },
    { key: "discover", label: "탐색", icon: Compass },
    { key: "mine", label: "내가 만든", icon: UserIcon },
    { key: "bookmarks", label: "즐겨찾기", icon: Star },
    { key: "recent", label: "최근", icon: Clock },
  ];

  return (
    <div>
      <div className="flex items-center gap-1 mb-6 border-b">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors -mb-px",
              tab === key
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "spaces" && children}
      {tab === "discover" && (
        <DiscoverSpaceList
          workspaceSlug={workspaceSlug}
          spaces={discoverSpaces}
          loading={loadingDiscover}
          onJoin={(id) => joinMutation.mutate(id)}
          joiningId={joinMutation.isPending ? joinMutation.variables : undefined}
        />
      )}
      {tab === "mine" && (
        <DocList workspaceSlug={workspaceSlug} docs={mine} loading={loadingMine}
          emptyText="아직 작성한 문서가 없습니다." onNavigate={(d) => navigate(`/${workspaceSlug}/documents/space/${d.space}/${d.id}`)} />
      )}
      {tab === "recent" && (
        <DocList workspaceSlug={workspaceSlug} docs={recent} loading={loadingRecent}
          emptyText="최근 문서가 없습니다." onNavigate={(d) => navigate(`/${workspaceSlug}/documents/space/${d.space}/${d.id}`)} />
      )}
      {tab === "bookmarks" && (
        <DocList workspaceSlug={workspaceSlug} docs={bookmarks} loading={loadingBm}
          emptyText="즐겨찾기한 문서가 없습니다. 문서 페이지에서 별 아이콘으로 추가하세요." onNavigate={(d) => navigate(`/${workspaceSlug}/documents/space/${d.space}/${d.id}`)} />
      )}
    </div>
  );
}

function DiscoverSpaceList({
  spaces, loading, onJoin, joiningId,
}: {
  workspaceSlug: string;
  spaces: DocumentSpace[];
  loading: boolean;
  onJoin: (id: string) => void;
  joiningId?: string;
}) {
  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (spaces.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <Compass className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">참여 가능한 공개 스페이스가 없습니다.</p>
        <p className="text-2xs text-muted-foreground/70 mt-1">새 공개 스페이스가 생기면 여기에 표시됩니다.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {spaces.map((s) => (
        <div
          key={s.id}
          className="flex items-start gap-3 p-4 rounded-xl border bg-card shadow-sm"
        >
          <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
            <SpaceIcon space={s} size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="font-semibold text-sm truncate">{s.name}</p>
              <Globe className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-label="공개" />
            </div>
            {s.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>
            )}
            <p className="text-2xs text-muted-foreground mt-1.5">
              {s.document_count} 문서
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2 h-7 text-xs gap-1"
              disabled={joiningId === s.id}
              onClick={() => onJoin(s.id)}
            >
              {joiningId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
              참여
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function DocList({ docs, loading, emptyText, onNavigate }: {
  workspaceSlug: string;
  docs: Array<{ id: string; title: string; space: string; updated_at: string }>;
  loading: boolean;
  emptyText: string;
  onNavigate: (d: { id: string; space: string }) => void;
}) {
  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (docs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <FileSearch className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }
  return (
    <ul className="rounded-xl border bg-card divide-y">
      {docs.map((d) => (
        <li key={d.id}>
          <button
            onClick={() => onNavigate(d)}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-accent/40 transition-colors"
          >
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1 text-sm truncate">{d.title || "제목 없음"}</span>
            <span className="text-2xs text-muted-foreground tabular-nums">
              {new Date(d.updated_at).toLocaleDateString()}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
