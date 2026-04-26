import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, X, ArrowRight } from "lucide-react";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { useLocalState } from "@/hooks/useLocalState";
import { QUERY_TIERS } from "@/lib/query-defaults";
import { cn } from "@/lib/utils";

/**
 * GettingStarted — 신규 워크스페이스 사용자용 체크리스트 (PASS9-1).
 *
 * 작은 카드 형태로 대시보드에 노출.
 *  - 3 가지 task 의 완료 여부를 백엔드 데이터로 판정 (별도 트래킹 안 함)
 *  - 모두 완료되면 자동 숨김
 *  - 사용자가 X 로 닫으면 영구 숨김 (workspace 별 localStorage)
 */

interface Props {
  workspaceSlug: string;
  /** 대시보드의 myIssues 가 이미 있으면 그대로 받는 것이 효율적. 없으면 자체 fetch. */
  myIssuesCount: number;
}

export function GettingStarted({ workspaceSlug, myIssuesCount }: Props) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useLocalState<boolean>(
    `onboarding.${workspaceSlug}.gettingStartedDismissed`,
    false,
  );

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", workspaceSlug, "onboarding"],
    queryFn: () => projectsApi.list(workspaceSlug),
    ...QUERY_TIERS.meta,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug),
    ...QUERY_TIERS.meta,
  });

  /* 첫 프로젝트 id — create_issue 액션이 진입할 곳 */
  const firstProject = projects[0];

  const tasks = [
    {
      id: "create_project",
      label: t("onboarding.gettingStarted.createProject"),
      done: projects.length > 0,
      to: `/${workspaceSlug}/projects/create`,
    },
    {
      id: "create_issue",
      label: t("onboarding.gettingStarted.createIssue"),
      done: myIssuesCount > 0,
      to: firstProject
        ? `/${workspaceSlug}/projects/${firstProject.id}/issues`
        : `/${workspaceSlug}/projects/create`,
    },
    {
      id: "invite_member",
      label: t("onboarding.gettingStarted.inviteMember"),
      done: members.length > 1,
      to: `/${workspaceSlug}/workspace-members`,
    },
  ];

  const completed = tasks.filter((t) => t.done).length;
  const total = tasks.length;

  /* 자동 숨김: 모두 완료 또는 사용자가 닫음. */
  if (dismissed || completed === total) return null;

  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5 shadow-sm relative">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2.5 right-2.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        aria-label={t("common.dismiss", "닫기")}
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-sm font-semibold">{t("onboarding.gettingStarted.title")}</h2>
        <span className="text-xs font-mono text-muted-foreground">
          {completed}/{total}
        </span>
      </div>

      {/* 진행률 바 */}
      <div className="h-1 bg-muted rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-primary transition-all"
          style={{
            width: `${(completed / total) * 100}%`,
            transitionDuration: "var(--motion-base)",
          }}
        />
      </div>

      <ul className="space-y-1.5">
        {tasks.map((task) => (
          <li key={task.id}>
            <Link
              to={task.to}
              className={cn(
                "flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-md text-sm transition-colors",
                task.done
                  ? "text-muted-foreground"
                  : "hover:bg-muted/50 text-foreground group",
              )}
            >
              <span
                className={cn(
                  "h-4 w-4 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                  task.done
                    ? "bg-primary border-primary"
                    : "border-muted-foreground/40 group-hover:border-primary/60",
                )}
              >
                {task.done && <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3} />}
              </span>
              <span className={cn("flex-1", task.done && "line-through")}>{task.label}</span>
              {!task.done && (
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
