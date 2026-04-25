import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2, GitBranch, MessageSquare, Activity, Send, Link2, ExternalLink, X, AlertTriangle, Paperclip, Upload, FileText, Image as ImageIcon, Copy, Archive, RotateCcw, Share2 } from "lucide-react";
import { toast } from "sonner";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { useAuthStore } from "@/stores/authStore";
import { useUndoStore } from "@/stores/undoStore";
import { documentsApi } from "@/api/documents";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { DatePicker } from "@/components/ui/date-picker";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { formatLongDate } from "@/utils/date-format";
import { useParentChain } from "@/hooks/useParentChain";
import { useIssueRefresh } from "@/hooks/useIssueMutations";
import { ParentChainBreadcrumb } from "@/components/issues/parent-chain-breadcrumb";
import { ParentPicker } from "@/components/issues/parent-picker";
import { StatePicker } from "@/components/issues/state-picker";
import { PriorityPicker } from "@/components/issues/priority-picker";
import { AssigneePicker } from "@/components/issues/assignee-picker";
import { LabelPicker } from "@/components/issues/label-picker";
import { CategoryPicker } from "@/components/issues/category-picker";
import { SprintPicker } from "@/components/issues/sprint-picker";
import type { Issue, IssueAttachment, Priority } from "@/types";

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "#ef4444" },
  high:   { label: "High",   color: "#f97316" },
  medium: { label: "Medium", color: "#eab308" },
  low:    { label: "Low",    color: "#60a5fa" },
  none:   { label: "None",   color: "#9ca3af" },
};

const fmtDate = (iso: string) => formatLongDate(iso);

/* 파일 크기 포맷 (bytes → 읽기 쉬운 단위) */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [searchParams, setSearchParams] = useSearchParams();
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
  });

  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug!, projectId!),
    enabled: !!issue,
  });

  const { data: labels = [] } = useQuery({
    queryKey: ["labels", projectId],
    queryFn: () => issuesApi.labels.list(workspaceSlug!, projectId!),
    enabled: !!issue,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, projectId],
    queryFn: () => projectsApi.categories.list(workspaceSlug!, projectId!),
    enabled: !!issue,
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn: () => projectsApi.sprints.list(workspaceSlug!, projectId!),
    enabled: !!issue,
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

  const [commentText, setCommentText] = useState("");

  const createCommentMutation = useMutation({
    mutationFn: () =>
      issuesApi.comments.create(workspaceSlug!, projectId!, issueId!, {
        comment_html: commentText,
      }),
    onSuccess: () => {
      setCommentText("");
      qc.invalidateQueries({ queryKey: ["comments", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.commentCreateFailed")),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) =>
      issuesApi.comments.delete(workspaceSlug!, projectId!, issueId!, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", issueId] }),
    onError: () => toast.error(t("issues.detail.toast.commentDeleteFailed")),
  });

  const [addingLink, setAddingLink] = useState(false);
  const [linkForm, setLinkForm] = useState({ title: "", url: "" });

  const createLinkMutation = useMutation({
    mutationFn: () =>
      issuesApi.links.create(workspaceSlug!, projectId!, issueId!, linkForm),
    onSuccess: () => {
      setLinkForm({ title: "", url: "" });
      setAddingLink(false);
      qc.invalidateQueries({ queryKey: ["links", issueId] });
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.linkCreateFailed")),
  });

  const deleteLinkMutation = useMutation({
    mutationFn: (linkId: string) =>
      issuesApi.links.delete(workspaceSlug!, projectId!, issueId!, linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["links", issueId] });
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.linkDeleteFailed")),
  });

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

  const uploadAttachmentMutation = useMutation({
    mutationFn: (file: File) =>
      issuesApi.attachments.upload(workspaceSlug!, projectId!, issueId!, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments", issueId] });
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.attachmentUploadFailed")),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      issuesApi.attachments.delete(workspaceSlug!, projectId!, issueId!, attachmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments", issueId] });
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.attachmentDeleteFailed")),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => uploadAttachmentMutation.mutate(file));
    e.target.value = ""; // 같은 파일 재업로드 허용
  };

  const [addingSubIssue, setAddingSubIssue] = useState(false);
  const [subIssueTitle, setSubIssueTitle] = useState("");

  const createSubIssueMutation = useMutation({
    mutationFn: () => {
      /* Todo(unstarted) 우선 선택 → default → 첫 번째 */
      const defaultState = states.find((s) => s.group === "unstarted") ?? states.find((s) => s.default) ?? states[0];
      return issuesApi.subIssues.create(workspaceSlug!, projectId!, issueId!, {
        title: subIssueTitle.trim(),
        priority: "none",
        ...(defaultState ? { state: defaultState.id } : {}),
      });
    },
    onSuccess: () => {
      setSubIssueTitle("");
      setAddingSubIssue(false);
      refresh(issueId);
      refreshIssue(issueId!);
    },
    onError: () => toast.error(t("issues.detail.toast.subIssueCreateFailed")),
  });

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
          <div className="space-y-1.5">
            {subIssues.map((sub) => (
              <div
                key={sub.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (inPanel) {
                    setSearchParams((p) => { p.set("issue", sub.id); return p; });
                  } else {
                    const viewParam = searchParams.get("view");
                    const qs = new URLSearchParams();
                    if (viewParam) qs.set("view", viewParam);
                    qs.set("issue", sub.id);
                    navigate(`/${workspaceSlug}/projects/${projectId}/issues?${qs.toString()}`);
                  }
                }}
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
                <span
                  className="text-xs shrink-0"
                  style={{ color: PRIORITY_CONFIG[sub.priority].color }}
                >
                  {PRIORITY_CONFIG[sub.priority].label}
                </span>
              </div>
            ))}

            {readOnly ? null : addingSubIssue ? (
              <div className="flex items-center gap-2 px-3 py-2.5 border rounded-md">
                <input
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                  value={subIssueTitle}
                  onChange={(e) => setSubIssueTitle(e.target.value)}
                  placeholder={t("issues.detail.subIssues.addPlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && subIssueTitle.trim()) {
                      createSubIssueMutation.mutate();
                    }
                    if (e.key === "Escape") {
                      setAddingSubIssue(false);
                      setSubIssueTitle("");
                    }
                  }}
                  onBlur={() => {
                    /* 바깥 클릭 시 입력값 있으면 생성, 없으면 닫기 */
                    if (subIssueTitle.trim()) {
                      createSubIssueMutation.mutate();
                    } else {
                      setAddingSubIssue(false);
                      setSubIssueTitle("");
                    }
                  }}
                  ref={(el) => { if (el) el.focus({ preventScroll: true }); }}
                />
                <button
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    setAddingSubIssue(false);
                    setSubIssueTitle("");
                  }}
                >
                  {t("issues.detail.subIssues.cancel")}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingSubIssue(true)}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 mt-1"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("issues.detail.subIssues.add")}
              </button>
            )}
          </div>
        )}

        {activeTab === "links" && (
          <div className="space-y-3">
            {links.length === 0 && !addingLink && (
              <p className="text-xs text-muted-foreground py-2">{t("issues.detail.links.empty")}</p>
            )}

            {links.map((link) => (
              <div
                key={link.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md border hover:bg-muted/20 transition-colors group"
              >
                <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  {link.title && (
                    <p className="text-xs font-medium truncate">{link.title}</p>
                  )}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-primary hover:underline flex items-center gap-1 truncate"
                  >
                    {link.url}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={() => deleteLinkMutation.mutate(link.id)}
                  title={t("common.delete")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {readOnly ? null : addingLink ? (
              <div className="border rounded-md p-3 space-y-2">
                <input
                  className="w-full text-xs bg-transparent border-b border-border outline-none pb-1 placeholder:text-muted-foreground"
                  placeholder={t("issues.detail.links.titlePlaceholder")}
                  value={linkForm.title}
                  onChange={(e) => setLinkForm((p) => ({ ...p, title: e.target.value }))}
                />
                <input
                  className="w-full text-xs bg-transparent border-b border-border outline-none pb-1 placeholder:text-muted-foreground"
                  placeholder={t("issues.detail.links.urlPlaceholder")}
                  value={linkForm.url}
                  onChange={(e) => setLinkForm((p) => ({ ...p, url: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && linkForm.url.trim()) createLinkMutation.mutate();
                    if (e.key === "Escape") { setAddingLink(false); setLinkForm({ title: "", url: "" }); }
                  }}
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => { setAddingLink(false); setLinkForm({ title: "", url: "" }); }}
                  >
                    {t("issues.detail.links.cancel")}
                  </button>
                  <button
                    className="text-xs text-primary hover:underline disabled:opacity-40"
                    disabled={!linkForm.url.trim() || createLinkMutation.isPending}
                    onClick={() => createLinkMutation.mutate()}
                  >
                    {t("issues.detail.links.submit")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingLink(true)}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("issues.detail.links.add")}
              </button>
            )}
          </div>
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
          <div className="space-y-3">
            {attachments.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">{t("issues.detail.attachments.empty")}</p>
            )}

            {attachments.map((att: IssueAttachment) => {
              const isImage = att.mime_type.startsWith("image/");
              return (
                <div
                  key={att.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md border hover:bg-muted/20 transition-colors group"
                >
                  {isImage ? (
                    <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <a
                      href={att.file}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-primary hover:underline truncate block"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {att.filename}
                    </a>
                    <p className="text-2xs text-muted-foreground">
                      {formatFileSize(att.size)} · {att.uploaded_by_detail?.display_name} · {fmtDate(att.created_at)}
                    </p>
                  </div>
                  {isImage && (
                    <a href={att.file} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                      <img
                        src={att.file}
                        alt={att.filename}
                        className="h-10 w-10 rounded object-cover border shrink-0"
                      />
                    </a>
                  )}
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => deleteAttachmentMutation.mutate(att.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}

            {!readOnly && (
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                {uploadAttachmentMutation.isPending ? t("issues.detail.attachments.uploading") : t("issues.detail.attachments.upload")}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={uploadAttachmentMutation.isPending}
                />
              </label>
            )}
          </div>
        )}

        {activeTab === "comments" && (
          <div className="space-y-5">
            {comments.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">{t("issues.detail.comments.empty")}</p>
            )}

            {comments.map((comment) => (
              <div key={comment.id} className="flex gap-3">
                <AvatarInitials name={comment.actor_detail?.display_name} avatar={comment.actor_detail?.avatar} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium">{comment.actor_detail?.display_name}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(comment.created_at)}</span>
                    {/* 본인 댓글만 삭제 가능 */}
                    {comment.actor === user?.id && (
                      <button
                        className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => deleteCommentMutation.mutate(comment.id)}
                        title={t("common.delete")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{comment.comment_html}</p>
                </div>
              </div>
            ))}

            {!readOnly && (
              <div className="flex gap-2 pt-1">
                <textarea
                  className="flex-1 text-sm bg-muted/20 border border-border rounded-md px-3 py-2 outline-none resize-none focus:border-primary transition-colors min-h-[72px]"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={t("issues.detail.comments.placeholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && commentText.trim()) {
                      createCommentMutation.mutate();
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={!commentText.trim() || createCommentMutation.isPending}
                  onClick={() => createCommentMutation.mutate()}
                  className="self-end"
                  title={t("issues.detail.comments.submit")}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}

        {activeTab === "activity" && (
          <div className="space-y-3">
            {activities.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">{t("issues.detail.activity.empty")}</p>
            )}
            {activities.map((act) => (
              <div key={act.id} className="flex gap-2 items-start text-xs">
                <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-2xs font-semibold shrink-0 mt-0.5">
                  {act.actor_detail?.display_name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 leading-relaxed">
                  <span className="font-medium">{act.actor_detail?.display_name}</span>
                  {" "}
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground/70">{act.field}</span>
                    {act.old_value
                      ? ` ${t("issues.detail.activity.changed")} ${t("issues.detail.activity.from")} "${act.old_value}" `
                      : ` ${t("issues.detail.activity.changed")} `}
                    {act.new_value
                      ? `${t("issues.detail.activity.to")} "${act.new_value}"`
                      : `(${t("issues.detail.activity.deleted")})`}
                  </span>
                  <span className="text-muted-foreground/60 ml-1">
                    · {fmtDate(act.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="w-[26rem] shrink-0 border-l border-border overflow-y-auto bg-muted/5">
        {/* pt-10: 패널 모드에서 닫기(X) 버튼과 겹침 방지 */}
        <div className={cn("divide-y divide-border/60", inPanel && "pt-10", readOnly && "pointer-events-none opacity-70")}>

          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("issues.detail.meta.state")}</p>
              {issue.is_field ? (
                <div className="border border-border/60 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground bg-muted/30">—</div>
              ) : (
                <StatePicker
                  states={states}
                  currentStateId={issue.state}
                  currentState={issue.state_detail}
                  onChange={(id) => updateMutation.mutate({ state: id })}
                  className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
                />
              )}
            </div>
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("issues.detail.meta.priority")}</p>
              <PriorityPicker
                currentPriority={issue.priority}
                onChange={(p) => updateMutation.mutate({ priority: p })}
                className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("issues.detail.meta.assignee")}</p>
              <AssigneePicker
                members={members}
                currentIds={issue.assignees}
                currentDetails={issue.assignee_details}
                onChange={(ids) => updateMutation.mutate({ assignees: ids })}
                className="border border-border rounded-md bg-input/60 hover:bg-primary/10 min-h-[32px]"
              />
            </div>
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("issues.detail.meta.label")}</p>
              <LabelPicker
                labels={labels}
                currentIds={issue.label}
                currentDetails={issue.label_details}
                onChange={(ids) => updateMutation.mutate({ label: ids })}
                className="border border-border rounded-md bg-input/60 hover:bg-primary/10 min-h-[32px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("sidebar.modules")}</p>
              <CategoryPicker
                categories={categories}
                currentId={issue.category}
                onChange={(id) => updateMutation.mutate({ category: id })}
                className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
                disabled={!!issue.parent}
                disabledReason={issue.parent ? t("issues.categoryInheritsFromParent", "하위 이슈는 상위 이슈의 모듈을 따라갑니다") : undefined}
              />
            </div>
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("views.cycleFilter.label")}</p>
              <SprintPicker
                sprints={sprints}
                currentId={issue.sprint}
                onChange={(id) => updateMutation.mutate({ sprint: id })}
                className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("issues.detail.meta.startDate")}</p>
              <DatePicker
                value={issue.start_date ?? null}
                onChange={(v) => updateMutation.mutate({ start_date: v })}
                placeholder={t("datePicker.placeholder")}
                className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
                hintDate={issue.due_date ?? null}
                hintMode="after"
              />
            </div>
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("issues.detail.meta.dueDate")}</p>
              <DatePicker
                value={issue.due_date ?? null}
                onChange={(v) => updateMutation.mutate({ due_date: v })}
                placeholder={t("datePicker.placeholder")}
                className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
                hintDate={issue.start_date ?? null}
                hintMode="before"
              />
            </div>
          </div>

          <div className="px-4 py-3">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("issues.detail.meta.parentIssue")}</p>
            <ParentPicker
              issues={projectIssues}
              currentIssueId={issue.id}
              excludeIds={parentChain.map((p) => p.id)}
              currentParentId={issue.parent}
              refPrefix={workspaceSlug?.toUpperCase().slice(0, 3) ?? ""}
              onChange={(pid) => updateMutation.mutate({ parent: pid })}
            />
          </div>

          <div className="px-4 py-3">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("issues.detail.meta.info")}</p>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-2xs">
              <span className="text-muted-foreground">{t("issues.detail.meta.createdBy")}</span>
              <span className="text-foreground/80 truncate">{issue.created_by_detail?.display_name ?? "—"}</span>
              <span className="text-muted-foreground">{t("issues.detail.meta.createdAt")}</span>
              <span className="text-foreground/80 truncate">{fmtDate(issue.created_at)}</span>
              <span className="text-muted-foreground">{t("issues.detail.meta.updatedAt")}</span>
              <span className="text-foreground/80 truncate">{fmtDate(issue.updated_at)}</span>
            </div>
          </div>

          {/* 연결된 문서 */}
          <LinkedDocumentsSection issueId={issue.id} workspaceSlug={workspaceSlug!} projectId={projectId!} />

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

        </div>
      </div>
    </div>
  );
}

/* ── 연결된 문서 섹션 ── */

function LinkedDocumentsSection({ issueId, workspaceSlug, projectId }: { issueId: string; workspaceSlug: string; projectId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: links = [] } = useQuery({
    queryKey: ["issue-doc-links", issueId],
    queryFn: () => issuesApi.documentLinks(workspaceSlug, projectId, issueId),
    enabled: !!issueId,
  });

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">
          {t("issues.detail.linkedDocs")}
        </p>
        <button
          className="text-2xs text-primary hover:underline"
          onClick={() => {
            // 프로젝트 문서 스페이스로 이동하여 새 문서 생성
            documentsApi.spaces.list(workspaceSlug).then((spaces) => {
              const ps = spaces.find((s) => s.space_type === "project");
              if (ps) {
                documentsApi.create(workspaceSlug, ps.id, {
                  title: `Issue #${issueId.slice(0, 8)}`,
                }).then((doc) => {
                  navigate(`/${workspaceSlug}/documents/space/${ps.id}/${doc.id}`);
                });
              }
            });
          }}
        >
          + {t("issues.detail.createDoc")}
        </button>
      </div>
      {links.length === 0 ? (
        <p className="text-2xs text-muted-foreground/50">{t("issues.detail.noDocs")}</p>
      ) : (
        <div className="space-y-1">
          {links.map((link) => (
            <button
              key={link.id}
              onClick={() => navigate(`/${workspaceSlug}/documents/space/${link.space_id}/${link.document_id}`)}
              className="flex items-center gap-2 w-full text-left text-xs hover:text-primary transition-colors py-0.5"
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{link.document_title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
