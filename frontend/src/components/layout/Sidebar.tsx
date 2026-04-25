import { useState, useRef } from "react";
import { Link, useParams, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Home,
  Compass,
  Archive,
  ListChecks,
  Layers,
  Plus,
  ChevronDown,
  SlidersHorizontal,
  Star,
  GripVertical,
  Trash2,
  Lock,
  Megaphone,
  MessageSquarePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { projectsApi } from "@/api/projects";
import { announcementsApi } from "@/api/announcements";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ProjectIcon } from "@/components/ui/project-icon-picker";
import { AppSwitcher } from "./AppSwitcher";
import { WorkspaceHeader } from "./WorkspaceHeader";
import type { Project, Category } from "@/types";
import type { WsStatus } from "@/hooks/useWebSocket";

/**
 * Phase 2.5 — Sidebar 활성 상태를 "좌측 3px bar"로 단일화.
 * 우측 dot은 제거하고, ::before 의사요소로 좌측 indicator를 그린다.
 * 색은 var(--accent) 또는 primary, 높이 60%, radius 99px (caps).
 */
function NavItem({
  to,
  icon: Icon,
  label,
  active,
}: {
  to: string;
  icon?: React.ElementType;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/12 text-foreground before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-[60%] before:bg-primary before:rounded-full"
          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      )}
      style={{ transitionDuration: "var(--motion-fast)" }}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      <span className="truncate">{label}</span>
    </Link>
  );
}

function SubLink({ to, icon: Icon, label, active }: { to: string; icon: React.ElementType; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-primary/10 text-foreground font-medium before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-[55%] before:bg-primary before:rounded-full"
          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
      style={{ transitionDuration: "var(--motion-fast)" }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function ProjectItem({
  project,
  workspaceSlug,
  isActive,
  isFavorite,
  onSelect,
  onToggleFavorite,
  draggable,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  isDragOver,
}: {
  project: Project;
  workspaceSlug: string;
  isActive: boolean;
  isFavorite: boolean;
  onSelect: (p: Project) => void;
  onToggleFavorite: (id: string) => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
  isDragOver?: boolean;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const base = `/${workspaceSlug}/projects/${project.id}`;

  const issuesActive =
    location.pathname === `${base}/issues` ||
    location.pathname === `${base}/board`;

  const qc = useQueryClient();
  const { data: categories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, project.id],
    queryFn: () => projectsApi.categories.list(workspaceSlug, project.id),
    enabled: isActive,
  });

  /* 카테고리 DnD */
  const [catDragId, setCatDragId] = useState<string | null>(null);
  const [catDragOverId, setCatDragOverId] = useState<string | null>(null);
  const catDragRef = useRef<string | null>(null);
  const catReorder = useMutation({
    mutationFn: (order: string[]) => projectsApi.categories.reorder(workspaceSlug, project.id, order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories", workspaceSlug, project.id] }),
  });
  const handleCatDrop = (targetId: string) => {
    const srcId = catDragRef.current;
    if (!srcId || srcId === targetId) { setCatDragId(null); setCatDragOverId(null); catDragRef.current = null; return; }
    const ids = categories.map((c: Category) => c.id);
    const from = ids.indexOf(srcId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) { setCatDragId(null); setCatDragOverId(null); catDragRef.current = null; return; }
    ids.splice(from, 1);
    ids.splice(to, 0, srcId);
    catReorder.mutate(ids);
    setCatDragId(null); setCatDragOverId(null); catDragRef.current = null;
  };

  return (
    <div
      className={cn("space-y-0.5", isDragOver && "ring-1 ring-primary/40 rounded-xl")}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.(e); }}
      onDragEnd={onDragEnd}
      onDrop={(e) => { e.preventDefault(); onDrop?.(); }}
    >
      <div className="flex items-center group/proj">
        {draggable && (
          <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/0 group-hover/proj:text-muted-foreground/40 transition-colors cursor-grab mr-0.5" />
        )}
        <button
          onClick={() => onSelect(project)}
          className={cn(
            "flex-1 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-fast text-left min-w-0",
            isActive
              ? "text-sidebar-foreground bg-sidebar-accent/60"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
          )}
        >
          {project.icon_prop ? (
            <ProjectIcon value={project.icon_prop} size={12} className="shrink-0" />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-2xs font-bold text-primary ring-1 ring-primary/20">
              {project.identifier[0]}
            </span>
          )}
          <span className="truncate flex-1 text-sm">{project.name}</span>
          {project.network === 2 && (
            <Lock className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          )}
          {isActive && (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(project.id); }}
          className={cn(
            "shrink-0 p-1 rounded-lg transition-all",
            isFavorite
              ? "text-amber-500"
              : "text-muted-foreground/0 group-hover/proj:text-muted-foreground/40 hover:!text-amber-500"
          )}
          title={isFavorite ? t("sidebar.unfavorite") : t("sidebar.favorite")}
        >
          <Star className="h-3.5 w-3.5" fill={isFavorite ? "currentColor" : "none"} />
        </button>
      </div>

      {isActive && (
        <div className="ml-3 pl-4 space-y-0.5 border-l-2 border-primary/20">
          <SubLink to={`${base}/issues`} icon={ListChecks} label={t("sidebar.issues")} active={issuesActive} />
          <SubLink
            to={`${base}/categories`}
            icon={Layers}
            label={t("sidebar.modules")}
            active={location.pathname === `${base}/categories`}
          />
          {categories.map((cat: Category) => (
            <Link
              key={cat.id}
              to={`${base}/categories/${cat.id}/issues`}
              draggable
              onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; catDragRef.current = cat.id; setCatDragId(cat.id); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setCatDragOverId(cat.id); }}
              onDragEnd={() => { catDragRef.current = null; setCatDragId(null); setCatDragOverId(null); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleCatDrop(cat.id); }}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1 ml-4 text-xs transition-all duration-fast",
                location.pathname === `${base}/categories/${cat.id}/issues`
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
                catDragOverId === cat.id && catDragId !== cat.id && "ring-1 ring-primary/40",
                catDragId === cat.id && "opacity-50",
              )}
            >
              <ProjectIcon value={cat.icon_prop} size={10} className="!w-4 !h-4 shrink-0" />
              <span className="truncate">{cat.name}</span>
            </Link>
          ))}
          {(project.features?.request !== false) && (
            <SubLink
              to={`${base}/request`}
              icon={MessageSquarePlus}
              label={t("sidebar.sendRequest", "요청")}
              active={location.pathname === `${base}/request`}
            />
          )}
          <SubLink
            to={`${base}/issues?view=trash`}
            icon={Trash2}
            label={t("views.tabs.trash")}
            active={location.search.includes("view=trash")}
          />
          <SubLink
            to={`${base}/settings`}
            icon={SlidersHorizontal}
            label={t("sidebar.projectSettings", "프로젝트 설정")}
            active={location.pathname.startsWith(`${base}/settings`)}
          />
        </div>
      )}
    </div>
  );
}

function AnnouncementsNavItem({ workspaceSlug, active }: { workspaceSlug: string; active: boolean }) {
  const { t } = useTranslation();
  const { data: unread = 0 } = useQuery({
    queryKey: ["announcements-unread"],
    queryFn:  announcementsApi.unreadCount,
    refetchInterval: 60_000,
  });
  return (
    <Link
      to={`/${workspaceSlug}/announcements`}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/12 text-foreground before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-[60%] before:bg-primary before:rounded-full"
          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      )}
      style={{ transitionDuration: "var(--motion-fast)" }}
    >
      <Megaphone className="h-4 w-4 shrink-0" />
      <span className="truncate flex-1">{t("sidebar.announcements")}</span>
      {unread > 0 && (
        <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-2xs font-bold not-italic leading-none tabular-nums">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({ onNavigate, wsStatus = "connecting" }: { onNavigate?: () => void; wsStatus?: WsStatus } = {}) {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentProject, setCurrentProject, favorites, projectOrder, toggleFavorite, setProjectOrder } = useWorkspaceStore();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", workspaceSlug],
    queryFn: () => projectsApi.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  const slug = workspaceSlug ?? "";
  const favIds = new Set(favorites[slug] ?? []);
  const order = projectOrder[slug] ?? [];

  /* 순서 적용 — order에 있는 ID 순서대로, 없는 프로젝트는 뒤에 붙임 */
  const sortedProjects = [...projects].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const favoriteProjects = sortedProjects.filter((p) => favIds.has(p.id));
  const publicProjects = sortedProjects.filter((p) => !favIds.has(p.id) && p.network === 0);
  const privateProjects = sortedProjects.filter((p) => !favIds.has(p.id) && p.network === 2);

  /* DnD 상태 — ref로 최신값 유지 (stale closure 방지) */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  const handleDrop = (targetId: string) => {
    const currentDragId = dragIdRef.current;
    if (!currentDragId || currentDragId === targetId) { setDragId(null); setDragOverId(null); dragIdRef.current = null; return; }
    const ids = sortedProjects.map((p) => p.id);
    const fromIdx = ids.indexOf(currentDragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { setDragId(null); setDragOverId(null); dragIdRef.current = null; return; }
    ids.splice(fromIdx, 1);
    /* fromIdx > toIdx → 위로 이동: toIdx 그대로 (대상 앞에 삽입)
       fromIdx < toIdx → 아래로 이동: toIdx 이미 1 줄었으므로 대상 앞에 삽입 됨 */
    ids.splice(toIdx, 0, currentDragId);
    setProjectOrder(slug, ids);
    setDragId(null);
    setDragOverId(null);
    dragIdRef.current = null;
  };

  const handleSelectProject = (project: Project) => {
    setCurrentProject(project);
    navigate(`/${workspaceSlug}/projects/${project.id}/issues`);
    onNavigate?.();
  };

  const renderProject = (project: Project) => (
    <ProjectItem
      key={project.id}
      project={project}
      workspaceSlug={slug}
      isActive={currentProject?.id === project.id}
      isFavorite={favIds.has(project.id)}
      onSelect={handleSelectProject}
      onToggleFavorite={(id) => toggleFavorite(slug, id)}
      draggable
      onDragStart={() => { dragIdRef.current = project.id; setDragId(project.id); }}
      onDragOver={() => setDragOverId(project.id)}
      onDragEnd={() => { dragIdRef.current = null; setDragId(null); setDragOverId(null); }}
      onDrop={() => handleDrop(project.id)}
      isDragOver={dragOverId === project.id && dragId !== project.id}
    />
  );

  return (
    <aside className="flex h-screen w-64 flex-col border-r glass-sidebar shrink-0" role="navigation" aria-label="Main navigation">

      <WorkspaceHeader />

      <AppSwitcher />

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <nav className="flex flex-col flex-1 overflow-y-auto p-3 gap-1" onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) onNavigate?.();
      }}>

        <NavItem
          to={`/${workspaceSlug}`}
          icon={Home}
          label={t("sidebar.home")}
          active={location.pathname === `/${workspaceSlug}`}
        />

        <NavItem
          to={`/${workspaceSlug}/projects/discover`}
          icon={Compass}
          label={t("sidebar.discover")}
          active={location.pathname === `/${workspaceSlug}/projects/discover`}
        />

        <NavItem
          to={`/${workspaceSlug}/projects/archived`}
          icon={Archive}
          label={t("sidebar.archived")}
          active={location.pathname === `/${workspaceSlug}/projects/archived`}
        />

        <AnnouncementsNavItem workspaceSlug={workspaceSlug ?? ""} active={location.pathname === `/${workspaceSlug}/announcements`} />

        {favoriteProjects.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center gap-2 px-3 mb-2">
              <Star className="h-3 w-3 text-amber-500" fill="currentColor" />
              <span className="text-xs font-semibold uppercase tracking-widest text-sidebar-foreground/65">
                {t("sidebar.favorites")}
              </span>
            </div>
            <div className="space-y-0.5">
              {favoriteProjects.map(renderProject)}
            </div>
          </div>
        )}

        <div className="mt-5">
          <div className="flex items-center justify-between px-3 mb-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-sidebar-foreground/65">
              {t("sidebar.projects")}
            </span>
            <Link
              to={`/${workspaceSlug}/projects/create`}
              className="rounded-lg p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              title={t("sidebar.newProject")}
            >
              <Plus className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="space-y-0.5">
            {publicProjects.length === 0 && privateProjects.length === 0 && favoriteProjects.length === 0 ? (
              <p className="px-3 py-2 text-xs text-sidebar-foreground/70">
                {t("sidebar.noProjects")}
              </p>
            ) : publicProjects.length === 0 && privateProjects.length === 0 ? (
              <p className="px-3 py-2 text-xs text-sidebar-foreground/50">
                {t("sidebar.allFavorited")}
              </p>
            ) : (
              publicProjects.map(renderProject)
            )}
          </div>
        </div>

        {privateProjects.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center gap-2 px-3 mb-2">
              <Lock className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-xs font-semibold uppercase tracking-widest text-sidebar-foreground/65">
                {t("sidebar.privateProjects")}
              </span>
            </div>
            <div className="space-y-0.5">
              {privateProjects.map(renderProject)}
            </div>
          </div>
        )}
      </nav>

      <div className="border-t border-border px-4 py-2">
        <div
          className="flex items-center gap-2"
          title={t(`sidebar.connection.${wsStatus}Tooltip`)}
        >
          <span className="relative flex h-2 w-2">
            {wsStatus === "connected" && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
            )}
            <span className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              wsStatus === "connected" && "bg-green-500",
              wsStatus === "connecting" && "bg-amber-400",
              wsStatus === "disconnected" && "bg-rose-500",
            )} />
          </span>
          <span className="text-xs text-sidebar-foreground/60">
            {t(`sidebar.connection.${wsStatus}`)}
            <span className="text-sidebar-foreground/40"> — {t(`sidebar.connection.${wsStatus}Desc`)}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
