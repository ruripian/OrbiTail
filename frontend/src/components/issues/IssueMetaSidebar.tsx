import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { documentsApi } from "@/api/documents";
import { StatePicker } from "@/components/issues/state-picker";
import { PriorityPicker } from "@/components/issues/priority-picker";
import { AssigneePicker } from "@/components/issues/assignee-picker";
import { LabelPicker } from "@/components/issues/label-picker";
import { CategoryPicker } from "@/components/issues/category-picker";
import { SprintPicker } from "@/components/issues/sprint-picker";
import { ParentPicker } from "@/components/issues/parent-picker";
import { DatePicker } from "@/components/ui/date-picker";
import { DocumentPickerDialog } from "@/components/documents/DocumentPickerDialog";
import { CreateDocumentDialog } from "@/components/documents/CreateDocumentDialog";
import { formatLongDate } from "@/utils/date-format";
import { cn } from "@/lib/utils";
import type {
  Issue, State, Label, Category, Sprint, ProjectMember,
} from "@/types";

/**
 * PASS5-C — IssueDetailPage 우측 사이드바 분리.
 *
 * 7개 picker 그룹 (State/Priority + Assignee/Label + Category/Sprint + Dates + Parent)
 * + Info + LinkedDocumentsSection + footer slot(children).
 *
 * onUpdate(patch) 한 콜백으로 mutation 을 wrap — IssueDetailPage 가 invalidate/undo 처리.
 * footer 의 Copy/Archive/Restore/Delete 버튼은 host 가 children 으로 주입 (mutation 분리 유지).
 */

export interface IssueMetaSidebarProps {
  issue: Issue;
  workspaceSlug: string;
  projectId: string;
  states: State[];
  members: ProjectMember[];
  labels: Label[];
  categories: Category[];
  sprints: Sprint[];
  projectIssues: Issue[];
  parentChain: Issue[];
  onUpdate: (patch: Partial<Issue>) => void;
  /** 패널 모드에서 닫기(X) 버튼과 겹치지 않게 상단 padding */
  inPanel?: boolean;
  /** 보관/권한 없음 — picker 비활성 */
  readOnly?: boolean;
  /** 사이드바 footer (Copy/Archive/Restore/Delete 등 액션 버튼군) */
  children?: ReactNode;
}

const fmtDate = (iso: string) => formatLongDate(iso);

export function IssueMetaSidebar({
  issue,
  workspaceSlug,
  projectId,
  states,
  members,
  labels,
  categories,
  sprints,
  projectIssues,
  parentChain,
  onUpdate,
  inPanel = false,
  readOnly = false,
  children,
}: IssueMetaSidebarProps) {
  const { t } = useTranslation();

  return (
    <div className="w-[26rem] shrink-0 border-l border-border overflow-y-auto bg-muted/5">
      <div className={cn("divide-y divide-border/60", inPanel && "pt-10", readOnly && "pointer-events-none opacity-70")}>

        {/* Row 1 — State + Priority */}
        <div className="grid grid-cols-2 gap-3 px-4 py-3">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              {t("issues.detail.meta.state")}
            </p>
            {issue.is_field ? (
              <div className="border border-border/60 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground bg-muted/30">—</div>
            ) : (
              <StatePicker
                states={states}
                currentStateId={issue.state}
                currentState={issue.state_detail}
                onChange={(id) => onUpdate({ state: id })}
                className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
              />
            )}
          </div>
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              {t("issues.detail.meta.priority")}
            </p>
            <PriorityPicker
              currentPriority={issue.priority}
              onChange={(p) => onUpdate({ priority: p })}
              className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
            />
          </div>
        </div>

        {/* Row 2 — Assignee + Label */}
        <div className="grid grid-cols-2 gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              {t("issues.detail.meta.assignee")}
            </p>
            <AssigneePicker
              members={members}
              currentIds={issue.assignees}
              currentDetails={issue.assignee_details}
              onChange={(ids) => onUpdate({ assignees: ids })}
              className="border border-border rounded-md bg-input/60 hover:bg-primary/10 min-h-[32px]"
            />
          </div>
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              {t("issues.detail.meta.label")}
            </p>
            <LabelPicker
              labels={labels}
              currentIds={issue.label}
              currentDetails={issue.label_details}
              onChange={(ids) => onUpdate({ label: ids })}
              className="border border-border rounded-md bg-input/60 hover:bg-primary/10 min-h-[32px]"
            />
          </div>
        </div>

        {/* Row 3 — Category(Modules) + Sprint */}
        <div className="grid grid-cols-2 gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              {t("sidebar.modules")}
            </p>
            <CategoryPicker
              categories={categories}
              currentId={issue.category}
              onChange={(id) => onUpdate({ category: id })}
              className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
              disabled={!!issue.parent}
              disabledReason={issue.parent ? t("issues.categoryInheritsFromParent", "하위 이슈는 상위 이슈의 모듈을 따라갑니다") : undefined}
            />
          </div>
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              {t("views.cycleFilter.label")}
            </p>
            <SprintPicker
              sprints={sprints}
              currentId={issue.sprint}
              onChange={(id) => onUpdate({ sprint: id })}
              className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
            />
          </div>
        </div>

        {/* Row 4 — Dates */}
        <div className="grid grid-cols-2 gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              {t("issues.detail.meta.startDate")}
            </p>
            <DatePicker
              value={issue.start_date ?? null}
              onChange={(v) => onUpdate({ start_date: v })}
              placeholder={t("datePicker.placeholder")}
              className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
              hintDate={issue.due_date ?? null}
              hintMode="after"
            />
          </div>
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              {t("issues.detail.meta.dueDate")}
            </p>
            <DatePicker
              value={issue.due_date ?? null}
              onChange={(v) => onUpdate({ due_date: v })}
              placeholder={t("datePicker.placeholder")}
              className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
              hintDate={issue.start_date ?? null}
              hintMode="before"
            />
          </div>
        </div>

        {/* Parent */}
        <div className="px-4 py-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
            {t("issues.detail.meta.parentIssue")}
          </p>
          <ParentPicker
            issues={projectIssues}
            currentIssueId={issue.id}
            excludeIds={parentChain.map((p) => p.id)}
            currentParentId={issue.parent}
            refPrefix={workspaceSlug?.toUpperCase().slice(0, 3) ?? ""}
            onChange={(pid) => onUpdate({ parent: pid })}
          />
        </div>

        {/* Info */}
        <div className="px-4 py-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
            {t("issues.detail.meta.info")}
          </p>
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
        <LinkedDocumentsSection issueId={issue.id} workspaceSlug={workspaceSlug} projectId={projectId} />

        {/* footer — host 가 주입한 액션 버튼 그룹. Archive 인 경우 readOnly 와 무관하게 동작하도록 host 책임. */}
        {children}
      </div>
    </div>
  );
}

/* ── 연결된 문서 섹션 (PASS5-C: IssueDetailPage 에서 이동, 외부 export 없음) ── */

function LinkedDocumentsSection({ issueId, workspaceSlug, projectId }: { issueId: string; workspaceSlug: string; projectId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: links = [] } = useQuery({
    queryKey: ["issue-doc-links", issueId],
    queryFn: () => issuesApi.documentLinks(workspaceSlug, projectId, issueId),
    enabled: !!issueId,
  });

  const linkDocToIssue = async (docSpaceId: string, docId: string) => {
    await documentsApi.issues.link(workspaceSlug, docSpaceId, docId, issueId);
    qc.invalidateQueries({ queryKey: ["issue-doc-links", issueId] });
  };

  const unlinkMutation = useMutation({
    mutationFn: ({ docSpaceId, docId }: { docSpaceId: string; docId: string }) =>
      documentsApi.issues.unlink(workspaceSlug, docSpaceId, docId, issueId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issue-doc-links", issueId] }),
  });

  const { data: spaces = [] } = useQuery({
    queryKey: ["document-spaces", workspaceSlug],
    queryFn: () => documentsApi.spaces.list(workspaceSlug),
    enabled: !!workspaceSlug,
  });
  const projectSpaceId = spaces.find((s) => s.space_type === "project" && s.project === projectId)?.id;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">
          {t("issues.detail.linkedDocs")}
        </p>
        <div className="flex items-center gap-2">
          <button className="text-2xs text-primary hover:underline" onClick={() => setPickerOpen(true)}>
            + 기존 문서
          </button>
          <button className="text-2xs text-primary hover:underline" onClick={() => setCreateOpen(true)}>
            + 새 문서
          </button>
        </div>
      </div>
      {links.length === 0 ? (
        <p className="text-2xs text-muted-foreground/50">{t("issues.detail.noDocs")}</p>
      ) : (
        <div className="space-y-1">
          {links.map((link) => (
            <div key={link.id} className="group flex items-center gap-2">
              <button
                onClick={() => navigate(`/${workspaceSlug}/documents/space/${link.space_id}/${link.document_id}`)}
                className="flex items-center gap-2 flex-1 text-left text-xs hover:text-primary transition-colors py-0.5 min-w-0"
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{link.document_title}</span>
              </button>
              <button
                onClick={() => unlinkMutation.mutate({ docSpaceId: link.space_id, docId: link.document_id })}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity text-2xs"
                title="연결 해제"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <DocumentPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        workspaceSlug={workspaceSlug}
        excludeIds={links.map((l) => l.document_id)}
        onSelect={async (doc) => { await linkDocToIssue(doc.space, doc.id); }}
      />
      <CreateDocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceSlug={workspaceSlug}
        defaultSpaceId={projectSpaceId}
        defaultTitle={`Issue 관련 문서`}
        onCreated={async (doc) => {
          await linkDocToIssue(doc.space, doc.id);
          navigate(`/${workspaceSlug}/documents/space/${doc.space}/${doc.id}`);
        }}
      />
    </div>
  );
}
