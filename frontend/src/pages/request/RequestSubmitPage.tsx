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
import { useState, useMemo, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Send, CheckCircle2, Bug, Sparkles, Eye, EyeOff,
  Clock, ChevronDown, Plus,
} from "lucide-react";
import { projectsApi } from "@/api/projects";
import { requestsApi } from "@/api/requests";
import { useAuthStore } from "@/stores/authStore";
import { useRequestDialogStore } from "@/stores/requestDialogStore";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
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
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const openRequest = useRequestDialogStore((s) => s.openRequest);
  const dialogCurrent = useRequestDialogStore((s) => s.current);

  const { data: project } = useQuery({
    queryKey: ["project", workspaceSlug, projectId],
    queryFn: () => projectsApi.get(workspaceSlug!, projectId),
    enabled: !!workspaceSlug && !!projectId,
  });

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

  /* ── deeplink (?req=<id>) → 다이얼로그 store 동기화 (단방향) ──
   *  URL→store: useEffect 가 list 캐시(또는 deeplinkQ)에서 해당 요청을 찾으면 openRequest.
   *  store→URL: handleRowClick 과 RequestDialog 의 handleClose 안에서 명시적으로 setSearchParams.
   *  (양방향 useEffect 동기화는 close/open 이 같은 렌더 사이클에서 race 를 일으켜 폐기)
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const deeplinkReqId = searchParams.get("req");

  const deeplinkQ = useQuery({
    queryKey: ["requests", workspaceSlug, projectId, "all"],
    queryFn: () => requestsApi.list(workspaceSlug!, projectId),
    enabled: !!workspaceSlug && !!projectId && !!deeplinkReqId,
  });

  /* deeplink → openRequest: URL 직접 진입 시 list 데이터 로드 후 .find → 자동 열기 */
  useEffect(() => {
    if (!deeplinkReqId || !workspaceSlug || !projectId) return;
    if (dialogCurrent?.id === deeplinkReqId) return; // 이미 열려있으면 skip
    const pools: (IssueRequest[] | undefined)[] = [
      pendingQ.data,
      historyQ.data,
      deeplinkQ.data,
    ];
    for (const pool of pools) {
      const found = pool?.find((r) => r.id === deeplinkReqId);
      if (found) {
        openRequest(found, { workspaceSlug, projectId });
        return;
      }
    }
  }, [deeplinkReqId, dialogCurrent?.id, pendingQ.data, historyQ.data, deeplinkQ.data, workspaceSlug, projectId, openRequest]);

  /* 행 클릭 — 모든 상태 동일하게 모달 진입 + URL ?req 반영 */
  const handleRowClick = (r: IssueRequest) => {
    if (!workspaceSlug) return;
    openRequest(r, { workspaceSlug, projectId });
    const next = new URLSearchParams(searchParams);
    next.set("req", r.id);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-regular mx-auto px-6 py-10 space-y-6">
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
                      <RequestRow key={r.id} req={r} onClick={() => handleRowClick(r)} />
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
                    <RequestRow key={r.id} req={r} onClick={() => handleRowClick(r)} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

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

/* 행은 요약만 노출. 액션(승인/거절/삭제) 과 풀 내용은 클릭 시 열리는 RequestDialog 가 담당. */
function RequestRow({
  req, onClick,
}: {
  req: IssueRequest;
  onClick: () => void;
}) {
  return (
    <li
      className="px-5 py-4 transition-colors cursor-pointer hover:bg-accent/40"
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
      </div>

      {req.description_html && (
        <div
          className="mt-2 text-xs text-muted-foreground prose prose-sm max-w-none line-clamp-3 opacity-80"
          dangerouslySetInnerHTML={{ __html: req.description_html }}
        />
      )}
    </li>
  );
}

