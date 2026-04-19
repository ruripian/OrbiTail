/**
 * 전역 이슈 검색 다이얼로그 — Cmd+K / Ctrl+K
 *
 * 워크스페이스 전체 이슈를 제목으로 검색하고,
 * 결과 클릭 시 해당 프로젝트의 이슈 페이지로 이동합니다.
 *
 * createPortal로 body에 직접 렌더 → 부모 stacking context 영향 없음
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, FileText, ArrowRight, X, StickyNote } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { documentsApi } from "@/api/documents";
import { cn } from "@/lib/utils";
import { Z_SEARCH } from "@/constants/z-index";
import type { IssueSearchResult, Priority, Document as DocType } from "@/types";

/* 우선순위 색상 매핑 */
const PRIORITY_COLORS: Record<Priority, string> = {
  urgent: "text-red-500",
  high: "text-orange-500",
  medium: "text-yellow-500",
  low: "text-blue-500",
  none: "text-muted-foreground",
};

/**
 * 검색 쿼리 파서 — "priority:high some text assignee:me" 등을 파싱
 * 지원 구문: priority:<value>, status:<group>, assignee:me
 */
function parseSearchQuery(raw: string): { text: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const textParts: string[] = [];

  for (const token of raw.split(/\s+/)) {
    const match = token.match(/^(priority|status|assignee):(.+)$/i);
    if (match) {
      const [, key, value] = match;
      const k = key.toLowerCase();
      if (k === "priority") params.priority = value.toLowerCase();
      else if (k === "status") params.state_group = value.toLowerCase();
      else if (k === "assignee") params.assignee = value.toLowerCase();
    } else if (token) {
      textParts.push(token);
    }
  }

  return { text: textParts.join(" "), params };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentMode?: boolean;
}

export function CommandSearchDialog({ open, onOpenChange, documentMode = false }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 검색 쿼리 — 300ms 디바운스
  const debouncedQuery = useDebounce(query, 300);
  const parsed = parseSearchQuery(debouncedQuery);
  const hasAdvancedFilters = Object.keys(parsed.params).length > 0;

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["issue-search", workspaceSlug, debouncedQuery],
    queryFn: () => issuesApi.searchByWorkspace(workspaceSlug!, parsed.text, parsed.params),
    enabled: !documentMode && !!workspaceSlug && (debouncedQuery.length >= 2 || hasAdvancedFilters),
    staleTime: 1000 * 30,
  });

  // 문서 검색
  const { data: docResults = [] } = useQuery({
    queryKey: ["doc-search", workspaceSlug, debouncedQuery],
    queryFn: () => documentsApi.search(workspaceSlug!, parsed.text || debouncedQuery),
    enabled: !!workspaceSlug && debouncedQuery.length >= 2,
    staleTime: 1000 * 30,
  });

  // 다이얼로그 열릴 때 포커스 + 초기화
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // 선택 인덱스 범위 보정
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // 키보드 네비게이션
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        navigateToIssue(results[selectedIndex]);
      } else if (e.key === "Escape") {
        onOpenChange(false);
      }
    },
    [results, selectedIndex, onOpenChange]
  );

  // 선택 항목이 보이도록 스크롤
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  /* 바깥 클릭 감지 — 패널 외부 mousedown 시 닫기 */
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, onOpenChange]);

  const navigateToIssue = (issue: IssueSearchResult) => {
    onOpenChange(false);
    navigate(`/${workspaceSlug}/projects/${issue.project}/issues?issue=${issue.id}`);
  };

  const navigateToDoc = (doc: DocType) => {
    onOpenChange(false);
    navigate(`/${workspaceSlug}/documents/space/${doc.space}/${doc.id}`);
  };

  const totalResults = results.length + docResults.length;

  if (!open) return null;

  return createPortal(
    <>
      {/* 배경 딤 오버레이 — 불투명하게 뒤 배경 완전 차단 */}
      <div
        className="fixed inset-0 bg-background/80"
        style={{ zIndex: Z_SEARCH }}
      />

      {/* 다이얼로그 컨테이너 — 화면 중앙 상단 */}
      <div
        className="fixed inset-0 flex items-start justify-center pt-[15vh]"
        style={{ zIndex: Z_SEARCH + 1 }}
      >
        <div
          ref={panelRef}
          className="w-full max-w-lg rounded-xl border bg-background shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 검색 입력 */}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Search className="h-5 w-5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={documentMode ? t("search.placeholderDocs") : t("search.placeholder")}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
            />
            {/* 닫기 버튼 */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
              title={t("search.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 결과 목록 */}
          <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
            {debouncedQuery.length < 2 && !hasAdvancedFilters && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t("search.hint")}
              </p>
            )}

            {(debouncedQuery.length >= 2 || hasAdvancedFilters) && totalResults === 0 && !isFetching && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t("search.noResults")}
              </p>
            )}

            {isFetching && results.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t("search.searching")}
              </p>
            )}

            {results.map((issue, i) => (
              <button
                key={issue.id}
                onClick={() => navigateToIssue(issue)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={cn(
                  "flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors",
                  i === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                <FileText className={cn("h-4 w-4 shrink-0", PRIORITY_COLORS[issue.priority])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {issue.project_identifier}-{issue.sequence_id}
                    </span>
                    <span className="text-sm truncate">{issue.title}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{issue.project_name}</span>
                </div>
                {issue.state_detail && (
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium"
                    style={{
                      backgroundColor: issue.state_detail.color + "20",
                      color: issue.state_detail.color,
                    }}
                  >
                    {issue.state_detail.name}
                  </span>
                )}
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
              </button>
            ))}

            {/* 문서 검색 결과 */}
            {docResults.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-2xs font-semibold text-muted-foreground uppercase tracking-wider border-t mt-1">
                  {t("documents.title")}
                </div>
                {docResults.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => navigateToDoc(doc)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors hover:bg-accent/50"
                  >
                    <StickyNote className="h-4 w-4 shrink-0 text-amber-500" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm truncate block">{doc.title}</span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
              </>
            )}
          </div>

          {/* 하단 도움말 */}
          <div className="flex items-center gap-4 border-t px-4 py-2 text-2xs text-muted-foreground flex-wrap">
            <span>↑↓ {t("search.navigate")}</span>
            <span>↵ {t("search.open")}</span>
            <span>esc {t("search.close")}</span>
            <span className="opacity-60">priority:high · status:backlog · assignee:me</span>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** 간단한 디바운스 훅 */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
