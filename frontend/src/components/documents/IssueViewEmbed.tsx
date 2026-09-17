/**
 * 이슈 뷰 임베드 — 문서 안에서 이슈 페이지의 보드/표/캘린더를 라이브로 보여줌.
 *
 * 설계 철학: "고정된 뷰". 임베드를 삽입할 때 모드(보드/표/캘린더)가 결정되며 이후 변경 불가.
 * 다른 모드로 보고 싶으면 별도 임베드를 추가. 노션 linked database보다 더 간단·명시적.
 *
 * 프로젝트 귀속:
 *  - 문서가 프로젝트 스페이스에 있으면 그 프로젝트로 자동 잠김 (선택 UI 안 보임)
 *  - 워크스페이스 스페이스의 문서면 사용자가 직접 프로젝트 선택
 */
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useContext } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Kanban, Table as TableIcon, Calendar as CalendarIcon, Filter, X, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { projectsApi } from "@/api/projects";
import { useIssueDialogStore } from "@/stores/issueDialogStore";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { BoardView } from "@/pages/project/views/BoardView";
import { TableView } from "@/pages/project/views/TableView";
import { CalendarView } from "@/pages/project/views/CalendarView";
import type { CalendarSettings } from "@/hooks/useViewSettings";
import type { ProjectMember } from "@/types";
import { DocEditorContext } from "./DocumentEditor";

type ViewMode = "board" | "table" | "calendar";

interface EmbedFilters {
  state?: string;
  priority?: string;
  assignees?: string;
}

interface EmbedAttrs {
  projectId: string;
  viewMode: ViewMode;
  filters: EmbedFilters;
  height?: number;
}

const VIEW_LABELS: Record<ViewMode, { titleKey: string; icon: typeof Kanban }> = {
  board:    { titleKey: "documents.issueEmbed.titleBoard",    icon: Kanban },
  table:    { titleKey: "documents.issueEmbed.titleTable",    icon: TableIcon },
  calendar: { titleKey: "documents.issueEmbed.titleCalendar", icon: CalendarIcon },
};

/* t 가 필요하므로 상수가 아니라 함수. 호출부에서 매 렌더 만든다. */
const priorityOptions = (t: TFunction) => [
  { value: "", label: t("documents.issueEmbed.priorityAll") },
  { value: "urgent", label: t("issues.priority.urgent") },
  { value: "high", label: t("issues.priority.high") },
  { value: "medium", label: t("issues.priority.medium") },
  { value: "low", label: t("issues.priority.low") },
  { value: "none", label: t("issues.priority.none") },
];

const DEFAULT_CAL_SETTINGS: CalendarSettings = {
  showCompleted: true, hideWeekends: false, showEvents: false, alwaysExpand: false, showFields: false,
};

export function IssueViewEmbedView({ node, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const attrs = node.attrs as EmbedAttrs;
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const docCtx = useContext(DocEditorContext);
  const [filterOpen, setFilterOpen] = useState(false);
  const [calSettings, setCalSettings] = useState<CalendarSettings>(DEFAULT_CAL_SETTINGS);

  /* 프로젝트 귀속 — 문서가 프로젝트 스페이스에 있으면 그 프로젝트로 자동 잠금. */
  const lockedProjectId = docCtx?.projectId;
  const projectIsLocked = !!lockedProjectId;
  useEffect(() => {
    if (lockedProjectId && attrs.projectId !== lockedProjectId) {
      updateAttributes({ projectId: lockedProjectId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedProjectId]);

  /* 잠겨 있지 않으면 프로젝트 선택용 목록 — 워크스페이스 스페이스 문서일 때만 사용 */
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", workspaceSlug],
    queryFn: () => projectsApi.list(workspaceSlug!),
    enabled: !!workspaceSlug && !projectIsLocked,
  });

  const effectiveProjectId = lockedProjectId || attrs.projectId;

  /* 필터 옵션 — 멤버/상태 */
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, effectiveProjectId],
    queryFn: () => projectsApi.members.list(workspaceSlug!, effectiveProjectId),
    enabled: !!workspaceSlug && !!effectiveProjectId,
  });
  const { data: states = [] } = useQuery({
    queryKey: ["states", effectiveProjectId],
    queryFn: () => projectsApi.states.list(workspaceSlug!, effectiveProjectId),
    enabled: !!effectiveProjectId,
  });

  const project = projects.find((p) => p.id === attrs.projectId);
  const setFilter = (key: keyof EmbedFilters, value: string | undefined) => {
    const next = { ...(attrs.filters || {}) };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    updateAttributes({ filters: next });
  };
  const clearFilters = () => updateAttributes({ filters: {} });

  const onIssueClick = (issueId: string) => {
    if (!workspaceSlug || !effectiveProjectId) return;
    useIssueDialogStore.getState().openIssue(workspaceSlug, effectiveProjectId, issueId);
  };

  const filterParams: Record<string, string> = {};
  if (attrs.filters?.state)     filterParams.state = attrs.filters.state;
  if (attrs.filters?.priority)  filterParams.priority = attrs.filters.priority;
  if (attrs.filters?.assignees) filterParams.assignees = attrs.filters.assignees;

  const activeFilterCount = Object.values(attrs.filters || {}).filter(Boolean).length;
  const ViewIcon = VIEW_LABELS[attrs.viewMode].icon;

  return (
    <NodeViewWrapper as="div" className="my-4 rounded-lg border bg-card overflow-hidden" contentEditable={false}>
      {/* 헤더 — 뷰 라벨(고정) + 프로젝트(잠겨 있으면 표시만, 아니면 선택) + 필터 */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <ViewIcon className="h-3.5 w-3.5 text-primary" />
          {t(VIEW_LABELS[attrs.viewMode].titleKey)}
        </div>

        {/* 프로젝트 — 잠겨 있으면 단순 표시, 아니면 드롭다운 선택 */}
        {projectIsLocked ? null : (
          <>
            <span className="text-muted-foreground/50 text-xs">·</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 h-6 px-2 text-xs font-medium rounded-md hover:bg-muted/60">
                  <span className="truncate max-w-[140px]">
                    {project ? project.name : t("documents.issueEmbed.pickProject")}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                {projects.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">{t("documents.issueEmbed.noProjects")}</div>
                ) : (
                  projects.map((p) => (
                    <DropdownMenuItem key={p.id} className="text-xs"
                      onClick={() => updateAttributes({ projectId: p.id, filters: {} })}>
                      {p.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        <div className="flex-1" />

        {/* 필터 토글 */}
        <button
          onClick={() => setFilterOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1 h-7 px-2 text-2xs rounded-md transition-colors",
            (filterOpen || activeFilterCount > 0)
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted/60",
          )}
        >
          <Filter className="h-3 w-3" />
          {t("documents.issueEmbed.filter")}{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
      </div>

      {/* 필터 패널 */}
      {filterOpen && effectiveProjectId && (
        <div className="flex items-center flex-wrap gap-2 px-3 py-2 border-b bg-muted/20">
          <FilterSelect
            label={t("documents.issueEmbed.state")}
            value={attrs.filters?.state ?? ""}
            options={[{ value: "", label: t("documents.issueEmbed.stateAll") }, ...states.map((s) => ({ value: s.id, label: s.name }))]}
            onChange={(v) => setFilter("state", v)}
          />
          <FilterSelect
            label={t("documents.issueEmbed.priority")}
            value={attrs.filters?.priority ?? ""}
            options={priorityOptions(t)}
            onChange={(v) => setFilter("priority", v)}
          />
          <FilterSelect
            label={t("documents.issueEmbed.assignee")}
            value={attrs.filters?.assignees ?? ""}
            options={[
              { value: "", label: t("documents.issueEmbed.assigneeAll") },
              ...members.map((m: ProjectMember) => ({
                value: m.member.id,
                label: m.member.display_name || m.member.email || m.member.id.slice(0, 8),
              })),
            ]}
            onChange={(v) => setFilter("assignees", v)}
          />
          {activeFilterCount > 0 && (
            <button onClick={clearFilters}
              className="flex items-center gap-1 h-6 px-2 text-2xs text-muted-foreground hover:text-destructive">
              <X className="h-3 w-3" />
              {t("documents.issueEmbed.clearAll")}
            </button>
          )}
        </div>
      )}

      {/* 본체 — 고정된 뷰 모드 렌더 */}
      {!effectiveProjectId ? (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
          {projectIsLocked ? t("documents.issueEmbed.loadingProject") : t("documents.issueEmbed.selectProjectAbove")}
        </div>
      ) : (
        <div className="relative" style={{ height: attrs.height ?? 480 }}>
          <div className="absolute inset-0 overflow-auto">
            {attrs.viewMode === "board" && (
              <BoardView
                workspaceSlug={workspaceSlug!}
                projectId={effectiveProjectId}
                onIssueClick={onIssueClick}
                issueFilter={filterParams}
                readOnly={true}
              />
            )}
            {attrs.viewMode === "table" && (
              <TableView
                workspaceSlug={workspaceSlug!}
                projectId={effectiveProjectId}
                onIssueClick={onIssueClick}
                issueFilter={filterParams}
                readOnly={true}
              />
            )}
            {attrs.viewMode === "calendar" && (
              <CalendarView
                workspaceSlug={workspaceSlug!}
                projectId={effectiveProjectId}
                onIssueClick={onIssueClick}
                issueFilter={filterParams}
                settings={calSettings}
                onSettingsChange={(s) => setCalSettings((prev) => ({ ...prev, ...s }))}
              />
            )}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

function FilterSelect({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 h-6 px-2 text-2xs rounded-md border bg-background hover:bg-muted/40">
          <span className="text-muted-foreground">{label}:</span>
          <span className="font-medium truncate max-w-[100px]">
            {options.find((o) => o.value === value)?.label ?? t("documents.issueEmbed.all")}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {options.map((o) => (
          <DropdownMenuItem key={o.value || "all"} className="text-xs" onClick={() => onChange(o.value)}>
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* 스키마는 doc-schema.ts 한 곳에만 있다 — 여기서는 노드뷰만 제공한다 */
