import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileText, Users, UserX } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { documentsApi } from "@/api/documents";
import { projectsApi } from "@/api/projects";
import { StatePicker } from "@/components/issues/state-picker";
import { PriorityPicker } from "@/components/issues/priority-picker";
import { UserPicker, membersToUsers, mergeUsers } from "@/components/ui/user-picker";
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
  Issue, State, Label, Category, ProjectMember,
} from "@/types";

/**
 * PASS5-C — IssueDetailPage 우측 사이드바 분리.
 *
 * picker 그룹 (State/Priority + Assignee/Label + Category + Dates + Parent)
 * + Info + LinkedDocumentsSection + footer slot(children).
 *
 * onUpdate(patch) 한 콜백으로 mutation 을 wrap — IssueDetailPage 가 invalidate/undo 처리.
 * footer 의 Copy/Archive/Restore/Delete 버튼은 host 가 children 으로 주입 (mutation 분리 유지).
 */

export interface IssueMetaSidebarProps {
  issue: Issue;
  workspaceSlug: string;
  projectId: string;
  projectIdentifier?: string;
  states: State[];
  members: ProjectMember[];
  labels: Label[];
  categories: Category[];
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
  projectIdentifier,
  states,
  members,
  labels,
  categories,
  projectIssues,
  parentChain,
  onUpdate,
  inPanel = false,
  readOnly = false,
  children,
}: IssueMetaSidebarProps) {
  /* 스프린트 목록은 여기서 직접 조회한다 — 호출부(상세/패널/다이얼로그)마다 prop 을 늘리지 않기 위함.
     같은 queryKey 라 다른 화면과 캐시를 공유하므로 추가 요청이 생기지 않는다. */
  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn: () => projectsApi.sprints.list(workspaceSlug, projectId),
    enabled: !!workspaceSlug && !!projectId,
  });
  const { t } = useTranslation();

  return (
    <div className="w-[26rem] shrink-0 border-l border-border overflow-y-auto bg-muted/5">
      <div className={cn("divide-y divide-border/60", inPanel && "pt-10", readOnly && "pointer-events-none opacity-70")}>

        {/* 연결된 문서 — 사이드바 최상단으로 격상(메인 기능). 진입 즉시 가시 + 빈 상태에 큰 CTA. */}
        <LinkedDocumentsSection issueId={issue.id} workspaceSlug={workspaceSlug} projectId={projectId} />

        {/* Row 1 — State + Priority */}
        <div className="grid grid-cols-2 gap-3 px-4 py-3">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              {t("issues.detail.meta.state")}
            </p>
            {/* 필드도 이 선택기에서 고른다 — 전환 경로를 상태 선택기 하나로 통일 */}
            <StatePicker
              states={states}
              currentStateId={issue.state}
              currentState={issue.state_detail}
              isField={issue.is_field}
              onChange={(id) => onUpdate({ state: id })}
              onSelectField={() => onUpdate({ is_field: true })}
              className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
            />
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
            <UserPicker
              variant="avatars"
              mode="multi"
              users={mergeUsers(membersToUsers(members), issue.assignee_details)}
              value={issue.assignees ?? []}
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
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              className="border border-border rounded-md bg-input/60 hover:bg-primary/10 min-h-[32px]"
            />
          </div>
        </div>

        {/* Row 3 — Category(Modules) + 스프린트.
            스프린트는 한때 여기서 뺐지만, 그러면 이슈를 열어서 스프린트를 바꿀 길이 사라진다
            (테이블의 스프린트 컬럼은 기본 숨김이라 사실상 생성 시에만 지정 가능했다). */}
        <div className="px-4 py-3">
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

        <div className="px-4 py-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
            {t("issues.table.cols.cycle", "스프린트")}
          </p>
          <SprintPicker
            sprints={sprints}
            currentId={issue.sprint}
            onChange={(id) => onUpdate({ sprint: id })}
            className="border border-border rounded-md bg-input/60 hover:bg-primary/10"
            disabled={readOnly}
          />
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
            refPrefix={projectIdentifier ?? workspaceSlug?.toUpperCase().slice(0, 3) ?? ""}
            onChange={(pid) => onUpdate({ parent: pid })}
          />
        </div>

        {/* 단발성 이슈(Personal 프로젝트) 전용 — 팀 캘린더 공유 토글.
            일반 프로젝트 이슈에선 무의미한 필드이므로 노출 안 함. */}
        {issue.project_kind === "personal" && (
          <div className="px-4 py-3">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              {t("issues.detail.meta.teamShare", "팀 공유")}
            </p>
            <button
              type="button"
              onClick={() => onUpdate({ shared_with_team: !issue.shared_with_team })}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors",
                issue.shared_with_team
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50",
              )}
            >
              {issue.shared_with_team ? (
                <>
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 text-left">{t("issues.detail.meta.sharedWithTeam", "팀 캘린더에 표시")}</span>
                </>
              ) : (
                <>
                  <UserX className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 text-left">{t("issues.detail.meta.notSharedWithTeam", "본인만 보기")}</span>
                </>
              )}
            </button>
          </div>
        )}

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

        {/* footer — host 가 주입한 액션 버튼 그룹. Archive 인 경우 readOnly 와 무관하게 동작하도록 host 책임. */}
        {children}
      </div>
    </div>
  );
}

/* ── 연결된 문서 섹션 (PASS5-C: IssueDetailPage 에서 이동, 외부 export 없음) ── */

/* 5개 초과 시 첫 5개만 노출 + "더보기" 토글. 더 늘리면 사이드바 스크롤이 길어져 다른 메타가 묻힘. */
const VISIBLE_LINK_LIMIT = 5;

function LinkedDocumentsSection({ issueId, workspaceSlug, projectId }: { issueId: string; workspaceSlug: string; projectId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

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
    <div className="px-4 py-4 bg-primary/[0.025]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold tracking-wide text-foreground flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-primary" />
          {t("issues.detail.linkedDocs")}
          {links.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-2xs font-bold">
              {links.length}
            </span>
          )}
        </p>
      </div>
      {links.length === 0 ? (
        /* 빈 상태 — primary 한 개(큰 카드: 기존 문서 연결) + secondary 텍스트(새 문서 만들기).
           위계 분리: 보통 이슈와 연결할 문서는 이미 존재하므로 검색/선택이 주, 신규 생성이 보조. */
        <div className="space-y-1.5">
          <button
            onClick={() => setPickerOpen(true)}
            className="w-full rounded-md border border-dashed border-primary/40 bg-background/60 px-3 py-3 text-xs text-primary hover:bg-primary/10 hover:border-primary/60 transition-colors flex items-center justify-center gap-1.5 font-medium"
          >
            <FileText className="h-3.5 w-3.5" />
            + 문서 연결
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="block w-full text-center text-2xs text-muted-foreground hover:text-primary transition-colors py-1"
          >
            또는 새 문서 만들기
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {(showAll ? links : links.slice(0, VISIBLE_LINK_LIMIT)).map((link) => (
              <div
                key={link.id}
                className="group flex items-center gap-2.5 rounded-md border border-border/40 bg-background/60 hover:bg-background hover:border-primary/40 px-2.5 py-2 transition-colors"
              >
                <FileText className="h-4 w-4 shrink-0 text-primary/70" />
                <button
                  onClick={() => navigate(`/${workspaceSlug}/documents/space/${link.space_id}/${link.document_id}`)}
                  className="flex-1 text-left text-sm hover:text-primary transition-colors truncate min-w-0"
                  title={link.document_title}
                >
                  {link.document_title}
                </button>
                <button
                  onClick={() => unlinkMutation.mutate({ docSpaceId: link.space_id, docId: link.document_id })}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity text-xs px-1"
                  title="연결 해제"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {links.length > VISIBLE_LINK_LIMIT && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 w-full text-center text-2xs text-muted-foreground hover:text-primary transition-colors py-1.5 rounded-md hover:bg-background/60"
            >
              {showAll ? "접기" : `+ ${links.length - VISIBLE_LINK_LIMIT}개 더보기`}
            </button>
          )}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
            <button className="text-2xs text-primary hover:underline" onClick={() => setPickerOpen(true)}>
              + 문서 연결
            </button>
            <span className="text-2xs text-muted-foreground/40">·</span>
            <button className="text-2xs text-muted-foreground hover:text-primary hover:underline transition-colors" onClick={() => setCreateOpen(true)}>
              + 새 문서
            </button>
          </div>
        </>
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
