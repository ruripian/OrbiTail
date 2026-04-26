import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Zap } from "lucide-react";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Sprint, SprintStatus } from "@/types";

const SPRINT_STATUSES: SprintStatus[] = ["draft", "active", "completed", "cancelled"];

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "completed", "cancelled"]),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

const STATUS_COLORS: Record<SprintStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-blue-500/10 text-blue-600",
  completed: "bg-green-500/10 text-green-600",
  cancelled: "bg-red-500/10 text-red-600",
};

export function SprintsPage() {
  const { workspaceSlug, projectId } = useParams<{
    workspaceSlug: string;
    projectId: string;
  }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: sprints = [] } = useQuery({
    queryKey: ["sprints", workspaceSlug, projectId],
    queryFn: () => projectsApi.sprints.list(workspaceSlug!, projectId!),
  });

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { status: "draft" },
  });

  const createMutation = useMutation({
    mutationFn: (data: FormValues) => projectsApi.sprints.create(workspaceSlug!, projectId!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprints", workspaceSlug, projectId] });
      reset();
      setCreateOpen(false);
    },
    onError: () => toast.error(t("cycles.createFailed")),
  });

  /* 스프린트 클릭 → 스프린트 전용 이슈 뷰 */
  const handleSprintClick = (sprint: Sprint) => {
    navigate(`/${workspaceSlug}/projects/${projectId}/sprints/${sprint.id}/issues`);
  };

  /* 날짜 포맷 */
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{t("cycles.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("cycles.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          {t("cycles.create")}
        </Button>
      </div>

      {/* 스프린트 목록 */}
      {sprints.length === 0 ? (
        <EmptyState
          icon={<Zap className="h-10 w-10" />}
          title={t("cycles.empty")}
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {sprints.map((sprint: Sprint) => (
            <div
              key={sprint.id}
              onClick={() => handleSprintClick(sprint)}
              className="flex items-center gap-4 rounded-xl border glass p-4 hover:bg-accent/50 cursor-pointer transition-colors"
            >
              <Zap className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{sprint.name}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDate(sprint.start_date)} ~ {fmtDate(sprint.end_date)}
                </p>
              </div>
              <Badge variant="secondary" className={STATUS_COLORS[sprint.status]}>
                {t(`cycles.status.${sprint.status}`)}
              </Badge>
              <span className="text-xs text-muted-foreground shrink-0">
                {t("cycles.issueCount", { count: sprint.issue_count })}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 스프린트 생성 다이얼로그 */}
      <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cycles.createTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1">
              <Label>{t("cycles.name")}</Label>
              <Input placeholder={t("cycles.namePlaceholder")} {...register("name")} autoFocus />
              {errors.name && <p className="text-xs text-destructive">{t("cycles.nameRequired")}</p>}
            </div>

            <div className="space-y-1">
              <Label>{t("cycles.description")}</Label>
              <Input placeholder={t("cycles.descriptionPlaceholder")} {...register("description")} />
            </div>

            <div className="space-y-1">
              <Label>{t("cycles.statusLabel")}</Label>
              <Select defaultValue="draft" onValueChange={(v) => setValue("status", v as SprintStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SPRINT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`cycles.status.${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("cycles.startDate")}</Label>
                <Input type="date" {...register("start_date")} />
                {errors.start_date && <p className="text-xs text-destructive">{t("cycles.dateRequired")}</p>}
              </div>
              <div className="space-y-1">
                <Label>{t("cycles.endDate")}</Label>
                <Input type="date" {...register("end_date")} />
                {errors.end_date && <p className="text-xs text-destructive">{t("cycles.dateRequired")}</p>}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t("cycles.cancel")}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? t("cycles.creating") : t("cycles.create")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
