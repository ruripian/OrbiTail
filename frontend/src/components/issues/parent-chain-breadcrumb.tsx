import { Fragment } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOpenIssue } from "@/hooks/useOpenIssue";
import type { Issue } from "@/types";

/**
 * ParentChainBreadcrumb — 현재 이슈의 상위 체인을 breadcrumb로 표시
 *
 * [root] › [parent] › (현재 이슈는 표시 안 함)
 * - 각 항목은 해당 이슈 상세 페이지로 링크
 * - 패널 모드(onNavigate 제공 시): 링크 대신 콜백 호출로 패널 내 이동
 *
 * 사용:
 *   <ParentChainBreadcrumb chain={chain} workspaceSlug={ws} projectId={pid} />
 */

interface Props {
  chain:             Issue[];
  workspaceSlug:     string;
  projectId:         string;
  /** 워크스페이스 식별자 prefix (예: "OUR"). 없으면 workspaceSlug의 앞 3자 대문자 사용 */
  refPrefix?:        string;
  /** 패널 모드 — 제공 시 Link 대신 onNavigate(id) 호출 */
  onNavigate?:       (issueId: string) => void;
  className?:        string;
}

export function ParentChainBreadcrumb({
  chain, workspaceSlug, projectId, refPrefix, onNavigate, className,
}: Props) {
  const openIssue = useOpenIssue();
  if (chain.length === 0) return null;

  const prefix = refPrefix ?? workspaceSlug.toUpperCase().slice(0, 3);

  return (
    <nav
      className={cn(
        "flex items-center flex-wrap gap-1 text-xs text-muted-foreground mb-2",
        className,
      )}
      aria-label="parent chain"
    >
      {chain.map((item, i) => {
        const isLast = i === chain.length - 1;
        const content = (
          <>
            <span className="font-mono text-2xs text-muted-foreground/60 mr-1">
              {prefix}-{item.sequence_id}
            </span>
            <span className="truncate max-w-[180px]">{item.title}</span>
          </>
        );
        return (
          <Fragment key={item.id}>
            {onNavigate ? (
              <button
                type="button"
                onClick={() => onNavigate(item.id)}
                className={cn(
                  "inline-flex items-center rounded px-1.5 py-0.5 hover:bg-muted/60 hover:text-foreground transition-colors",
                  isLast && "text-foreground/80",
                )}
              >
                {content}
              </button>
            ) : (
              <Link
                to={`/${workspaceSlug}/projects/${projectId}/issues?issue=${item.id}`}
                onClick={(e) => openIssue(e, workspaceSlug, projectId, item.id)}
                className={cn(
                  "inline-flex items-center rounded px-1.5 py-0.5 hover:bg-muted/60 hover:text-foreground transition-colors",
                  isLast && "text-foreground/80",
                )}
              >
                {content}
              </Link>
            )}
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
          </Fragment>
        );
      })}
    </nav>
  );
}
