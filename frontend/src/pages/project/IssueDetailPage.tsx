import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Plus, Trash2, GitBranch, MessageSquare, Activity, Send, Link2, ExternalLink, X, AlertTriangle, Paperclip, Upload, FileText, Image as ImageIcon, Copy, Archive, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { DatePicker } from "@/components/ui/date-picker";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { formatLongDate } from "@/utils/date-format";
import { useParentChain } from "@/hooks/useParentChain";
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

type TabId = "sub-issues" | "links" | "attachments" | "comments" | "activity";

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
  const qc = useQueryClient();

  const { data: issue, isLoading } = useQuery({
    queryKey: ["issue", issueId],
    queryFn: () => issuesApi.get(workspaceSlug!, projectId!, issueId!),
  });

  const isArchived = !!issue?.archived_at;

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
      qc.invalidateQueries({ queryKey: ["activities", issueId] });
      qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
      qc.invalidateQueries({ queryKey: ["my-issues", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["recent-issues", workspaceSlug] });
    },
    onError: () => toast.error(t("issues.detail.toast.updateFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => issuesApi.delete(workspaceSlug!, projectId!, issueId!),
    onSuccess: () => {
      toast.success(t("common.issueDeleteSuccess"));
      qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
      if (onClose) onClose();
      else if (!inPanel) navigate(`/${workspaceSlug}/projects/${projectId}/issues`);
    },
    onError: () => toast.error(t("common.issueDeleteError")),
  });

  const handleCopyIssue = () => {
    if (!issue) return;
    issuesApi.duplicate(workspaceSlug!, projectId!, issue.id).then(() => {
      qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
      qc.invalidateQueries({ queryKey: ["my-issues", workspaceSlug] });
      if (issue.parent) qc.invalidateQueries({ queryKey: ["sub-issues", issue.parent] });
      toast.success(t("issues.table.copied"));
      // 복사 후 디테일 창 닫기
      if (onClose) onClose();
      else if (!inPanel) navigate(`/${workspaceSlug}/projects/${projectId}/issues`);
    });
  };

  const handleArchiveIssue = () => {
    if (!issue) return;
    issuesApi.archive(workspaceSlug!, projectId!, issue.id).then(() => {
      qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
      qc.invalidateQueries({ queryKey: ["issues-archive", workspaceSlug, projectId] });
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
      qc.invalidateQueries({ queryKey: ["sub-issues", issueId] });
      // sub_issues_count 반영을 위해 부모 이슈도 갱신
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
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

        <p className="text-xs font-mono text-muted-foreground mb-2">{issueRef}</p>

        {isArchived && (
          <div className="flex items-center gap-2 mb-3 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
            <Archive className="h-3.5 w-3.5 shrink-0" />
            {t("views.archive.readOnlyNotice")}
          </div>
        )}

        {!isArchived && editingTitle ? (
          <input
            className="w-full text-2xl font-semibold bg-transparent border-b-2 border-primary outline-none pb-1 mb-4"
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
            className={cn("text-2xl font-semibold mb-4", !isArchived && "cursor-text hover:opacity-80 transition-opacity")}
            onClick={() => !isArchived && setEditingTitle(true)}
          >
            {issue.title}
          </h1>
        )}

        <div className={cn("mb-6", isArchived && "pointer-events-none opacity-70")}>
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
              <Link
                key={sub.id}
                to={`/${workspaceSlug}/projects/${projectId}/issues?issue=${sub.id}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md border hover:bg-muted/30 transition-colors"
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
              </Link>
            ))}

            {isArchived ? null : addingSubIssue ? (
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

            {isArchived ? null : addingLink ? (
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

            {!isArchived && (
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
                <AvatarInitials name={comment.actor_detail?.display_name} size="md" />
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

            {!isArchived && (
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
        <div className={cn("divide-y divide-border/60", inPanel && "pt-10", isArchived && "pointer-events-none opacity-70")}>

          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{t("issues.detail.meta.state")}</p>
              <StatePicker
                states={states}
                currentStateId={issue.state}
                currentState={issue.state_detail}
                onChange={(id) => updateMutation.mutate({ state: id })}
                className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
              />
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

          <div className={cn("px-4 py-3", isArchived && "pointer-events-auto opacity-100")}>
            {isArchived ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs font-semibold h-7 gap-1.5 mb-3"
                onClick={() => {
                  issuesApi.unarchive(workspaceSlug!, projectId!, issue.id).then(() => {
                    qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
                    qc.invalidateQueries({ queryKey: ["issues-archive", workspaceSlug, projectId] });
                    qc.invalidateQueries({ queryKey: ["issue", issueId] });
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
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs font-semibold h-7 gap-1.5"
                  onClick={handleArchiveIssue}
                >
                  <Archive className="h-3 w-3" />
                  {t("issues.table.archive")}
                </Button>
              </div>
            )}
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
          </div>

        </div>
      </div>
    </div>
  );
}
