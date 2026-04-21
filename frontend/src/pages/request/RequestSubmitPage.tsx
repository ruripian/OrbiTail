/**
 * 요청 제출 페이지 — 작업자가 아닌 동료/외부 요청자가 "이 작업 해주세요"를 제출.
 * 프로젝트 선택 + 제목/설명/우선순위만 있는 간결한 폼. 제출 시 해당 프로젝트에 이슈 생성.
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Send, CheckCircle2 } from "lucide-react";
import { projectsApi } from "@/api/projects";
import { issuesApi } from "@/api/issues";
import { Button } from "@/components/ui/button";
import { PRIORITY_LIST, PRIORITY_LABEL_KEY } from "@/constants/priority";
import { cn } from "@/lib/utils";

export function RequestSubmitPage() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();

  const [projectId, setProjectId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  const [submitted, setSubmitted] = useState<{ id: string; identifier: string } | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", workspaceSlug],
    queryFn: () => projectsApi.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("project required");
      const issue = await issuesApi.create(workspaceSlug!, projectId, {
        title: title.trim(),
        description_html: description.trim()
          ? `<p>${description.replace(/\n/g, "<br/>")}</p>`
          : "",
        priority,
      } as any);
      return issue;
    },
    onSuccess: (issue: any) => {
      const proj = projects.find((p: any) => p.id === projectId);
      const identifier = issue.identifier || `${proj?.identifier ?? ""}-${issue.sequence_id ?? ""}`;
      setSubmitted({ id: issue.id, identifier });
      toast.success(t("request.submitted", "요청이 접수되었습니다"));
    },
    onError: () => toast.error(t("request.submitFailed", "요청 접수 실패")),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    submit.mutate();
  };

  const viewIssue = () => {
    if (!submitted) return;
    navigate(`/${workspaceSlug}/projects/${projectId}/issues?issue=${submitted.id}`);
  };

  const reset = () => {
    setSubmitted(null);
    setTitle("");
    setDescription("");
    setPriority("medium");
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="w-full max-w-md rounded-2xl border bg-card shadow-sm p-8 text-center">
          <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-xl font-semibold mb-2">{t("request.submitted", "요청이 접수되었습니다")}</h2>
          <p className="text-sm text-muted-foreground mb-5">
            {t("request.submittedDesc", "담당자가 확인 후 처리합니다")}
            <br />
            <span className="inline-block mt-2 font-mono font-bold text-primary">{submitted.identifier}</span>
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={reset}>{t("request.submitAnother", "추가 요청")}</Button>
            <Button onClick={viewIssue}>{t("request.viewIssue", "이슈 보기")}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[640px] mx-auto px-6 py-10">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            {t("request.title", "요청 보내기")}
          </p>
          <h1 className="text-3xl font-bold">{t("request.headline", "이 작업 해주세요")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("request.subtitle", "담당 프로젝트에 새 이슈로 제출됩니다")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
          {/* 프로젝트 */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("request.project", "프로젝트")} <span className="text-destructive">*</span>
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 transition-colors"
              required
            >
              <option value="">{t("request.selectProject", "프로젝트 선택...")}</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.identifier ? `[${p.identifier}] ` : ""}{p.name}</option>
              ))}
            </select>
          </div>

          {/* 제목 */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("request.subject", "제목")} <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("request.subjectPlaceholder", "한 줄로 요약")}
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 transition-colors"
              required
              maxLength={200}
            />
          </div>

          {/* 설명 */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("request.description", "설명")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("request.descriptionPlaceholder", "필요한 작업, 배경, 참고자료 등")}
              rows={6}
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 transition-colors resize-y"
            />
          </div>

          {/* 우선순위 */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("request.priority", "우선순위")}
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {PRIORITY_LIST.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-md border transition-colors",
                    priority === p
                      ? "bg-primary/10 border-primary/40 text-primary font-medium"
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  {t(PRIORITY_LABEL_KEY[p])}
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" className="w-full gap-2" disabled={!title.trim() || !projectId || submit.isPending}>
            <Send className="h-4 w-4" />
            {submit.isPending ? t("request.submitting", "제출 중...") : t("request.submit", "요청 보내기")}
          </Button>
        </form>
      </div>
    </div>
  );
}
