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
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState, useEffect, useContext } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Kanban, Table as TableIcon, Calendar as CalendarIcon, Filter, X, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { projectsApi } from "@/api/projects";
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

const VIEW_LABELS: Record<ViewMode, { label: string; icon: typeof Kanban }> = {
  board:    { label: "보드",    icon: Kanban },
  table:    { label: "표",      icon: TableIcon },
  calendar: { label: "캘린더",  icon: CalendarIcon },
};

const PRIORITY_OPTIONS = [
  { value: "", label: "전체 우선순위" },
  { value: "urgent", label: "긴급" },
  { value: "high", label: "높음" },
  { value: "medium", label: "중간" },
  { value: "low", label: "낮음" },
  { value: "none", label: "없음" },
];

const DEFAULT_CAL_SETTINGS: CalendarSettings = {
  showCompleted: true, hideWeekends: false, showEvents: false, alwaysExpand: false, showFields: false,
};

function IssueViewEmbedView({ node, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as EmbedAttrs;
  const navigate = useNavigate();
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
    navigate(`/${workspaceSlug}/projects/${effectiveProjectId}/issues?issue=${issueId}`);
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
          이슈 {VIEW_LABELS[attrs.viewMode].label}
        </div>

        {/* 프로젝트 — 잠겨 있으면 단순 표시, 아니면 드롭다운 선택 */}
        {projectIsLocked ? null : (
          <>
            <span className="text-muted-foreground/50 text-xs">·</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 h-6 px-2 text-xs font-medium rounded-md hover:bg-muted/60">
                  <span className="truncate max-w-[140px]">
                    {project ? project.name : "프로젝트 선택"}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                {projects.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">접근 가능한 프로젝트 없음</div>
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
          필터{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
      </div>

      {/* 필터 패널 */}
      {filterOpen && effectiveProjectId && (
        <div className="flex items-center flex-wrap gap-2 px-3 py-2 border-b bg-muted/20">
          <FilterSelect
            label="상태"
            value={attrs.filters?.state ?? ""}
            options={[{ value: "", label: "전체 상태" }, ...states.map((s) => ({ value: s.id, label: s.name }))]}
            onChange={(v) => setFilter("state", v)}
          />
          <FilterSelect
            label="우선순위"
            value={attrs.filters?.priority ?? ""}
            options={PRIORITY_OPTIONS}
            onChange={(v) => setFilter("priority", v)}
          />
          <FilterSelect
            label="담당자"
            value={attrs.filters?.assignees ?? ""}
            options={[
              { value: "", label: "전체 담당자" },
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
              모두 지우기
            </button>
          )}
        </div>
      )}

      {/* 본체 — 고정된 뷰 모드 렌더 */}
      {!effectiveProjectId ? (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
          {projectIsLocked ? "프로젝트 정보를 불러오는 중..." : "상단에서 프로젝트를 선택하세요"}
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 h-6 px-2 text-2xs rounded-md border bg-background hover:bg-muted/40">
          <span className="text-muted-foreground">{label}:</span>
          <span className="font-medium truncate max-w-[100px]">
            {options.find((o) => o.value === value)?.label ?? "전체"}
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

export const IssueViewEmbed = Node.create({
  name: "issueViewEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      projectId: { default: "" },
      viewMode:  { default: "board" },
      filters:   { default: {} },
      height:    { default: 480 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="issue-view-embed"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "issue-view-embed",
        "data-project-id": node.attrs.projectId,
        "data-view-mode": node.attrs.viewMode,
        "data-filters": JSON.stringify(node.attrs.filters || {}),
      }),
      `[이슈 ${VIEW_LABELS[node.attrs.viewMode as ViewMode]?.label ?? "뷰"} 임베드]`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(IssueViewEmbedView);
  },
});
