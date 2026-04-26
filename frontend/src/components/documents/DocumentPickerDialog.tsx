/**
 * 문서 선택 다이얼로그 — 검색 + 스페이스/문서 트리 둘러보기.
 *
 * 검색이 비어 있으면 스페이스별 트리를 렌더 (확장/축소 가능).
 * 검색어가 있으면 워크스페이스 전체 평면 결과로 전환.
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Search, FileText, Loader2, ChevronRight, ChevronDown, FolderOpen, Folder } from "lucide-react";
import { documentsApi } from "@/api/documents";
import type { Document, DocumentSpace } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  excludeIds?: string[];
  onSelect: (doc: Document) => void | Promise<void>;
}

export function DocumentPickerDialog({ open, onOpenChange, workspaceSlug, excludeIds = [], onSelect }: Props) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(new Set());
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { if (!open) { setQ(""); setExpandedSpaces(new Set()); setExpandedDocs(new Set()); } }, [open]);

  const isSearching = debounced.length > 0;

  /* 검색 모드 — 워크스페이스 전체 검색 */
  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ["doc-search", workspaceSlug, debounced],
    queryFn: () => documentsApi.search(workspaceSlug, debounced),
    enabled: open && isSearching,
  });

  /* 트리 모드 — 스페이스 목록 */
  const { data: spaces = [] } = useQuery({
    queryKey: ["document-spaces", workspaceSlug],
    queryFn: () => documentsApi.spaces.list(workspaceSlug),
    enabled: open && !isSearching,
  });

  /* 확장된 스페이스 각각의 문서 평면 목록 (parent_id 기반 트리는 클라에서 조립) */
  const spaceDocQueries = useQueries({
    queries: Array.from(expandedSpaces).map((sid) => ({
      queryKey: ["docs-flat", workspaceSlug, sid] as const,
      queryFn: () => documentsApi.list(workspaceSlug, sid, { all: "true" }),
      enabled: open && !isSearching,
    })),
  });
  const spaceDocsMap = useMemo(() => {
    const m: Record<string, Document[]> = {};
    Array.from(expandedSpaces).forEach((sid, i) => {
      m[sid] = spaceDocQueries[i]?.data ?? [];
    });
    return m;
  }, [expandedSpaces, spaceDocQueries]);

  const toggleSpace = (sid: string) => {
    setExpandedSpaces((prev) => {
      const next = new Set(prev);
      next.has(sid) ? next.delete(sid) : next.add(sid);
      return next;
    });
  };
  const toggleDoc = (id: string) => {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelect = async (d: Document) => {
    if (excludeIds.includes(d.id)) return;
    setBusy(d.id);
    try { await onSelect(d); onOpenChange(false); }
    finally { setBusy(null); }
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
            <SearchResults results={searchResults.filter((d) => !d.is_folder)} excludeIds={excludeIds} busy={busy} onSelect={handleSelect} />
          ) : (
            <SpaceTree
              spaces={spaces}
              expandedSpaces={expandedSpaces}
              expandedDocs={expandedDocs}
              spaceDocsMap={spaceDocsMap}
              excludeIds={excludeIds}
              busy={busy}
              onToggleSpace={toggleSpace}
              onToggleDoc={toggleDoc}
              onSelect={handleSelect}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SearchResults({ results, excludeIds, busy, onSelect }: {
  results: Document[]; excludeIds: string[]; busy: string | null; onSelect: (d: Document) => void;
}) {
  if (results.length === 0) {
    return <div className="px-4 py-6 text-center text-xs text-muted-foreground">검색 결과 없음</div>;
  }
  return (
    <ul>
      {results.map((d) => {
        const excluded = excludeIds.includes(d.id);
        return (
          <li key={d.id}>
            <button
              disabled={busy !== null || excluded}
              onClick={() => onSelect(d)}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-muted/40",
                (busy !== null || excluded) && "opacity-50 cursor-not-allowed",
              )}
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{d.title || "제목 없음"}</span>
              {excluded && <span className="ml-auto text-2xs text-muted-foreground">이미 연결됨</span>}
              {busy === d.id && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SpaceTree({
  spaces, expandedSpaces, expandedDocs, spaceDocsMap, excludeIds, busy,
  onToggleSpace, onToggleDoc, onSelect,
}: {
  spaces: DocumentSpace[];
  expandedSpaces: Set<string>;
  expandedDocs: Set<string>;
  spaceDocsMap: Record<string, Document[]>;
  excludeIds: string[];
  busy: string | null;
  onToggleSpace: (sid: string) => void;
  onToggleDoc: (id: string) => void;
  onSelect: (d: Document) => void;
}) {
  if (spaces.length === 0) {
    return <div className="px-4 py-6 text-center text-xs text-muted-foreground">접근 가능한 스페이스 없음</div>;
  }
  return (
    <div className="py-1">
      {spaces.map((s) => {
        const isOpen = expandedSpaces.has(s.id);
        const docs = spaceDocsMap[s.id] ?? [];
        const roots = docs.filter((d) => !d.parent);
        return (
          <div key={s.id}>
            <button
              onClick={() => onToggleSpace(s.id)}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold hover:bg-muted/40 text-left"
            >
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {isOpen ? <FolderOpen className="h-3.5 w-3.5 text-amber-500" /> : <Folder className="h-3.5 w-3.5 text-amber-500" />}
              <span className="truncate">{s.name}</span>
              <span className="ml-auto text-2xs text-muted-foreground/60">{docs.length}</span>
            </button>
            {isOpen && (
              <div>
                {roots.length === 0 && docs.length === 0 ? (
                  <div className="pl-9 py-2 text-2xs text-muted-foreground/60">로딩 중 또는 비어 있음</div>
                ) : (
                  roots.map((root) => (
                    <DocNode
                      key={root.id}
                      doc={root}
                      depth={1}
                      allDocs={docs}
                      expandedDocs={expandedDocs}
                      excludeIds={excludeIds}
                      busy={busy}
                      onToggleDoc={onToggleDoc}
                      onSelect={onSelect}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DocNode({ doc, depth, allDocs, expandedDocs, excludeIds, busy, onToggleDoc, onSelect }: {
  doc: Document; depth: number; allDocs: Document[];
  expandedDocs: Set<string>; excludeIds: string[]; busy: string | null;
  onToggleDoc: (id: string) => void; onSelect: (d: Document) => void;
}) {
  const children = allDocs.filter((d) => d.parent === doc.id);
  const hasChildren = children.length > 0;
  const isOpen = expandedDocs.has(doc.id);
  const excluded = excludeIds.includes(doc.id);
  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 hover:bg-muted/40 transition-colors",
          excluded && "opacity-50",
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {hasChildren ? (
          <button onClick={() => onToggleDoc(doc.id)} className="p-0.5 hover:bg-muted/60 rounded">
            {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        {doc.is_folder
          ? <Folder className="h-3.5 w-3.5 text-amber-500/70 shrink-0" />
          : <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <button
          disabled={busy !== null || excluded || doc.is_folder}
          onClick={() => !doc.is_folder && onSelect(doc)}
          className={cn(
            "flex-1 text-left text-xs py-1 truncate",
            !doc.is_folder && "hover:text-primary",
            (excluded || doc.is_folder) && "cursor-default",
          )}
          title={doc.title}
        >
          {doc.title || "제목 없음"}
          {excluded && <span className="ml-2 text-2xs text-muted-foreground">(연결됨)</span>}
        </button>
        {busy === doc.id && <Loader2 className="h-3 w-3 animate-spin mr-2" />}
      </div>
      {isOpen && children.map((c) => (
        <DocNode key={c.id} doc={c} depth={depth + 1} allDocs={allDocs}
          expandedDocs={expandedDocs} excludeIds={excludeIds} busy={busy}
          onToggleDoc={onToggleDoc} onSelect={onSelect}
        />
      ))}
    </div>
  );
}
