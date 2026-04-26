import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, GitBranch, MessageSquare, Activity, Link2, X, AlertTriangle, Paperclip, Copy, Archive, RotateCcw, Share2 } from "lucide-react";
import { toast } from "sonner";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { useAuthStore } from "@/stores/authStore";
import { useUndoStore } from "@/stores/undoStore";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { useParentChain } from "@/hooks/useParentChain";
import { useIssueRefresh } from "@/hooks/useIssueMutations";
import { ParentChainBreadcrumb } from "@/components/issues/parent-chain-breadcrumb";
import { IssueMetaSidebar } from "@/components/issues/IssueMetaSidebar";
import { QUERY_TIERS } from "@/lib/query-defaults";
import {
  SubIssuesTab,
  LinksTab,
  AttachmentsTab,
  CommentsTab,
  ActivityTab,
} from "./issue-detail/tabs";
import type { Issue } from "@/types";

type TabId = "sub-issues" | "links" | "nodes" | "attachments" | "comments" | "activity";

interface Props {
  /** 패널 모드에서 URL params 대신 직접 issueId를 주입할 때 사용 */
  issueIdOverride?: string;
  /** 패널 안에서 렌더 시 true — 브레드크럼 숨김 */
  inPanel?: boolean;
  /** 삭제나 뒤로가기 시 활용할 콜백 */
  onClose?: () => void;
}

export function IssueDetailPage({ issueIdOverride, inPanel = false, onClose }: Props = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const { workspaceSlug, projectId, issueId: paramIssueId } = useParams<{
    workspaceSlug: string;
    projectId: string;
    issueId: string;
  }>();
  const issueId = issueIdOverride ?? paramIssueId;
  const user = useAuthStore((s) => s.user);
  const { perms } = useProjectPerms();
  const pushUndo = useUndoStore((s) => s.push);
  const qc = useQueryClient();
  const { refresh, refreshWithArchive, refreshIssue } = useIssueRefresh(workspaceSlug!, projectId!);

  const { data: issue, isLoading } = useQuery({
    queryKey: ["issue", issueId],
    queryFn: () => issuesApi.get(workspaceSlug!, projectId!, issueId!),
  });

  const isArchived = !!issue?.archived_at;
  const canEdit = perms.can_edit;
  const canArchive = perms.can_archive;
  const canDelete = perms.can_delete;
  const readOnly = isArchived || !canEdit;

  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn: () => projectsApi.states.list(workspaceSlug!, projectId!),
    enabled: !!issue,
    ...QUERY_TIERS.meta,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug!, projectId!),
    enabled: !!issue,
    ...QUERY_TIERS.meta,
  });

  const { data: labels = [] } = useQuery({
    queryKey: ["labels", projectId],
    queryFn: () => issuesApi.labels.list(workspaceSlug!, projectId!),
    enabled: !!issue,
    ...QUERY_TIERS.meta,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, projectId],
    queryFn: () => projectsApi.categories.list(workspaceSlug!, projectId!),
    enabled: !!issue,
    ...QUERY_TIERS.meta,
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn: () => projectsApi.sprints.list(workspaceSlug!, projectId!),
    enabled: !!issue,
    ...QUERY_TIERS.meta,
  });

  const { data: subIssues = [] } = useQuery({
    queryKey: ["sub-issues", issueId],
    queryFn: () => issuesApi.subIssues.list(workspaceSlug!, projectId!, issueId!),
    enabled: !!issue,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ["comments", issueId],
    queryFn: () => issuesApi.comments.list(workspaceSlug!, projectId!, issueId!),
    enabled: !!issue,
  });

  const { data: activities = [] } = useQuery({
    queryKey: ["activities", issueId],
    queryFn: () => issuesApi.activities(workspaceSlug!, projectId!, issueId!),
    enabled: !!issue,
  });

  const { data: links = [] } = useQuery({
    queryKey: ["links", issueId],
    queryFn: () => issuesApi.links.list(workspaceSlug!, projectId!, issueId!),
    enabled: !!issue,
  });

  /* 관련 이슈(node link) — 트리 경계 넘는 자유 연결 */
  const { data: nodeLinks = [] } = useQuery({
    queryKey: ["node-links", issueId],
    queryFn: () => issuesApi.nodeLinks.list(workspaceSlug!, projectId!, issueId!),
    enabled: !!issue,
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ["attachments", issueId],
    queryFn: () => issuesApi.attachments.list(workspaceSlug!, projectId!, issueId!),
    enabled: !!issue,
  });

  /* 부모 이슈 선택용 — 프로젝트의 전체 이슈 목록
       include_sub_issues=true로 하위 이슈까지 포함해 가져옴 (하위 이슈도 다른 이슈의 부모가 될 수 있음) */
  const { data: projectIssues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, "all-with-children"],
    queryFn: () => issuesApi.list(workspaceSlug!, projectId!, { include_sub_issues: "true" }),
    enabled: !!issue,
  });

  /* 부모 체인 — 상단 breadcrumb 및 parent picker excludeIds 용도 */
  const parentChain = useParentChain(workspaceSlug, projectId, issue?.parent);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Issue>) =>
      issuesApi.update(workspaceSlug!, projectId!, issueId!, data),
    onMutate: (data) => {
      if (!issue) return;
      // 변경 전 값 캡처 (undo용)
      const prev: Partial<Issue> = {};
      for (const key of Object.keys(data) as (keyof Issue)[]) {
        (prev as any)[key] = (issue as any)[key];
      }
      return { prev };
    },
    onSuccess: (_result, data, context) => {
      refreshIssue(issueId!);
      refresh(issue?.parent);
      if (context?.prev) {
        const fieldName = Object.keys(data).join(", ");
        pushUndo({
          label: t("issues.detail.toast.updated", { field: fieldName }),
          undo: async () => {
            await issuesApi.update(workspaceSlug!, projectId!, issueId!, context.prev);
            refreshIssue(issueId!);
            refresh(issue?.parent);
          },
        });
      }
    },
    onError: () => toast.error(t("issues.detail.toast.updateFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => issuesApi.delete(workspaceSlug!, projectId!, issueId!),
    onSuccess: async () => {
      toast.success(t("common.issueDeleteSuccess"));
      await refresh(issue?.parent);
      if (onClose) onClose();
      else if (!inPanel) navigate(`/${workspaceSlug}/projects/${projectId}/issues`);
    },
    onError: () => toast.error(t("common.issueDeleteError")),
  });

  const handleCopyIssue = () => {
    if (!issue) return;
    issuesApi.duplicate(workspaceSlug!, projectId!, issue.id).then(() => {
      refresh(issue.parent);
      toast.success(t("issues.table.copied"));
      // 복사 후 디테일 창 닫기
      if (onClose) onClose();
      else if (!inPanel) navigate(`/${workspaceSlug}/projects/${projectId}/issues`);
    });
  };

  const handleArchiveIssue = () => {
    if (!issue) return;
    issuesApi.archive(workspaceSlug!, projectId!, issue.id).then(() => {
      refreshWithArchive(issue.parent);
      toast.success(t("issues.table.archived"));
      if (onClose) onClose();
      else if (!inPanel) navigate(`/${workspaceSlug}/projects/${projectId}/issues`);
    });
  };

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  useEffect(() => {
    if (issue) setTitleValue(issue.title);
  }, [issue?.title]);

  const saveTitle = () => {
    if (issue && titleValue.trim() && titleValue !== issue.title) {
      updateMutation.mutate({ title: titleValue.trim() });
    }
    setEditingTitle(false);
  };

  const [descValue, setDescValue] = useState("");

  useEffect(() => {
    if (issue) setDescValue(issue.description_html || "");
  }, [issue?.description_html]);

  /* blur 시 변경사항이 있으면 자동 저장 */
  const saveDesc = () => {
    if (issue && descValue !== (issue.description_html || "")) {
      updateMutation.mutate({ description_html: descValue });
    }
  };

  /* PASS5-D — Comments / Links / Attachments / SubIssues mutation 은 각 탭으로 이동 */

  /* ── Node link 추가/삭제 ── */
  const [nodeLinkSearch, setNodeLinkSearch] = useState("");
  const [nodeLinkType, setNodeLinkType] = useState<NodeLinkType>("relates_to");
  const createNodeLinkMutation = useMutation({
    mutationFn: (targetId: string) =>
      issuesApi.nodeLinks.create(workspaceSlug!, projectId!, issueId!, {
        source: issueId!,
        target: targetId,
        link_type: nodeLinkType,
      }),
    onSuccess: () => {
      setNodeLinkSearch("");
      qc.invalidateQueries({ queryKey: ["node-links", issueId] });
      qc.invalidateQueries({ queryKey: ["node-graph", workspaceSlug, projectId] });
    },
    onError: () => toast.error(t("issues.detail.toast.nodeLinkCreateFailed", "관련 이슈 연결에 실패했습니다")),
  });
  const deleteNodeLinkMutation = useMutation({
    mutationFn: (linkId: string) => issuesApi.nodeLinks.delete(workspaceSlug!, linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["node-links", issueId] });
      qc.invalidateQueries({ queryKey: ["node-graph", workspaceSlug, projectId] });
    },
  });

  /* PASS5-D — Attachments / SubIssues mutation 은 각 탭으로 이동 */

  const [activeTab, setActiveTab] = useState<TabId>("sub-issues");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        {t("issues.detail.loading")}
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        {t("issues.detail.notFound")}
      </div>
    );
  }

  /* 프로젝트 식별자 prefix (워크스페이스 slug 앞 3자) */
  const issueRef = `${workspaceSlug?.toUpperCase().slice(0, 3)}-${issue.sequence_id}`;

  return (
    <div className="flex h-full overflow-hidden">

      <div className="flex-1 overflow-y-auto p-6 min-w-0">

        {!inPanel && (
          <Link
            to={`/${workspaceSlug}/projects/${projectId}/issues`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t("issues.detail.backToList")}
          </Link>
        )}

        {/* 부모 이슈 체인 breadcrumb — 하위 이슈일 때만 표시
             inPanel 모드: searchParams의 ?issue= 만 갱신해 패널 내에서 이슈 전환
             풀 페이지 모드: Link로 이동 */}
        {parentChain.length > 0 && (
          <ParentChainBreadcrumb
            chain={parentChain}
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            onNavigate={inPanel ? (id) => setSearchParams((p) => { p.set("issue", id); return p; }) : undefined}
          />
        )}

        {/* Phase 3.3 — shared layoutId. 리스트/카드의 sequence_id span과 매칭되어 자연스럽게 이어짐 */}
        <motion.p layoutId={`issue-ref-${issue.id}`} className="text-xs font-mono text-muted-foreground mb-2">
          {issueRef}
        </motion.p>

        {isArchived && (
          <div className="flex items-center gap-2 mb-3 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
            <Archive className="h-3.5 w-3.5 shrink-0" />
            {t("views.archive.readOnlyNotice")}
          </div>
        )}

        <div className="flex items-start gap-3 mb-4">
          {!readOnly && editingTitle ? (
            <input
              className="flex-1 text-2xl font-semibold bg-transparent border-b-2 border-primary outline-none pb-1"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              autoFocus
            />
          ) : (
            <h1
              className={cn("flex-1 text-2xl font-semibold", !readOnly && "cursor-text hover:opacity-80 transition-opacity")}
              onClick={() => !readOnly && setEditingTitle(true)}
            >
              {issue.title}
            </h1>
          )}
          {/* 작업 ↔ 필드 토글 — 필드는 상태 없는 상위 분류(폴더 성격) */}
          {!readOnly && (
            <div
              className="inline-flex shrink-0 rounded-md border border-border overflow-hidden text-xs mt-1"
              title="필드로 전환하면 상태가 없어지고 보드/번다운에서 제외됩니다"
            >
              <button
                type="button"
                onClick={() => updateMutation.mutate({ is_field: false } as any)}
                className={cn("px-2.5 py-1 transition-colors",
                  !issue.is_field ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/40")}
              >
                작업
              </button>
              <button
                type="button"
                onClick={() => updateMutation.mutate({ is_field: true } as any)}
                className={cn("px-2.5 py-1 border-l border-border transition-colors",
                  issue.is_field ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/40")}
              >
                필드
              </button>
            </div>
          )}
        </div>

        <div className={cn("mb-6", readOnly && "pointer-events-none opacity-70")}>
          <RichTextEditor
            content={descValue}
            onChange={setDescValue}
            onBlur={saveDesc}
            placeholder={t("editor.descriptionPlaceholder")}
            minHeight="80px"
          />
        </div>

        <div className="border-b mb-4">
          <div className="flex gap-0.5">
            {(
              [
                { id: "sub-issues" as TabId, label: `${t("issues.detail.tabs.subIssues")} (${subIssues.length})`, icon: GitBranch },
                { id: "links"      as TabId, label: `${t("issues.detail.tabs.links")} (${links.length})`,          icon: Link2 },
                { id: "nodes"      as TabId, label: `${t("issues.detail.tabs.nodes", "관련 이슈")} (${nodeLinks.length})`, icon: Share2 },
                { id: "attachments" as TabId, label: `${t("issues.detail.tabs.attachments")} (${attachments.length})`, icon: Paperclip },
                { id: "comments"   as TabId, label: `${t("issues.detail.tabs.comments")} (${comments.length})`,      icon: MessageSquare },
                { id: "activity"   as TabId, label: t("issues.detail.tabs.activity"),   icon: Activity },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
                  activeTab === id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "sub-issues" && (
          <SubIssuesTab
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            issueId={issueId!}
            subIssues={subIssues}
            states={states}
            inPanel={inPanel}
            readOnly={readOnly}
          />
        )}

        {activeTab === "links" && (
          <LinksTab
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            issueId={issueId!}
            links={links}
            readOnly={readOnly}
          />
        )}

        {activeTab === "nodes" && (
          <NodeLinksPane
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            issueId={issueId!}
            nodeLinks={nodeLinks}
            nodeLinkType={nodeLinkType}
            setNodeLinkType={setNodeLinkType}
            nodeLinkSearch={nodeLinkSearch}
            setNodeLinkSearch={setNodeLinkSearch}
            createNodeLinkMutation={createNodeLinkMutation}
            deleteNodeLinkMutation={deleteNodeLinkMutation}
            readOnly={readOnly}
          />
        )}

        {activeTab === "attachments" && (
          <AttachmentsTab
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            issueId={issueId!}
            attachments={attachments}
            readOnly={readOnly}
          />
        )}

        {activeTab === "comments" && (
          <CommentsTab
            workspaceSlug={workspaceSlug!}
            projectId={projectId!}
            issueId={issueId!}
            comments={comments}
            currentUserId={user?.id}
            readOnly={readOnly}
          />
        )}

        {activeTab === "activity" && (
          <ActivityTab activities={activities} />
        )}
      </div>

      {/* PASS5-C — 사이드바 추출. picker 들은 onUpdate 콜백 한 번으로 통일, footer 액션은 children 으로 주입 */}
      <IssueMetaSidebar
        issue={issue}
        workspaceSlug={workspaceSlug!}
        projectId={projectId!}
        states={states}
        members={members}
        labels={labels}
        categories={categories}
        sprints={sprints}
        projectIssues={projectIssues}
        parentChain={parentChain}
        onUpdate={(patch) => updateMutation.mutate(patch)}
        inPanel={inPanel}
        readOnly={readOnly}
      >
        <div className={cn("px-4 py-3", isArchived && "pointer-events-auto opacity-100")}>
          {isArchived ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs font-semibold h-7 gap-1.5 mb-3"
              onClick={() => {
                issuesApi.unarchive(workspaceSlug!, projectId!, issue.id).then(() => {
                  refreshWithArchive(issue.parent);
                  refreshIssue(issueId!);
                  toast.success(t("views.archive.restored"));
                });
              }}
            >
              <RotateCcw className="h-3 w-3" />
              {t("views.archive.restore")}
            </Button>
          ) : (
            <div className="flex gap-2 mb-3">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs font-semibold h-7 gap-1.5"
                onClick={handleCopyIssue}
              >
                <Copy className="h-3 w-3" />
                {t("issues.table.copy")}
              </Button>
              {canArchive && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs font-semibold h-7 gap-1.5"
                  onClick={handleArchiveIssue}
                >
                  <Archive className="h-3 w-3" />
                  {t("issues.table.archive")}
                </Button>
              )}
            </div>
          )}
          {canDelete && (
            <div className="p-2.5 border border-destructive/20 bg-destructive/5 rounded-lg">
              <p className="text-2xs font-bold text-destructive mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" /> DANGER ZONE
              </p>
              <Button
                variant="destructive"
                size="sm"
                className="w-full text-xs font-semibold h-7"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirm(t("issues.detail.deleteConfirm"))) {
                    deleteMutation.mutate();
                  }
                }}
              >
                {deleteMutation.isPending ? t("issues.detail.deleting") : t("issues.detail.deleteIssue")}
              </Button>
            </div>
          )}
        </div>
      </IssueMetaSidebar>
    </div>
  );
}

/* PASS5-C — LinkedDocumentsSection 은 IssueMetaSidebar 내부로 이동 */

/* ── 관련 이슈(node link) 패널 ───────────────────────────────
 *  트리 경계를 넘는 자유 연결. 검색 → 선택 → 연결 타입 지정.
 */
const LINK_TYPE_LABEL: Record<string, string> = {
  relates_to: "연결",     // 기본 — 단순 "관련" 관계
  blocks: "블록함",
  blocked_by: "블록됨",
  duplicates: "중복",
  references: "참조",
  shared_label: "같은 라벨",
};

type NodeLinkType = "relates_to" | "blocks" | "blocked_by" | "duplicates" | "references";

function NodeLinksPane({
  workspaceSlug,
  projectId,
  issueId,
  nodeLinks,
  nodeLinkType,
  setNodeLinkType,
  nodeLinkSearch,
  setNodeLinkSearch,
  createNodeLinkMutation,
  deleteNodeLinkMutation,
  readOnly,
}: {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  nodeLinks: import("@/types").IssueNodeLink[];
  nodeLinkType: NodeLinkType;
  setNodeLinkType: (v: NodeLinkType) => void;
  nodeLinkSearch: string;
  setNodeLinkSearch: (v: string) => void;
  createNodeLinkMutation: { mutate: (id: string) => void; isPending: boolean };
  deleteNodeLinkMutation: { mutate: (id: string) => void };
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();

  /* 같은 프로젝트의 이슈 트리 — sub-issue 포함, sort_order + sequence_id 기준 정렬 후
     parent → 자식 순회로 평탄화하면서 depth 부여. TableView 가 이미 같은 queryKey 로 캐싱중. */
  const { data: projectIssues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, { include_sub_issues: "true" }],
    queryFn: () => issuesApi.list(workspaceSlug, projectId, { include_sub_issues: "true" }),
  });

  const projectTree = useMemo(() => {
    const byParent: Record<string, import("@/types").Issue[]> = {};
    for (const i of projectIssues) {
      const key = i.parent ?? "__root__";
      (byParent[key] ??= []).push(i);
    }
    for (const arr of Object.values(byParent)) {
      arr.sort((a, b) => a.sort_order - b.sort_order || a.sequence_id - b.sequence_id);
    }
    const out: Array<import("@/types").Issue & { depth: number }> = [];
    const walk = (parentId: string, depth: number) => {
      for (const c of byParent[parentId] ?? []) {
        out.push({ ...c, depth });
        walk(c.id, depth + 1);
      }
    };
    walk("__root__", 0);
    return out;
  }, [projectIssues]);

  /* 검색어가 있을 때만 다른 프로젝트 결과도 fetch (워크스페이스 검색은 비용↑) */
  const { data: searchResults = [] } = useQuery({
    queryKey: ["issue-search", workspaceSlug, nodeLinkSearch],
    queryFn: () => issuesApi.searchByWorkspace(workspaceSlug, nodeLinkSearch),
    enabled: nodeLinkSearch.trim().length >= 2,
  });

  /* 현재 프로젝트 트리 필터: 검색어가 있으면 title / sequence_id 포함 매칭, 없으면 전체 */
  const trimmedSearch = nodeLinkSearch.trim().toLowerCase();
  const filteredTree = trimmedSearch
    ? projectTree.filter(
        (i) =>
          i.title.toLowerCase().includes(trimmedSearch) ||
          String(i.sequence_id).includes(trimmedSearch),
      )
    : projectTree;

  /* 다른 프로젝트 검색 결과(현재 프로젝트는 트리에서 이미 보이니 제거) */
  const otherProjectResults = (searchResults as import("@/types").IssueSearchResult[])
    .filter((r) => r.project !== projectId)
    .slice(0, 30);

  /* 헬퍼 — 이미 연결되었거나 자기 자신인지 */
  const isLinkedOrSelf = (id: string) =>
    id === issueId ||
    nodeLinks.some(
      (nl) => (nl.source === id || nl.target === id) && nl.link_type === nodeLinkType,
    );

  return (
    <div className="space-y-3">
      {nodeLinks.length === 0 && !readOnly && (
        <p className="text-xs text-muted-foreground py-1">
          {t("issues.detail.nodes.empty", "아직 연결된 이슈가 없습니다. 다른 프로젝트나 트리의 이슈도 자유롭게 연결할 수 있습니다.")}
        </p>
      )}

      {nodeLinks.map((nl: import("@/types").IssueNodeLink) => {
        const isOutgoing = nl.source === issueId;
        const targetLabel = isOutgoing ? nl.target_title : nl.source_title;
        const seq = isOutgoing ? nl.target_sequence_id : nl.source_sequence_id;
        const pid = isOutgoing ? nl.target_project_identifier : nl.source_project_identifier;
        const typeLabel = LINK_TYPE_LABEL[nl.link_type] ?? nl.link_type;
        return (
          <div
            key={nl.id}
            className="flex items-center gap-3 px-3 py-2 rounded-md border hover:bg-muted/20 transition-colors group"
          >
            <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-2xs font-semibold shrink-0">
              {typeLabel}
            </span>
            <button
              className="flex-1 text-left min-w-0"
              onClick={() => {
                const otherId = isOutgoing ? nl.target : nl.source;
                const otherProjectId = isOutgoing ? nl.target_project_id : nl.source_project_id;
                // 같은 프로젝트면 현재 패널 내에서 이슈 전환, 다른 프로젝트면 해당 프로젝트로 이동
                if (otherProjectId && otherProjectId !== projectId) {
                  navigate(`/${workspaceSlug}/projects/${otherProjectId}/issues?issue=${otherId}`);
                } else {
                  setSearchParams((sp) => { sp.set("issue", otherId); return sp; });
                }
              }}
              title={targetLabel ?? ""}
            >
              <div className="text-xs font-medium truncate">
                {pid ? `${pid}-${seq}` : ""} {targetLabel}
              </div>
              {nl.note && <div className="text-2xs text-muted-foreground truncate">{nl.note}</div>}
            </button>
            {!readOnly && (
              <button
                onClick={() => deleteNodeLinkMutation.mutate(nl.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                title={t("issues.detail.nodes.remove", "연결 해제")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <div className="border rounded-md p-3 space-y-2">
          <input
            className="w-full text-xs bg-transparent border-b border-border outline-none pb-1 placeholder:text-muted-foreground"
            placeholder={t("issues.detail.nodes.searchPlaceholder", "이슈 제목으로 검색 (2자 이상)")}
            value={nodeLinkSearch}
            onChange={(e) => setNodeLinkSearch(e.target.value)}
          />
          {/* 타입은 고급 옵션 — 기본 "연결" 로 단순화. 필요한 경우에만 펼쳐서 블록/중복/참조 선택 */}
          <details className="group">
            <summary className="text-2xs text-muted-foreground/70 cursor-pointer hover:text-muted-foreground list-none flex items-center gap-1">
              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              {nodeLinkType === "relates_to"
                ? t("issues.detail.nodes.typeAdvanced", "타입 변경 (현재: 연결)")
                : `현재 타입: ${LINK_TYPE_LABEL[nodeLinkType] ?? nodeLinkType}`}
            </summary>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {(["relates_to", "blocks", "blocked_by", "duplicates", "references"] as NodeLinkType[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setNodeLinkType(k)}
                  className={cn(
                    "text-2xs px-2 py-0.5 rounded border transition-colors",
                    nodeLinkType === k
                      ? "bg-primary/10 border-primary/40 text-primary font-medium"
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  {k === "relates_to" ? "연결" : LINK_TYPE_LABEL[k] ?? k}
                </button>
              ))}
            </div>
          </details>
          {/* 항상 보이는 드롭다운 리스트.
              섹션 1: 같은 프로젝트의 이슈 트리(테이블 정렬 + parent depth indent)
              섹션 2: (검색어 ≥2자일 때만) 다른 프로젝트 검색 결과 */}
          <div className="max-h-72 overflow-y-auto border rounded">
            {filteredTree.length === 0 && otherProjectResults.length === 0 ? (
              <p className="text-2xs text-muted-foreground px-2 py-1.5">
                {t("issues.detail.nodes.searchEmpty", "검색 결과 없음")}
              </p>
            ) : (
              <>
                {filteredTree.length > 0 && (
                  <>
                    <div className="text-2xs uppercase tracking-wider text-muted-foreground/70 px-2 pt-1.5 pb-1 border-b border-border/40 sticky top-0 bg-background z-[1]">
                      {t("issues.detail.nodes.thisProject", "이 프로젝트")}
                    </div>
                    {filteredTree.map((i) => {
                      const linked = isLinkedOrSelf(i.id);
                      return (
                        <button
                          key={i.id}
                          disabled={linked || createNodeLinkMutation.isPending}
                          onClick={() => createNodeLinkMutation.mutate(i.id)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ paddingLeft: 8 + i.depth * 14 }}
                          title={i.title}
                        >
                          {i.depth > 0 && (
                            <span className="text-muted-foreground/40 shrink-0">↳</span>
                          )}
                          <span className="text-muted-foreground shrink-0 font-mono">
                            {i.sequence_id}
                          </span>
                          <span className="flex-1 truncate">{i.title}</span>
                          {linked && (
                            <span className="text-2xs text-muted-foreground shrink-0">
                              {i.id === issueId
                                ? t("issues.detail.nodes.self", "자기 자신")
                                : t("issues.detail.nodes.linked", "연결됨")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </>
                )}
                {otherProjectResults.length > 0 && (
                  <>
                    <div className="text-2xs uppercase tracking-wider text-muted-foreground/70 px-2 pt-1.5 pb-1 border-b border-t border-border/40 sticky top-0 bg-background z-[1]">
                      {t("issues.detail.nodes.otherProjects", "다른 프로젝트")}
                    </div>
                    {otherProjectResults.map((r) => {
                      const linked = isLinkedOrSelf(r.id);
                      return (
                        <button
                          key={r.id}
                          disabled={linked || createNodeLinkMutation.isPending}
                          onClick={() => createNodeLinkMutation.mutate(r.id)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
                          title={r.title}
                        >
                          <span className="text-muted-foreground shrink-0 font-mono">
                            {r.project_identifier}-{r.sequence_id}
                          </span>
                          <span className="flex-1 truncate">{r.title}</span>
                          {linked && (
                            <span className="text-2xs text-muted-foreground shrink-0">
                              {t("issues.detail.nodes.linked", "연결됨")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>
          {nodeLinkSearch.trim().length === 1 && (
            <p className="text-2xs text-muted-foreground/70 px-1">
              {t("issues.detail.nodes.searchHint", "다른 프로젝트 검색은 2자 이상 입력")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
