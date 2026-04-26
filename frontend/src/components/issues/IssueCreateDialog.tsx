/**
 * 이슈 생성 다이얼로그 — 전체 필드 포함
 *
 * 필드: 제목, 설명, 상태, 우선순위, 담당자, 시작일, 마감일, 카테고리, 스프린트
 * 컨텍스트 자동 할당: 카테고리/스프린트 뷰에서 열면 해당 값이 기본 선택됨
 */
import { useEffect, useState, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useIssueRefresh } from "@/hooks/useIssueMutations";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TemplatePicker } from "./template-picker";
import type { State, Category, Sprint, ProjectMember, IssueTemplate } from "@/types";

const schema = z.object({
  title: z.string().min(1),
  description_html: z.string().optional(),
  state: z.string().min(1),
  priority: z.enum(["none", "urgent", "high", "medium", "low"]),
  assignees: z.array(z.string()).optional(),
  start_date: z.string().optional().or(z.literal("")),
  due_date: z.string().optional().or(z.literal("")),
  category: z.string().optional().or(z.literal("")),
  sprint: z.string().optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  states: State[];
  defaultStateId?: string;
  workspaceSlug: string;
  projectId: string;
  /** 카테고리 컨텍스트에서 생성 시 자동 할당 */
  defaultCategoryId?: string;
  /** 스프린트 컨텍스트에서 생성 시 자동 할당 */
  defaultSprintId?: string;
  /** 하위 이슈로 생성 시 부모 이슈 ID */
  parentIssueId?: string;
  /** 마감일 프리필 (캘린더에서 특정 날짜 클릭 시) — "YYYY-MM-DD" */
  defaultDueDate?: string;
}

export function IssueCreateDialog({
  open,
  onOpenChange,
  states,
  defaultStateId,
  workspaceSlug,
  projectId,
  defaultCategoryId,
  defaultSprintId,
  parentIssueId,
  defaultDueDate,
}: Props) {
  const { t } = useTranslation();
  const { refresh } = useIssueRefresh(workspaceSlug, projectId);
  /* Todo(unstarted) 우선 → default → 첫 번째 */
  const pickDefault = () =>
    states.find((s) => s.group === "unstarted")?.id ?? states.find((s) => s.default)?.id ?? states[0]?.id ?? "";
  const initialStateId = defaultStateId ?? pickDefault();

  /* 멤버/카테고리/스프린트 데이터 — 다이얼로그 열릴 때 fetch */
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug, projectId),
    enabled: open,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, projectId],
    queryFn: () => projectsApi.categories.list(workspaceSlug, projectId),
    enabled: open,
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn: () => projectsApi.sprints.list(workspaceSlug, projectId),
    enabled: open,
  });

  /* PASS4-3bis: 템플릿 fetch 와 applyTemplate 만 남기고 chip UI 는 TemplatePicker 가 대체. */
  const applyTemplate = (tmpl: IssueTemplate) => {
    if (tmpl.title_template) setValue("title", tmpl.title_template);
    if (tmpl.description_html) setValue("description_html", tmpl.description_html);
    if (tmpl.priority) setValue("priority", tmpl.priority as FormValues["priority"]);
  };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description_html: "",
      state: initialStateId,
      priority: "medium",
      assignees: [],
      start_date: "",
      due_date: "",
      category: defaultCategoryId ?? "",
      sprint: defaultSprintId ?? "",
    },
  });

  const selectedAssignees = watch("assignees") ?? [];

  // 다이얼로그 열릴 때마다 폼 초기화
  useEffect(() => {
    if (open) {
      reset({
        title: "",
        description_html: "",
        state: defaultStateId ?? pickDefault(),
        priority: "medium",
        assignees: [],
        start_date: "",
        due_date: defaultDueDate ?? "",
        category: defaultCategoryId ?? "",
        sprint: defaultSprintId ?? "",
      });
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      const payload: Record<string, unknown> = {
        title: data.title,
        state: data.state,
        priority: data.priority,
        project: projectId,
      };
      if (data.description_html) payload.description_html = data.description_html;
      if (data.assignees && data.assignees.length > 0) payload.assignees = data.assignees;
      if (data.start_date) payload.start_date = data.start_date;
      if (data.due_date) payload.due_date = data.due_date;
      if (data.category) payload.category = data.category;
      if (data.sprint) payload.sprint = data.sprint;
      if (parentIssueId) payload.parent = parentIssueId;
      return issuesApi.create(workspaceSlug, projectId, payload);
    },
    onSuccess: async () => {
      await refresh(parentIssueId);
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      /* 백엔드 DRF 검증 에러는 필드별 메시지 객체 — 첫 필드의 첫 메시지 추출 */
      const data = err?.response?.data;
      let detail: string | undefined;
      if (typeof data === "string") {
        detail = data;
      } else if (data?.detail) {
        detail = String(data.detail);
      } else if (data && typeof data === "object") {
        const firstKey = Object.keys(data)[0];
        const firstVal = data[firstKey];
        detail = Array.isArray(firstVal) ? `${firstKey}: ${firstVal[0]}` : String(firstVal);
      }
      toast.error(detail ?? t("issues.create.error"));
    },
  });

  /* 담당자 토글 — 다중 선택 */
  const toggleAssignee = (userId: string) => {
    const current = selectedAssignees;
    if (current.includes(userId)) {
      setValue("assignees", current.filter((id) => id !== userId));
    } else {
      setValue("assignees", [...current, userId]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
        /* 닫힐 때 trigger로 auto-focus 복귀 방지 — 테이블 스크롤 위치 유지 */
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{parentIssueId ? t("issues.create.subIssueTitle") : t("issues.create.title")}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((d) => mutation.mutate(d))}
          /* Enter 키로 인한 implicit submit 방지 — 제출 버튼 직접 클릭만 허용 */
          onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") e.preventDefault(); }}
          className="space-y-4"
        >
          {/* PASS4-3bis: TemplatePicker — 검색 가능한 dropdown + "관리" 진입 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("issues.create.template")}:</span>
            <TemplatePicker
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              onApply={applyTemplate}
            />
          </div>

          {/* 제목 */}
          <div className="space-y-1">
            <Label htmlFor="title">{t("issues.create.issueTitle")}</Label>
            <Input id="title" placeholder={t("issues.create.issueTitlePlaceholder")} {...register("title")} autoFocus autoComplete="off" />
            {errors.title && <p className="text-xs text-destructive">{t("issues.create.titleRequired")}</p>}
          </div>

          {/* 설명 */}
          <div className="space-y-1">
            <Label htmlFor="desc">{t("issues.create.description")}</Label>
            <textarea
              id="desc"
              rows={3}
              placeholder={t("issues.create.descriptionPlaceholder")}
              className="flex w-full rounded-lg border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              {...register("description_html")}
            />
          </div>

          {/* 상태 + 우선순위 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("issues.create.status")}</Label>
              <Select
                value={watch("state")}
                onValueChange={(v) => setValue("state", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("issues.create.status")} />
                </SelectTrigger>
                <SelectContent>
                  {states.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                        {s.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>{t("issues.create.priority")}</Label>
              <Select value={watch("priority")} onValueChange={(v) => setValue("priority", v as FormValues["priority"])}>
                <SelectTrigger>
                  <SelectValue placeholder={t("issues.create.priority")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("issues.priority.none")}</SelectItem>
                  <SelectItem value="urgent">{t("issues.priority.urgent")}</SelectItem>
                  <SelectItem value="high">{t("issues.priority.high")}</SelectItem>
                  <SelectItem value="medium">{t("issues.priority.medium")}</SelectItem>
                  <SelectItem value="low">{t("issues.priority.low")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 담당자 — 다중 선택 (체크박스 스타일 + 검색) */}
          <AssigneeSelector
            members={members}
            selectedAssignees={selectedAssignees}
            onToggle={toggleAssignee}
            t={t}
          />

          {/* 시작일 + 마감일 — 커스텀 DatePicker */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("issues.create.startDate")}</Label>
              <Controller
                control={control}
                name="start_date"
                render={({ field }) => (
                  <DatePicker
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? "")}
                    placeholder={t("issues.create.startDate")}
                    className="border border-border rounded-md bg-input/60"
                    hintDate={watch("due_date") || null}
                    hintMode="after"
                  />
                )}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("issues.create.dueDate")}</Label>
              <Controller
                control={control}
                name="due_date"
                render={({ field }) => (
                  <DatePicker
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? "")}
                    placeholder={t("issues.create.dueDate")}
                    className="border border-border rounded-md bg-input/60"
                    hintDate={watch("start_date") || null}
                    hintMode="before"
                  />
                )}
              />
            </div>
          </div>

          {/* 카테고리 + 스프린트 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("issues.create.module")}</Label>
              <Select
                value={watch("category") || "__none__"}
                onValueChange={(v) => setValue("category", v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("issues.create.noModule")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("issues.create.noModule")}</SelectItem>
                  {categories.map((m: Category) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>{t("issues.create.cycle")}</Label>
              <Select
                value={watch("sprint") || "__none__"}
                onValueChange={(v) => setValue("sprint", v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("issues.create.noCycle")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("issues.create.noCycle")}</SelectItem>
                  {sprints.map((c: Sprint) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 액션 */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("issues.create.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t("issues.create.submitting") : t("issues.create.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── 검색 가능한 담당자 선택기 ── */

function AssigneeSelector({
  members, selectedAssignees, onToggle, t,
}: {
  members: ProjectMember[];
  selectedAssignees: string[];
  onToggle: (id: string) => void;
  t: (key: string) => string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m: ProjectMember) =>
      m.member.display_name.toLowerCase().includes(q),
    );
  }, [members, query]);

  return (
    <div className="space-y-1">
      <Label>{t("issues.create.assignees")}</Label>
      {members.length > 5 && (
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("issues.picker.searchPlaceholder")}
          autoComplete="off"
          className="h-7 text-xs mb-1"
        />
      )}
      <div className="flex flex-wrap gap-1.5 p-2 border rounded-lg min-h-[40px] max-h-[120px] overflow-y-auto">
        {members.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t("issues.create.noMembers")}</span>
        ) : filtered.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t("issues.picker.noResults")}</span>
        ) : (
          filtered.map((m: ProjectMember) => {
            const selected = selectedAssignees.includes(m.member.id);
            return (
              <button
                key={m.member.id}
                type="button"
                onClick={() => onToggle(m.member.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  selected
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 border border-transparent"
                }`}
              >
                <AvatarInitials name={m.member.display_name} avatar={m.member.avatar} size="xs" />
                {m.member.display_name}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
