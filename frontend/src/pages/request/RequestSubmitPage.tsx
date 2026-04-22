/**
 * 요청 큐 페이지 — 프로젝트 단위로 버그/기능 요청을 제출하고 관리.
 *
 * 섹션 3개:
 *  1) 제출 폼 (기본) — 버그/기능 템플릿 + 공개/비공개 선택
 *  2) 대기 요청 — pending 상태의 요청. 승인/거절 가능(프로젝트 정책 따라).
 *  3) 처리됨 — approved/rejected 탭으로 토글
 *
 * 가시성:
 *  - 공개: 멤버 누구나 조회
 *  - 비공개: 제출자 + 관리자만
 *
 * 승인 정책:
 *  - project.request_review_policy === "admin" → can_edit 멤버만
 *  - "all" (기본) → 멤버 누구나 승인/거절
 */
import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Send, CheckCircle2, Bug, Sparkles, Eye, EyeOff, Check, X,
  Clock, ChevronDown, Trash2, Plus,
} from "lucide-react";
import { projectsApi } from "@/api/projects";
import { requestsApi } from "@/api/requests";
import { useAuthStore } from "@/stores/authStore";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { StatePicker } from "@/components/issues/state-picker";
import { AssigneePicker } from "@/components/issues/assignee-picker";
import { CategoryPicker } from "@/components/issues/category-picker";
import { SprintPicker } from "@/components/issues/sprint-picker";
import { cn } from "@/lib/utils";
import type { IssueRequest } from "@/types";

type RequestKind = "bug" | "feature";
type Severity = "blocker" | "critical" | "major" | "minor";
const SEVERITIES: Severity[] = ["blocker", "critical", "major", "minor"];
const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: "Blocker", critical: "Critical", major: "Major", minor: "Minor",
};

/* XSS 방지 — description_html 으로 들어가는 사용자 입력은 반드시 escape */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function nl2br(s: string): string {
  return esc(s.trim()).replace(/\n/g, "<br/>");
}

function buildDescriptionHtml(kind: RequestKind, v: {
  description: string;
  steps: string; expected: string; actual: string; environment: string; severity: Severity | "";
}): string {
  const sections: string[] = [];
  // description 은 RichTextEditor 에서 오는 완성된 HTML — 그대로 사용 (escape 금지)
  const descTrim = v.description.replace(/<p><\/p>/g, "").trim();
  if (descTrim && descTrim !== "<p></p>") sections.push(descTrim);
  if (kind === "bug") {
    if (v.steps.trim()) {
      const items = v.steps.split("\n").map((s) => s.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
      if (items.length) {
        sections.push(`<h3>재현 단계</h3><ol>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`);
      }
    }
    if (v.expected.trim()) sections.push(`<h3>예상 동작</h3><p>${nl2br(v.expected)}</p>`);
    if (v.actual.trim()) sections.push(`<h3>실제 동작</h3><p>${nl2br(v.actual)}</p>`);
    if (v.environment.trim()) sections.push(`<h3>환경</h3><p>${nl2br(v.environment)}</p>`);
    if (v.severity) sections.push(`<p><strong>심각도:</strong> ${esc(SEVERITY_LABEL[v.severity])}</p>`);
  }
  return sections.join("\n");
}

export function RequestSubmitPage() {
  const { t } = useTranslation();
  const { workspaceSlug, projectId = "" } = useParams<{ workspaceSlug: string; projectId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { perms } = useProjectPerms();

  const { data: project } = useQuery({
    queryKey: ["project", workspaceSlug, projectId],
    queryFn: () => projectsApi.get(workspaceSlug!, projectId),
    enabled: !!workspaceSlug && !!projectId,
  });

  /* 승인 권한 — 프로젝트 정책 기준 */
  const canReview = useMemo(() => {
    if (!project) return false;
    if (project.request_review_policy === "admin") return !!perms?.can_edit;
    return true; // "all" 정책이면 프로젝트 멤버이기만 하면 OK
  }, [project, perms]);

  /* 요청 목록 — 탭별로 페치 */
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [historyFilter, setHistoryFilter] = useState<"approved" | "rejected" | "mine">("rejected");
  const [kindFilter, setKindFilter] = useState<"all" | "bug" | "feature">("all");
  const [createOpen, setCreateOpen] = useState(false);

  const filterByKind = <T extends { kind: "bug" | "feature" }>(list: T[]): T[] =>
    kindFilter === "all" ? list : list.filter((r) => r.kind === kindFilter);

  const pendingQ = useQuery({
    queryKey: ["requests", workspaceSlug, projectId, "pending"],
    queryFn: () => requestsApi.list(workspaceSlug!, projectId, "pending"),
    enabled: !!workspaceSlug && !!projectId,
  });
  const historyQ = useQuery({
    queryKey: ["requests", workspaceSlug, projectId, historyFilter],
    queryFn: () => requestsApi.list(workspaceSlug!, projectId, historyFilter === "mine" ? undefined : historyFilter),
    enabled: activeTab === "history" && !!workspaceSlug && !!projectId,
  });
  const historyList = useMemo(() => {
    const data = historyQ.data ?? [];
    if (historyFilter === "mine") return data.filter((r) => r.submitted_by === currentUser?.id);
    return data;
  }, [historyQ.data, historyFilter, currentUser]);

  /* ── 제출 폼 state ── */
  const [kind, setKind] = useState<RequestKind>("feature");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [environment, setEnvironment] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");

  const resetForm = () => {
    setTitle(""); setDescription("");
    setSteps(""); setExpected(""); setActual(""); setEnvironment(""); setSeverity("");
  };

  const submitMutation = useMutation({
    mutationFn: () =>
      requestsApi.create(workspaceSlug!, projectId, {
        kind,
        visibility,
        title: title.trim(),
        description_html: buildDescriptionHtml(kind, {
          description, steps, expected, actual, environment, severity,
        }),
        meta: kind === "bug"
          ? { severity: severity || undefined, environment: environment || undefined }
          : {},
      }),
    onSuccess: () => {
      toast.success(t("request.submitted", "요청이 접수되었습니다"));
      resetForm();
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["requests", workspaceSlug, projectId] });
    },
    onError: () => toast.error(t("request.submitFailed", "요청 접수 실패")),
  });

  /* ── 승인/거절 모달 ── */
  const [approveTarget, setApproveTarget] = useState<IssueRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<IssueRequest | null>(null);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-[880px] mx-auto px-6 py-10 space-y-6">
        {/* 헤더 */}
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              {t("request.title", "요청")}
              {project && (
                <span className="ml-2 font-mono normal-case text-primary">
                  [{project.identifier}] {project.name}
                </span>
              )}
            </p>
            <h1 className="text-3xl font-bold">{t("request.queueHeadline", "요청")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("request.queueSubtitle", "버그/기능 요청을 접수하고 프로젝트에 반영할지 결정합니다.")}
            </p>
          </div>
          <Button className="gap-2 shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("request.create", "요청 생성")}
          </Button>
        </header>

        {/* ── 제출 다이얼로그 ── */}
        <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateOpen(false); }}>
          <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("request.section.submit", "요청 생성")}</DialogTitle>
            </DialogHeader>

          {/* 타입 탭 */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              type="button"
              onClick={() => setKind("bug")}
              className={cn(
                "flex items-center gap-2 rounded-xl border p-3 text-left transition-all",
                kind === "bug"
                  ? "border-destructive/50 bg-destructive/10 ring-1 ring-destructive/30"
                  : "border-border hover:bg-muted/40",
              )}
            >
              <Bug className={cn("h-5 w-5 shrink-0", kind === "bug" ? "text-destructive" : "text-muted-foreground")} />
              <div className="min-w-0">
                <div className="text-sm font-semibold">{t("request.bug.tab", "버그 리포트")}</div>
                <div className="text-2xs text-muted-foreground truncate">
                  {t("request.bug.tabHint", "작동이 이상하거나 오류 발생")}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setKind("feature")}
              className={cn(
                "flex items-center gap-2 rounded-xl border p-3 text-left transition-all",
                kind === "feature"
                  ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30"
                  : "border-border hover:bg-muted/40",
              )}
            >
              <Sparkles className={cn("h-5 w-5 shrink-0", kind === "feature" ? "text-primary" : "text-muted-foreground")} />
              <div className="min-w-0">
                <div className="text-sm font-semibold">{t("request.feature.tab", "기능 요청")}</div>
                <div className="text-2xs text-muted-foreground truncate">
                  {t("request.feature.tabHint", "이런 기능이 있으면 좋겠어요")}
                </div>
              </div>
            </button>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); if (title.trim()) submitMutation.mutate(); }}
            className="space-y-4"
          >
            {/* 공개/비공개 */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t("request.visibility", "공개 범위")}</span>
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setVisibility("public")}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 transition-colors",
                    visibility === "public" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  <Eye className="h-3 w-3" /> {t("request.public", "공개")}
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility("private")}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 border-l border-border transition-colors",
                    visibility === "private" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  <EyeOff className="h-3 w-3" /> {t("request.private", "비공개")}
                </button>
              </div>
              <span className="text-muted-foreground/70">
                {visibility === "public"
                  ? t("request.publicHint", "멤버 누구나 조회 가능")
                  : t("request.privateHint", "제출자와 관리자만 조회 가능")}
              </span>
            </div>

            {/* 제목 */}
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("request.subject", "제목")} <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("request.titlePlaceholder", "제목")}
                required
                maxLength={200}
                className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60"
              />
            </div>

            {/* 설명 — 리치 에디터(스타일·이미지 삽입) */}
            <div>
              <label className="block text-sm font-medium mb-1">{t("request.description", "설명")}</label>
              <RichTextEditor
                content={description}
                onChange={setDescription}
                placeholder={t("request.descriptionPlaceholder", "내용을 입력하거나 이미지를 드래그/붙여넣기 하세요")}
                minHeight="120px"
                showToolbar
              />
              <p className="mt-1 text-2xs text-muted-foreground/70">
                이미지: 드래그·붙여넣기 또는 툴바의 이미지 버튼 (5MB 이하)
              </p>
            </div>

            {/* 타입별 선택 필드 — 버그만 노출 */}
            {kind === "bug" && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground list-none flex items-center gap-1">
                <ChevronDown className="h-3 w-3 -rotate-90 group-open:rotate-0 transition-transform" />
                {t("request.bug.details", "재현 단계 · 환경 · 심각도 (선택)")}
              </summary>
              <div className="pt-3 space-y-3">
                <LabeledTextarea label={t("request.bug.steps", "재현 단계")}
                  value={steps} onChange={setSteps}
                  rows={3} mono />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <LabeledTextarea label={t("request.bug.expected", "예상 동작")}
                    value={expected} onChange={setExpected} rows={2} />
                  <LabeledTextarea label={t("request.bug.actual", "실제 동작")}
                    value={actual} onChange={setActual} rows={2} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("request.bug.environment", "환경")}</label>
                  <input type="text" value={environment} onChange={(e) => setEnvironment(e.target.value)}
                    className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("request.bug.severity", "심각도")}</label>
                  <div className="flex gap-1.5 flex-wrap">
                    <SeverityChip active={severity === ""} onClick={() => setSeverity("")}>{t("request.bug.severityUnset", "미지정")}</SeverityChip>
                    {SEVERITIES.map((s) => (
                      <SeverityChip key={s} active={severity === s} onClick={() => setSeverity(s)} variant="danger">
                        {SEVERITY_LABEL[s]}
                      </SeverityChip>
                    ))}
                  </div>
                </div>
              </div>
            </details>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t("common.cancel", "취소")}
              </Button>
              <Button type="submit" className="gap-2" disabled={!title.trim() || submitMutation.isPending}>
                <Send className="h-4 w-4" />
                {submitMutation.isPending ? t("request.submitting", "제출 중...") : t("request.submit", "요청 보내기")}
              </Button>
            </div>
          </form>
          </DialogContent>
        </Dialog>

        {/* ── 목록 섹션 — 탭 ── */}
        <section className="rounded-2xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center border-b border-border gap-1 pr-3">
            <div className="flex items-center flex-1">
            <TabButton active={activeTab === "pending"} onClick={() => setActiveTab("pending")}>
              <Clock className="h-3.5 w-3.5" />
              {t("request.tab.pending", "대기")}
              {(pendingQ.data?.length ?? 0) > 0 && (
                <span className="ml-1 rounded-full bg-primary text-primary-foreground text-2xs px-1.5 py-0.5 font-semibold">
                  {pendingQ.data?.length}
                </span>
              )}
            </TabButton>
            <TabButton active={activeTab === "history"} onClick={() => setActiveTab("history")}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("request.tab.history", "처리됨")}
            </TabButton>
            </div>
            {/* 타입 필터 — 전체/버그/기능 */}
            <div className="flex items-center gap-1 shrink-0">
              <KindFilterChip active={kindFilter === "all"} onClick={() => setKindFilter("all")}>
                {t("request.filter.all", "전체")}
              </KindFilterChip>
              <KindFilterChip active={kindFilter === "bug"} onClick={() => setKindFilter("bug")} variant="danger">
                <Bug className="h-3 w-3" />
                {t("request.filter.bug", "버그")}
              </KindFilterChip>
              <KindFilterChip active={kindFilter === "feature"} onClick={() => setKindFilter("feature")} variant="primary">
                <Sparkles className="h-3 w-3" />
                {t("request.filter.feature", "기능")}
              </KindFilterChip>
            </div>
          </div>

          {activeTab === "pending" && (() => {
            const rows = filterByKind(pendingQ.data ?? []);
            return (
              <div>
                {pendingQ.isLoading ? (
                  <p className="p-6 text-sm text-muted-foreground text-center">{t("common.loading", "로딩 중...")}</p>
                ) : rows.length === 0 ? (
                  <p className="p-8 text-sm text-muted-foreground text-center">
                    {t("request.emptyPending", "대기 중인 요청이 없습니다")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {rows.map((r) => (
                      <RequestRow
                        key={r.id}
                        req={r}
                        currentUserId={currentUser?.id ?? null}
                        canReview={canReview}
                        onApprove={() => setApproveTarget(r)}
                        onReject={() => setRejectTarget(r)}
                        workspaceSlug={workspaceSlug!}
                        projectId={projectId}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}

          {activeTab === "history" && (
            <div>
              <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
                <span className="text-xs text-muted-foreground">{t("request.filter", "필터")}</span>
                <FilterChip active={historyFilter === "rejected"} onClick={() => setHistoryFilter("rejected")}>
                  {t("request.filter.rejected", "거절됨")}
                </FilterChip>
                <FilterChip active={historyFilter === "approved"} onClick={() => setHistoryFilter("approved")}>
                  {t("request.filter.approved", "승인됨")}
                </FilterChip>
                <FilterChip active={historyFilter === "mine"} onClick={() => setHistoryFilter("mine")}>
                  {t("request.filter.mine", "내가 제출")}
                </FilterChip>
              </div>
              {historyQ.isLoading ? (
                <p className="p-6 text-sm text-muted-foreground text-center">{t("common.loading", "로딩 중...")}</p>
              ) : filterByKind(historyList).length === 0 ? (
                <p className="p-8 text-sm text-muted-foreground text-center">
                  {t("request.emptyHistory", "해당 항목이 없습니다")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filterByKind(historyList).map((r) => (
                    <RequestRow
                      key={r.id}
                      req={r}
                      currentUserId={currentUser?.id ?? null}
                      canReview={false}
                      workspaceSlug={workspaceSlug!}
                      projectId={projectId}
                      onClick={r.approved_issue
                        ? () => navigate(`/${workspaceSlug}/projects/${projectId}/issues?issue=${r.approved_issue}`)
                        : undefined
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      {/* 승인 모달 */}
      {approveTarget && (
        <ApproveDialog
          req={approveTarget}
          workspaceSlug={workspaceSlug!}
          projectId={projectId}
          onClose={() => setApproveTarget(null)}
          onApproved={() => {
            qc.invalidateQueries({ queryKey: ["requests", workspaceSlug, projectId] });
            qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
            setApproveTarget(null);
          }}
        />
      )}

      {/* 거절 모달 */}
      {rejectTarget && (
        <RejectDialog
          req={rejectTarget}
          workspaceSlug={workspaceSlug!}
          projectId={projectId}
          onClose={() => setRejectTarget(null)}
          onRejected={() => {
            qc.invalidateQueries({ queryKey: ["requests", workspaceSlug, projectId] });
            setRejectTarget(null);
          }}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */
/*  보조 컴포넌트                                                 */
/* ────────────────────────────────────────────────────────────── */

function LabeledTextarea({
  label, value, onChange, placeholder, rows = 3, mono = false,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(
          "w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 resize-y",
          mono && "font-mono",
        )}
      />
    </div>
  );
}

function SeverityChip({
  active, onClick, variant, children,
}: { active: boolean; onClick: () => void; variant?: "danger"; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-xs px-3 py-1.5 rounded-md border transition-colors",
        active
          ? variant === "danger"
            ? "bg-destructive/10 border-destructive/40 text-destructive font-medium"
            : "bg-muted border-border font-medium"
          : "border-border text-muted-foreground hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-all",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-xs px-2.5 py-1 rounded-md border transition-colors",
        active
          ? "bg-primary/10 border-primary/40 text-primary font-medium"
          : "border-border text-muted-foreground hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}

function KindFilterChip({
  active, onClick, variant, children,
}: { active: boolean; onClick: () => void; variant?: "danger" | "primary"; children: React.ReactNode }) {
  const activeCls =
    variant === "danger"
      ? "bg-destructive/10 border-destructive/40 text-destructive"
      : variant === "primary"
      ? "bg-primary/10 border-primary/40 text-primary"
      : "bg-muted border-border";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-2xs px-2 py-1 rounded-md border transition-colors",
        active ? `${activeCls} font-medium` : "border-border text-muted-foreground hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: IssueRequest["status"] }) {
  const cfg: Record<IssueRequest["status"], { label: string; cls: string }> = {
    pending:  { label: "대기",   cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    approved: { label: "승인됨", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    rejected: { label: "거절됨", cls: "bg-muted text-muted-foreground" },
  };
  const c = cfg[status];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold", c.cls)}>{c.label}</span>;
}

function KindBadge({ kind }: { kind: IssueRequest["kind"] }) {
  if (kind === "bug") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-2xs font-semibold"><Bug className="h-2.5 w-2.5" />버그</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-2xs font-semibold"><Sparkles className="h-2.5 w-2.5" />기능</span>;
}

function RequestRow({
  req, currentUserId, canReview, onApprove, onReject, onClick, workspaceSlug, projectId,
}: {
  req: IssueRequest;
  currentUserId: string | null;
  canReview: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onClick?: () => void;
  workspaceSlug: string;
  projectId: string;
}) {
  const qc = useQueryClient();
  const isOwner = currentUserId != null && req.submitted_by === currentUserId;
  const canDelete = isOwner && req.status === "pending";

  const deleteMutation = useMutation({
    mutationFn: () => requestsApi.delete(workspaceSlug, projectId, req.id),
    onSuccess: () => {
      toast.success("요청이 삭제되었습니다");
      qc.invalidateQueries({ queryKey: ["requests", workspaceSlug, projectId] });
    },
  });

  return (
    <li
      className={cn(
        "px-5 py-4 transition-colors",
        onClick && "cursor-pointer hover:bg-accent/40",
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <KindBadge kind={req.kind} />
            <StatusBadge status={req.status} />
            {req.visibility === "private" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-2xs">
                <EyeOff className="h-2.5 w-2.5" /> 비공개
              </span>
            )}
            {req.approved_issue && req.approved_issue_sequence_id != null && (
              <span className="text-2xs font-mono text-emerald-600 dark:text-emerald-400">
                → 이슈 #{req.approved_issue_sequence_id}
              </span>
            )}
          </div>
          <p className="text-sm font-medium truncate">{req.title}</p>
          <div className="flex items-center gap-2 mt-1.5 text-2xs text-muted-foreground">
            {req.submitted_by_detail && (
              <span className="inline-flex items-center gap-1">
                <AvatarInitials
                  name={req.submitted_by_detail.display_name}
                  avatar={req.submitted_by_detail.avatar}
                  size="xs"
                />
                {req.submitted_by_detail.display_name}
              </span>
            )}
            <span>·</span>
            <span>{new Date(req.created_at).toLocaleString()}</span>
            {req.rejected_reason && (
              <>
                <span>·</span>
                <span className="italic truncate max-w-[220px]" title={req.rejected_reason}>
                  사유: {req.rejected_reason}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 액션 */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {req.status === "pending" && canReview && onApprove && onReject && (
            <>
              <Button variant="outline" size="sm" className="h-7 gap-1" onClick={onApprove}>
                <Check className="h-3 w-3 text-emerald-600" /> 승인
              </Button>
              <Button variant="outline" size="sm" className="h-7 gap-1" onClick={onReject}>
                <X className="h-3 w-3 text-destructive" /> 거절
              </Button>
            </>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("이 요청을 삭제하시겠습니까?")) deleteMutation.mutate();
              }}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="요청 취소/삭제"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* description 미리보기 */}
      {req.description_html && (
        <div
          className="mt-2 text-xs text-muted-foreground prose prose-sm max-w-none line-clamp-3 opacity-80"
          dangerouslySetInnerHTML={{ __html: req.description_html }}
        />
      )}
    </li>
  );
}

/* ── 승인 다이얼로그 ── */
function ApproveDialog({
  req, workspaceSlug, projectId, onClose, onApproved,
}: {
  req: IssueRequest;
  workspaceSlug: string;
  projectId: string;
  onClose: () => void;
  onApproved: () => void;
}) {
  const [stateId, setStateId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sprintId, setSprintId] = useState<string | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn: () => projectsApi.states.list(workspaceSlug, projectId),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, projectId],
    queryFn: () => projectsApi.categories.list(workspaceSlug, projectId),
  });
  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn: () => projectsApi.sprints.list(workspaceSlug, projectId),
  });
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug, projectId),
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      requestsApi.approve(workspaceSlug, projectId, req.id, {
        state: stateId ?? undefined,
        category: categoryId ?? undefined,
        sprint: sprintId ?? undefined,
        assignees: assigneeIds.length ? assigneeIds : undefined,
      }),
    onSuccess: () => {
      toast.success("요청이 승인되어 이슈로 편입되었습니다");
      onApproved();
    },
    onError: () => toast.error("승인 처리 실패"),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>요청 승인 → 이슈 편입</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <KindBadge kind={req.kind} />
              <p className="text-sm font-medium truncate">{req.title}</p>
            </div>
            {req.description_html && (
              <div
                className="text-xs text-muted-foreground line-clamp-3 mt-1"
                dangerouslySetInnerHTML={{ __html: req.description_html }}
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">상태</label>
            <StatePicker
              states={states}
              currentStateId={stateId}
              onChange={(id) => setStateId(id)}
            />
            <p className="text-2xs text-muted-foreground/70 mt-1">미지정 시 프로젝트 기본 상태로 생성됩니다.</p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">카테고리</label>
            <CategoryPicker
              categories={categories}
              currentId={categoryId}
              onChange={(id) => setCategoryId(id)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">스프린트</label>
            <SprintPicker
              sprints={sprints}
              currentId={sprintId}
              onChange={(id) => setSprintId(id)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">담당자</label>
            <AssigneePicker
              members={members}
              currentIds={assigneeIds}
              onChange={setAssigneeIds}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
            <Check className="h-4 w-4 mr-1" />
            {approveMutation.isPending ? "승인 중..." : "승인 + 이슈 생성"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── 거절 다이얼로그 ── */
function RejectDialog({
  req, workspaceSlug, projectId, onClose, onRejected,
}: {
  req: IssueRequest;
  workspaceSlug: string;
  projectId: string;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [reason, setReason] = useState("");
  const rejectMutation = useMutation({
    mutationFn: () => requestsApi.reject(workspaceSlug, projectId, req.id, reason.trim()),
    onSuccess: () => {
      toast.success("요청이 거절되었습니다");
      onRejected();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>요청 거절</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            "<span className="font-medium text-foreground">{req.title}</span>" 요청을 거절합니다.
          </p>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">사유 (선택)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="거절하는 이유를 적어두면 제출자가 확인할 수 있습니다"
              rows={3}
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 resize-y"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button variant="destructive" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending}>
            <X className="h-4 w-4 mr-1" />
            거절
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
