/**
 * 이슈 선택 다이얼로그 — 검색 + 프로젝트별 이슈 트리 둘러보기.
 *
 * 정책:
 *  - 본인이 멤버인 프로젝트만 노출 (Project.is_member). public 프로젝트라도 미가입이면 제외.
 *  - 프로젝트 노드 펼치면 sub-issue 까지 트리 형태로 들여쓰기 표시.
 *  - 이슈 옆엔 PriorityGlyph (Hash 아이콘 X).
 *  - 검색 시: 멤버 프로젝트 안의 이슈만 필터해서 평면 결과로.
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Search, Loader2, ChevronRight, ChevronDown, Folder } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { PriorityGlyph } from "@/components/ui/priority-glyph";
import { QUERY_TIERS } from "@/lib/query-defaults";
import type { IssueSearchResult, Issue, Project, Priority } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  excludeIds?: string[];
  onSelect: (issue: { id: string; title: string; project: string; project_identifier: string; sequence_id: number }) => void | Promise<void>;
}

export function IssuePickerDialog({ open, onOpenChange, workspaceSlug, excludeIds = [], onSelect }: Props) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { if (!open) { setQ(""); setExpanded(new Set()); } }, [open]);

  const isSearching = debounced.length > 0;

  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ["issue-search-ws", workspaceSlug, debounced],
    queryFn: () => issuesApi.searchByWorkspace(workspaceSlug, debounced),
    enabled: open && isSearching,
  });

  const { data: allProjects = [] } = useQuery({
    queryKey: ["projects", workspaceSlug],
    queryFn: () => projectsApi.list(workspaceSlug),
    enabled: open,
    ...QUERY_TIERS.meta,
  });

  /* 본인이 멤버인 프로젝트만 — public 노출 X */
  const projects = useMemo(() => allProjects.filter((p) => p.is_member), [allProjects]);
  const memberProjectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);

  /* 검색 결과를 멤버 프로젝트로 한정 */
  const filteredSearchResults = useMemo(
    () => searchResults.filter((r) => memberProjectIds.has(r.project)),
    [searchResults, memberProjectIds],
  );

  /* 확장된 프로젝트별 이슈 — sub_issue 포함해서 트리 가능하게 */
  const projectIssueQueries = useQueries({
    queries: Array.from(expanded).map((pid) => ({
      queryKey: ["issues", workspaceSlug, pid, { include_sub_issues: "true" }] as const,
      queryFn: () => issuesApi.list(workspaceSlug, pid, { include_sub_issues: "true" }),
      enabled: open && !isSearching,
    })),
  });
  const projectIssuesMap = useMemo(() => {
    const m: Record<string, Issue[]> = {};
    Array.from(expanded).forEach((pid, i) => {
      m[pid] = projectIssueQueries[i]?.data ?? [];
    });
    return m;
  }, [expanded, projectIssueQueries]);

  const toggle = (pid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  };

  const handleSelect = async (i: IssueSearchResult | Issue, project: Project) => {
    if (excludeIds.includes(i.id)) return;
    setBusy(i.id);
    try {
      await onSelect({
        id: i.id,
        title: i.title,
        project: project.id,
        project_identifier: project.identifier,
        sequence_id: i.sequence_id,
      });
      onOpenChange(false);
    } finally { setBusy(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-xl p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색하거나 아래 트리에서 선택..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {isSearching ? (
            <SearchResults
              results={filteredSearchResults}
              excludeIds={excludeIds}
              busy={busy}
              onSelect={async (i) => {
                await onSelect({
                  id: i.id, title: i.title, project: i.project,
                  project_identifier: i.project_identifier, sequence_id: i.sequence_id,
                });
                onOpenChange(false);
              }}
              setBusy={setBusy}
            />
          ) : (
            <ProjectTree
              projects={projects}
              expanded={expanded}
              issuesMap={projectIssuesMap}
              excludeIds={excludeIds}
              busy={busy}
              onToggle={toggle}
              onSelect={handleSelect}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SearchResults({ results, excludeIds, busy, onSelect, setBusy }: {
  results: IssueSearchResult[]; excludeIds: string[]; busy: string | null;
  onSelect: (i: IssueSearchResult) => void; setBusy: (id: string | null) => void;
}) {
  if (results.length === 0) {
    return <div className="px-4 py-6 text-center text-xs text-muted-foreground">검색 결과 없음</div>;
  }
  return (
    <ul>
      {results.map((i) => {
        const excluded = excludeIds.includes(i.id);
        return (
          <li key={i.id}>
            <button
              disabled={busy !== null || excluded}
              onClick={() => { setBusy(i.id); onSelect(i); }}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-muted/40",
                (busy !== null || excluded) && "opacity-50 cursor-not-allowed",
              )}
            >
              <span className="font-mono text-2xs text-muted-foreground shrink-0">
                {i.project_identifier}-{i.sequence_id}
              </span>
              <span className="inline-flex shrink-0">
                <PriorityGlyph priority={i.priority as Priority} size={10} />
              </span>
              <span className="truncate">{i.title}</span>
              <span className="text-2xs text-muted-foreground/70 shrink-0 ml-auto">{i.project_name}</span>
              {excluded && <span className="text-2xs text-muted-foreground">(연결됨)</span>}
              {busy === i.id && <Loader2 className="h-3 w-3 animate-spin" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* 프로젝트의 이슈 목록을 parent → child 순회로 평탄화하면서 depth 부여. */
function flattenTree(issues: Issue[]): Array<Issue & { depth: number }> {
  const byParent: Record<string, Issue[]> = {};
  for (const i of issues) {
    const k = i.parent ?? "__root__";
    (byParent[k] ??= []).push(i);
  }
  for (const arr of Object.values(byParent)) {
    arr.sort((a, b) => a.sort_order - b.sort_order || a.sequence_id - b.sequence_id);
  }
  const out: Array<Issue & { depth: number }> = [];
  const walk = (parentId: string, depth: number) => {
    for (const c of byParent[parentId] ?? []) {
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk("__root__", 0);
  return out;
}

function ProjectTree({ projects, expanded, issuesMap, excludeIds, busy, onToggle, onSelect }: {
  projects: Project[];
  expanded: Set<string>;
  issuesMap: Record<string, Issue[]>;
  excludeIds: string[];
  busy: string | null;
  onToggle: (pid: string) => void;
  onSelect: (i: Issue, p: Project) => void;
}) {
  if (projects.length === 0) {
    return <div className="px-4 py-6 text-center text-xs text-muted-foreground">참여 중인 프로젝트가 없습니다</div>;
  }
  return (
    <div className="py-1">
      {projects.map((p) => {
        const isOpen = expanded.has(p.id);
        const issues = issuesMap[p.id] ?? [];
        const tree = isOpen ? flattenTree(issues) : [];
        return (
          <div key={p.id}>
            <button
              onClick={() => onToggle(p.id)}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold hover:bg-muted/40 text-left"
            >
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Folder className="h-3.5 w-3.5 text-amber-500" />
              <span className="font-mono text-2xs text-muted-foreground shrink-0">{p.identifier}</span>
              <span className="truncate">{p.name}</span>
              {isOpen && <span className="ml-auto text-2xs text-muted-foreground/60">{tree.length}</span>}
            </button>
            {isOpen && (
              <div>
                {tree.length === 0 ? (
                  <div className="pl-9 py-2 text-2xs text-muted-foreground/60">이슈 없음 또는 로딩 중</div>
                ) : (
                  tree.map((i) => {
                    const excluded = excludeIds.includes(i.id);
                    return (
                      <div
                        key={i.id}
                        className={cn(
                          "flex items-center gap-1 hover:bg-muted/40 transition-colors pr-3 py-1",
                          excluded && "opacity-50",
                        )}
                        style={{ paddingLeft: 36 + i.depth * 14 }}
                      >
                        {i.depth > 0 && (
                          <span className="text-muted-foreground/40 shrink-0">↳</span>
                        )}
                        <span className="inline-flex shrink-0">
                          <PriorityGlyph priority={i.priority} size={10} />
                        </span>
                        <span className="font-mono text-2xs text-muted-foreground shrink-0">
                          {p.identifier}-{i.sequence_id}
                        </span>
                        <button
                          disabled={busy !== null || excluded}
                          onClick={() => onSelect(i, p)}
                          className={cn(
                            "flex-1 text-left text-xs truncate",
                            !excluded && "hover:text-primary",
                            excluded && "cursor-default",
                          )}
                          title={i.title}
                        >
                          {i.title}
                          {excluded && <span className="ml-2 text-2xs text-muted-foreground">(연결됨)</span>}
                        </button>
                        {busy === i.id && <Loader2 className="h-3 w-3 animate-spin" />}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
