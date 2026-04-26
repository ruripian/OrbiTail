import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { useIssueRefresh } from "@/hooks/useIssueMutations";
import { PRIORITY_LABEL_KEY } from "@/constants/priority";
import type { Issue, State } from "@/types";

/**
 * PASS5-D — Sub-issues tab.
 *
 * IssueDetailPage 가 카운트 배지를 위해 subIssues 를 fetch 해서 prop 으로 내려주고,
 * 본 탭은 자기 createSubIssueMutation 만 소유. mutation 성공 후 useIssueRefresh
 * 로 부모 query invalidate (카운트 배지/목록 모두 자동 갱신).
 */
interface Props {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  subIssues: Issue[];
  states: State[];
  inPanel: boolean;
  readOnly: boolean;
}

export function SubIssuesTab({ workspaceSlug, projectId, issueId, subIssues, states, inPanel, readOnly }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { refresh, refreshIssue } = useIssueRefresh(workspaceSlug, projectId);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const createMutation = useMutation({
    mutationFn: () => {
      const defaultState = states.find((s) => s.group === "unstarted") ?? states.find((s) => s.default) ?? states[0];
      return issuesApi.subIssues.create(workspaceSlug, projectId, issueId, {
        title: title.trim(),
        priority: "none",
        ...(defaultState ? { state: defaultState.id } : {}),
      });
    },
    onSuccess: () => {
      setTitle("");
      setAdding(false);
      refresh(issueId);
      refreshIssue(issueId);
    },
    onError: () => toast.error(t("issues.detail.toast.subIssueCreateFailed")),
  });

  const openSub = (subId: string) => {
    if (inPanel) {
      setSearchParams((p) => { p.set("issue", subId); return p; });
    } else {
      const viewParam = searchParams.get("view");
      const qs = new URLSearchParams();
      if (viewParam) qs.set("view", viewParam);
      qs.set("issue", subId);
      navigate(`/${workspaceSlug}/projects/${projectId}/issues?${qs.toString()}`);
    }
  };

  return (
    <div className="space-y-1.5">
      {subIssues.map((sub) => (
        <div
          key={sub.id}
          role="button"
          tabIndex={0}
          onClick={() => openSub(sub.id)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md border hover:bg-muted/30 transition-colors cursor-pointer"
        >
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ background: sub.state_detail?.color ?? "#9ca3af" }}
          />
          <span className="text-xs font-mono text-muted-foreground shrink-0 w-16">
            {workspaceSlug?.toUpperCase().slice(0, 3)}-{sub.sequence_id}
          </span>
          <span className="text-sm flex-1 truncate">{sub.title}</span>
          <span className="text-xs shrink-0" style={{ color: `var(--priority-${sub.priority})` }}>
            {t(PRIORITY_LABEL_KEY[sub.priority])}
          </span>
        </div>
      ))}

      {readOnly ? null : adding ? (
        <div className="flex items-center gap-2 px-3 py-2.5 border rounded-md">
          <input
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("issues.detail.subIssues.addPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) createMutation.mutate();
              if (e.key === "Escape") { setAdding(false); setTitle(""); }
            }}
            onBlur={() => {
              if (title.trim()) createMutation.mutate();
              else { setAdding(false); setTitle(""); }
            }}
            ref={(el) => { if (el) el.focus({ preventScroll: true }); }}
          />
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => { setAdding(false); setTitle(""); }}
          >
            {t("issues.detail.subIssues.cancel")}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 mt-1"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("issues.detail.subIssues.add")}
        </button>
      )}
    </div>
  );
}
