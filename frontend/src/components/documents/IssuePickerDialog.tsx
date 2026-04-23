/**
 * 이슈 선택 다이얼로그 — 검색 + 프로젝트별 이슈 트리 둘러보기.
 *
 * 검색이 비어 있으면 프로젝트별 이슈 그룹을 펼쳐 볼 수 있고,
 * 검색어가 있으면 워크스페이스 전체 결과로 전환.
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Search, Loader2, Hash, ChevronRight, ChevronDown, Folder } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import type { IssueSearchResult, Issue, Project } from "@/types";
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

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", workspaceSlug],
    queryFn: () => projectsApi.list(workspaceSlug),
    enabled: open && !isSearching,
  });

  /* 확장된 프로젝트별 이슈 목록 */
  const projectIssueQueries = useQueries({
    queries: Array.from(expanded).map((pid) => ({
      queryKey: ["issues", workspaceSlug, pid, undefined] as const,
      queryFn: () => issuesApi.list(workspaceSlug, pid),
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
      next.has(pid) ? next.delete(pid) : next.add(pid);
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
              results={searchResults}
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
              <Hash className="h-3 w-3 text-muted-foreground shrink-0" />
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
    return <div className="px-4 py-6 text-center text-xs text-muted-foreground">접근 가능한 프로젝트 없음</div>;
  }
  return (
    <div className="py-1">
      {projects.map((p) => {
        const isOpen = expanded.has(p.id);
        const issues = issuesMap[p.id] ?? [];
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
              {isOpen && <span className="ml-auto text-2xs text-muted-foreground/60">{issues.length}</span>}
            </button>
            {isOpen && (
              <div>
                {issues.length === 0 ? (
                  <div className="pl-9 py-2 text-2xs text-muted-foreground/60">이슈 없음 또는 로딩 중</div>
                ) : (
                  issues.map((i) => {
                    const excluded = excludeIds.includes(i.id);
                    return (
                      <div
                        key={i.id}
                        className={cn(
                          "flex items-center gap-1 hover:bg-muted/40 transition-colors pl-9 pr-3 py-1",
                          excluded && "opacity-50",
                        )}
                      >
                        <Hash className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="font-mono text-2xs text-muted-foreground shrink-0">
                          {p.identifier}-{i.sequence_id}
                        </span>
                        <button
                          disabled={busy !== null || excluded}
                          onClick={() => onSelect(i, p)}
                          className={cn(
                            "flex-1 text-left text-xs truncate",
                            !excluded && "hover:text-primary",
                            (excluded) && "cursor-default",
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
