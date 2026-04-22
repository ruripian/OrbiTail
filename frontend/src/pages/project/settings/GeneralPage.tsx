import { useState, useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { projectsApi } from "@/api/projects";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectIconPicker, parseIconProp, type IconProp } from "@/components/ui/project-icon-picker";
import { cn } from "@/lib/utils";
import type { ProjectFeatureKey } from "@/types";

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  network: z.union([z.literal(0), z.literal(2)]),
});
type FormValues = z.infer<typeof schema>;

export function GeneralPage() {
  const { workspaceSlug, projectId } = useParams<{
    workspaceSlug: string;
    projectId: string;
  }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);

  /* 현재 사용자의 프로젝트 역할 확인 — 20(admin) 이상만 위험 구역 노출 */
  const { data: projectMembers = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn: () => projectsApi.members.list(workspaceSlug!, projectId!),
    enabled: !!workspaceSlug && !!projectId,
  });
  const myProjectRole = projectMembers.find((m) => m.member.id === currentUser?.id)?.role ?? 0;
  const isProjectAdmin = myProjectRole >= 20;

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const { data: project } = useQuery({
    queryKey: ["project", workspaceSlug, projectId],
    queryFn: () => projectsApi.get(workspaceSlug!, projectId!),
    enabled: !!workspaceSlug && !!projectId,
  });

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      name: project?.name ?? "",
      description: project?.description ?? "",
      network: project?.network ?? 2,
    },
  });

  const invalidateProject = () => {
    qc.invalidateQueries({ queryKey: ["projects", workspaceSlug] });
    qc.invalidateQueries({ queryKey: ["project", workspaceSlug, projectId] });
  };

  const updateMutation = useMutation({
    mutationFn: (data: FormValues) =>
      projectsApi.update(workspaceSlug!, projectId!, data),
    onSuccess: () => {
      invalidateProject();
      toast.success(t("project.settings.general.saved"));
    },
    onError: () => toast.error(t("project.settings.general.saveFailed")),
  });

  /* 아이콘은 폼 바깥에서 별도 PATCH — 즉시 저장 */
  const iconMutation = useMutation({
    mutationFn: (next: IconProp) =>
      projectsApi.update(workspaceSlug!, projectId!, {
        icon_prop: next as unknown as Record<string, unknown>,
      }),
    onSuccess: () => {
      invalidateProject();
      qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
    },
    onError: () => toast.error(t("project.settings.general.saveFailed")),
  });

  /* 기능 on/off 토글 — 즉시 저장 */
  const featureMutation = useMutation({
    mutationFn: (next: Partial<Record<ProjectFeatureKey, boolean>>) =>
      projectsApi.update(workspaceSlug!, projectId!, {
        features: next as unknown as Record<string, unknown>,
      }),
    onSuccess: () => invalidateProject(),
    onError: () => toast.error(t("project.settings.general.saveFailed")),
  });
  const toggleFeature = (key: ProjectFeatureKey) => {
    const current = (project?.features ?? {}) as Partial<Record<ProjectFeatureKey, boolean>>;
    const isOn = current[key] !== false; // 기본값 true
    featureMutation.mutate({ ...current, [key]: !isOn });
  };

  /* 요청 승인 정책 — "all" 멤버 누구나, "admin" 관리자만 */
  const reviewPolicyMutation = useMutation({
    mutationFn: (next: "all" | "admin") =>
      projectsApi.update(workspaceSlug!, projectId!, { request_review_policy: next } as any),
    onSuccess: () => invalidateProject(),
    onError: () => toast.error(t("project.settings.general.saveFailed")),
  });

  const archiveMutation = useMutation({
    mutationFn: () => projectsApi.archive(workspaceSlug!, projectId!),
    onSuccess: () => {
      invalidateProject();
      setArchiveOpen(false);
      toast.success(t("project.settings.general.archived"));
      navigate(`/${workspaceSlug}`);
    },
  });

  const leaveMutation = useMutation({
    mutationFn: () => projectsApi.leave(workspaceSlug!, projectId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", workspaceSlug] });
      setLeaveOpen(false);
      toast.success(t("project.settings.general.left"));
      navigate(`/${workspaceSlug}`);
    },
    onError: () => toast.error(t("project.settings.general.leaveFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => projectsApi.delete(workspaceSlug!, projectId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", workspaceSlug] });
      setDeleteOpen(false);
      toast.success(t("project.settings.general.deleted"));
      navigate(`/${workspaceSlug}`);
    },
  });

  return (
    <div className="space-y-10">
      {/* ── 기본 정보 ── */}
      <div>
        <h1 className="text-lg font-semibold">{t("project.settings.general.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("project.settings.general.subtitle")}
        </p>
      </div>

      <form
        onSubmit={handleSubmit((d) => updateMutation.mutate(d))}
        className="space-y-5 max-w-sm"
      >
        {/* 프로젝트 아이콘 — 기본 아이콘/색상 또는 사용자 지정 이미지 */}
        <div className="space-y-1.5">
          <Label>{t("project.settings.general.icon", "프로젝트 아이콘")}</Label>
          <div className="flex items-center gap-3">
            <ProjectIconPicker
              value={(project?.icon_prop ?? parseIconProp(null)) as Record<string, unknown>}
              onChange={(next) => iconMutation.mutate(next)}
              size="lg"
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "project.settings.general.iconHint",
                "클릭하여 아이콘/색상 변경 또는 사용자 지정 이미지 업로드",
              )}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="name">{t("project.settings.general.name")}</Label>
          <Input id="name" {...register("name")} />
          {errors.name && (
            <p className="text-xs text-destructive">{t("project.settings.general.nameRequired")}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">{t("project.settings.general.description")}</Label>
          <Input id="description" {...register("description")} />
        </div>

        {/* 식별자 — 편집 가능 + 실시간 중복 검사 */}
        <IdentifierField
          workspaceSlug={workspaceSlug!}
          projectId={projectId!}
          currentValue={project?.identifier ?? ""}
        />

        <div className="space-y-1.5">
          <Label>{t("project.settings.general.projectId")}</Label>
          <Input value={project?.id ?? ""} disabled className="font-mono text-xs" />
        </div>

        {/* 공개/비공개 — 프로젝트 관리자 이상만 변경 가능 */}
        {isProjectAdmin && (
          <div className="space-y-1.5">
            <Label>{t("project.settings.general.network")}</Label>
            <Controller
              control={control}
              name="network"
              render={({ field }) => (
                <Select
                  value={String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">{t("project.settings.general.networkSecret")}</SelectItem>
                    <SelectItem value="0">{t("project.settings.general.networkPublic")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        )}

        <Button type="submit" size="sm" disabled={updateMutation.isPending}>
          {updateMutation.isPending ? t("project.settings.general.saving") : t("project.settings.general.save")}
        </Button>
      </form>

      {/* ── 기능 on/off — 관리자만 ── */}
      {isProjectAdmin && (
        <div className="border-t pt-8 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">
              {t("project.settings.general.featuresTitle", "사용할 기능")}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t(
                "project.settings.general.featuresHint",
                "프로젝트에서 쓸 뷰/탭을 선택하세요. 꺼진 기능은 사이드바·뷰 탭에서 숨겨집니다. 표/아카이브/휴지통은 항상 켜져 있습니다.",
              )}
            </p>
          </div>
          <FeatureToggleList
            features={(project?.features ?? {}) as Partial<Record<ProjectFeatureKey, boolean>>}
            onToggle={toggleFeature}
            pending={featureMutation.isPending}
          />

          {/* 요청 승인 정책 — 누가 승인/거절 가능한지 */}
          <div className="mt-6 rounded-lg border bg-card/40 p-4 space-y-2">
            <p className="text-sm font-medium">{t("project.settings.general.reviewPolicyTitle", "요청 승인 권한")}</p>
            <p className="text-xs text-muted-foreground">
              {t(
                "project.settings.general.reviewPolicyHint",
                "들어온 요청을 누가 승인/거절할 수 있는지 결정합니다.",
              )}
            </p>
            <div className="inline-flex rounded-md border border-border overflow-hidden mt-2">
              <button
                type="button"
                onClick={() => reviewPolicyMutation.mutate("all")}
                disabled={reviewPolicyMutation.isPending}
                className={cn(
                  "px-3 py-1.5 text-xs transition-colors",
                  (project?.request_review_policy ?? "all") === "all"
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/40"
                )}
              >
                {t("project.settings.general.reviewPolicy.all", "모든 멤버 가능")}
              </button>
              <button
                type="button"
                onClick={() => reviewPolicyMutation.mutate("admin")}
                disabled={reviewPolicyMutation.isPending}
                className={cn(
                  "px-3 py-1.5 text-xs border-l border-border transition-colors",
                  project?.request_review_policy === "admin"
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/40"
                )}
              >
                {t("project.settings.general.reviewPolicy.admin", "관리자만")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 위험 구역 — 프로젝트 나가기는 모두, 보관/삭제는 관리자만 ── */}
      <div className="border-t pt-8 space-y-4">
        <h2 className="text-sm font-semibold text-destructive">{t("project.settings.general.dangerZone")}</h2>

        {/* 프로젝트 나가기 — 모든 멤버 가능 */}
        <div className="flex items-center justify-between rounded-lg border glass p-4">
          <div>
            <p className="text-sm font-medium">{t("project.settings.general.leaveTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("project.settings.general.leaveDescription")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setLeaveOpen(true)}>
            {t("project.settings.general.leaveButton")}
          </Button>
        </div>

        {/* 프로젝트 보관 — 관리자 이상 */}
        {isProjectAdmin && (
          <div className="flex items-center justify-between rounded-lg border glass p-4">
            <div>
              <p className="text-sm font-medium">{t("project.settings.general.archiveTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("project.settings.general.archiveDescription")}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
              {t("project.settings.general.archiveButton")}
            </Button>
          </div>
        )}

        {/* 프로젝트 삭제 — 관리자 이상 */}
        {isProjectAdmin && (
          <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-4">
            <div>
              <p className="text-sm font-medium text-destructive">{t("project.settings.general.deleteTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("project.settings.general.deleteDescription")}</p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              {t("project.settings.general.deleteButton")}
            </Button>
          </div>
        )}
      </div>

      {/* ── 보관 확인 다이얼로그 ── */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("project.settings.general.archiveConfirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("project.settings.general.archiveConfirmMessage")}</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>{t("project.settings.general.cancel")}</Button>
            <Button onClick={() => archiveMutation.mutate()} disabled={archiveMutation.isPending}>
              {t("project.settings.general.archiveButton")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── 삭제 확인 다이얼로그 ── */}
      <Dialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); setDeleteConfirm(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("project.settings.general.deleteConfirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("project.settings.general.deleteConfirmMessage", { name: project?.name })}
          </p>
          <Input
            placeholder={project?.name ?? ""}
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            className="mt-2"
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t("project.settings.general.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm !== project?.name || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {t("project.settings.general.deleteButton")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── 나가기 확인 다이얼로그 ── */}
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("project.settings.general.leaveConfirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("project.settings.general.leaveConfirmMessage")}</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setLeaveOpen(false)}>{t("project.settings.general.cancel")}</Button>
            <Button variant="destructive" onClick={() => leaveMutation.mutate()} disabled={leaveMutation.isPending}>
              {t("project.settings.general.leaveButton")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   IdentifierField — 프로젝트 식별자 편집 + 실시간 중복 검사
══════════════════════════════════════════════════ */

function IdentifierField({ workspaceSlug, projectId, currentValue }: {
  workspaceSlug: string;
  projectId: string;
  currentValue: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [value, setValue] = useState(currentValue);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  /* currentValue 변경 시 동기화 (서버 응답 후) */
  useEffect(() => { setValue(currentValue); }, [currentValue]);

  /* 입력 변경 시 500ms 디바운스로 중복 체크 */
  const handleChange = (raw: string) => {
    const sanitized = raw.toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 12);
    setValue(sanitized);
    setAvailable(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!sanitized || sanitized.length < 2 || sanitized === currentValue) {
      setAvailable(sanitized === currentValue ? null : null);
      return;
    }
    setChecking(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await projectsApi.checkIdentifier(workspaceSlug, sanitized, projectId);
        setAvailable(res.available);
      } catch { setAvailable(null); }
      setChecking(false);
    }, 500);
  };

  const saveMutation = useMutation({
    mutationFn: () => projectsApi.update(workspaceSlug, projectId, { identifier: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", workspaceSlug, projectId] });
      qc.invalidateQueries({ queryKey: ["projects", workspaceSlug] });
      qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] });
      toast.success(t("project.settings.general.identifierUpdated"));
    },
    onError: () => toast.error(t("project.settings.general.identifierUpdateFailed")),
  });

  const changed = value !== currentValue;
  const canSave = changed && value.length >= 2 && available === true;

  return (
    <div className="space-y-1.5">
      <Label>{t("project.settings.general.identifier")}</Label>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="font-mono uppercase w-48"
          maxLength={12}
        />
        {changed && (
          <Button
            type="button"
            size="sm"
            disabled={!canSave || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? t("project.settings.general.saving") : t("project.settings.general.changeIdentifier")}
          </Button>
        )}
      </div>
      {/* 상태 메시지 */}
      {checking && <p className="text-xs text-muted-foreground">{t("project.settings.general.identifierChecking")}</p>}
      {!checking && available === true && changed && (
        <p className="text-xs text-green-600">{t("project.settings.general.identifierAvailable")}</p>
      )}
      {!checking && available === false && (
        <p className="text-xs text-destructive">{t("project.settings.general.identifierTaken")}</p>
      )}
      {!changed && <p className="text-xs text-muted-foreground">{t("project.settings.general.identifierHint")}</p>}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   FeatureToggleList — 프로젝트 기능 on/off 체크박스 리스트
══════════════════════════════════════════════════ */

const FEATURE_DEFS: { key: ProjectFeatureKey; labelKey: string; descKey: string }[] = [
  { key: "board",     labelKey: "project.settings.features.board.label",     descKey: "project.settings.features.board.desc" },
  { key: "backlog",   labelKey: "project.settings.features.backlog.label",   descKey: "project.settings.features.backlog.desc" },
  { key: "calendar",  labelKey: "project.settings.features.calendar.label",  descKey: "project.settings.features.calendar.desc" },
  { key: "timeline",  labelKey: "project.settings.features.timeline.label",  descKey: "project.settings.features.timeline.desc" },
  { key: "graph",     labelKey: "project.settings.features.graph.label",     descKey: "project.settings.features.graph.desc" },
  { key: "sprints",   labelKey: "project.settings.features.sprints.label",   descKey: "project.settings.features.sprints.desc" },
  { key: "analytics", labelKey: "project.settings.features.analytics.label", descKey: "project.settings.features.analytics.desc" },
  { key: "request",   labelKey: "project.settings.features.request.label",   descKey: "project.settings.features.request.desc" },
];

const DEFAULT_LABELS: Record<ProjectFeatureKey, [string, string]> = {
  board:     ["보드 뷰",       "칸반 스타일로 상태별 카드 배치"],
  backlog:   ["백로그 뷰",     "backlog 상태 이슈 모아보기"],
  calendar:  ["캘린더 뷰",     "기간/이벤트 월/주 단위 표시"],
  timeline:  ["타임라인 뷰",   "이슈를 간트 차트로 보기"],
  graph:     ["그래프 뷰",     "이슈 연결 관계망 시각화"],
  sprints:   ["스프린트",      "스프린트 생성·운영 (번다운 포함)"],
  analytics: ["통계",          "상태·우선순위·담당자별 차트"],
  request:   ["요청 보내기",    "버그/기능 요청 접수 페이지"],
};

function FeatureToggleList({
  features,
  onToggle,
  pending,
}: {
  features: Partial<Record<ProjectFeatureKey, boolean>>;
  onToggle: (key: ProjectFeatureKey) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {FEATURE_DEFS.map(({ key, labelKey, descKey }) => {
        const isOn = features[key] !== false;
        const [defaultLabel, defaultDesc] = DEFAULT_LABELS[key];
        return (
          <label
            key={key}
            className={
              "flex items-start gap-3 rounded-lg border glass p-3 cursor-pointer select-none transition-colors " +
              (pending ? "opacity-70 cursor-wait " : "hover:bg-muted/20 ")
            }
          >
            <input
              type="checkbox"
              checked={isOn}
              onChange={() => !pending && onToggle(key)}
              disabled={pending}
              className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{t(labelKey, defaultLabel)}</div>
              <div className="text-2xs text-muted-foreground mt-0.5">{t(descKey, defaultDesc)}</div>
            </div>
          </label>
        );
      })}
    </div>
  );
}
