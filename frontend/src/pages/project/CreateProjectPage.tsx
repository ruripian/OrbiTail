import { useState, useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Lock, Globe, Check } from "lucide-react";

import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ProjectIconPicker, type IconProp,
} from "@/components/ui/project-icon-picker";
import { MemberMultiSelect } from "@/components/ui/member-multi-select";

/**
 * 프로젝트 생성 페이지 — 대시보드 스타일 넓은 카드 레이아웃
 *
 * 필드:
 *  - 아이콘(icon_prop)  : lucide 아이콘 + 색상
 *  - 이름(name)          : 입력 시 식별자 자동 생성
 *  - 식별자(identifier)  : A-Z, 0-9, 2~12자
 *  - 설명(description)   : Textarea 3줄
 *  - 리더(lead)          : 워크스페이스 멤버 드롭다운, 기본값=본인
 *  - 공개 범위(network)  : 비공개(2) / 공개(0) 카드 선택
 */

const schema = z.object({
  name: z.string().min(1),
  identifier: z.string().min(2).max(12).regex(/^[A-Z0-9_-]+$/),
  description: z.string().optional(),
  network: z.union([z.literal(0), z.literal(2)]),
  lead: z.string().uuid().nullable(),
});

type FormValues = z.infer<typeof schema>;

export function CreateProjectPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  /* 워크스페이스 정보 + 멤버 목록 — 리더 드롭다운용 */
  const { data: workspace } = useQuery({
    queryKey: ["workspace", workspaceSlug],
    queryFn: () => workspacesApi.get(workspaceSlug!),
    enabled: !!workspaceSlug,
  });
  const { data: wsMembers = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  /* 아이콘은 form 외부 state — Controller 대신 별도 state로 관리(직렬화 간결) */
  const [icon, setIcon] = useState<IconProp>({
    type: "lucide",
    name: "Box",
    color: "#5E6AD2",
  });

  /* 초기 참여자 — 생성자/리더 포함한 전체 멤버 id 리스트(locked = 생성자+리더) */
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      network: 2,
      lead: currentUser?.id ?? null,
    },
  });

  const identifierValue = watch("identifier");

  /* 식별자 실시간 중복 체크 — 500ms 디바운스 */
  const [idAvailable, setIdAvailable] = useState<boolean | null>(null);
  const [idChecking, setIdChecking] = useState(false);
  const idDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setIdAvailable(null);
    if (idDebounceRef.current) clearTimeout(idDebounceRef.current);
    if (!identifierValue || identifierValue.length < 2 || !workspaceSlug) return;
    setIdChecking(true);
    idDebounceRef.current = setTimeout(async () => {
      try {
        const res = await projectsApi.checkIdentifier(workspaceSlug, identifierValue);
        setIdAvailable(res.available);
      } catch { setIdAvailable(null); }
      setIdChecking(false);
    }, 500);
    return () => { if (idDebounceRef.current) clearTimeout(idDebounceRef.current); };
  }, [identifierValue, workspaceSlug]);

  const mutation = useMutation({
    mutationFn: (data: FormValues) =>
      projectsApi.create(workspaceSlug!, {
        ...data,
        icon_prop: icon as unknown as Record<string, unknown>,
        /* 생성자/리더는 백엔드에서 자동 추가 → 제외 */
        member_ids: memberIds.filter(
          (id) => id !== currentUser?.id && id !== data.lead,
        ),
      }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["projects", workspaceSlug] });
      toast.success(t("project.create.success"));
      navigate(`/${workspaceSlug}/projects/${project.id}/issues`);
    },
    onError: () => toast.error(t("project.create.error")),
  });

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-3xl px-6 py-6">
        {/* 상단 컨텍스트 바 */}
        <button
          type="button"
          onClick={() => navigate(`/${workspaceSlug}`)}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {workspace?.name ?? t("project.create.backToWorkspace")}
        </button>

        {/* 제목 — 인라인 한 줄로 압축 */}
        <div className="mb-4 flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight">
            {t("project.create.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("project.create.subtitle")}
          </p>
        </div>

        {/* 본문 카드 — lg 이상에서 2열 레이아웃 */}
        <form
          onSubmit={handleSubmit((d) => mutation.mutate(d))}
          className="rounded-xl border glass shadow-sm"
        >
          <div className="p-5 grid gap-x-6 gap-y-4 lg:grid-cols-2">
            {/* 왼쪽: 이름 + 식별자 + 설명 */}
            <div className="space-y-4">
              {/* 이름 (아이콘 inline) */}
              <div className="space-y-1">
                <Label htmlFor="name">{t("project.create.name")}</Label>
                <div className="flex items-center gap-3">
                  <ProjectIconPicker
                    value={icon as unknown as Record<string, unknown>}
                    onChange={setIcon}
                    size="md"
                  />
                  <Input
                    id="name"
                    placeholder={t("project.create.namePlaceholder")}
                    className="flex-1"
                    {...register("name")}
                    onChange={(e) => {
                      setValue("name", e.target.value);
                      setValue(
                        "identifier",
                        e.target.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 12),
                      );
                    }}
                  />
                </div>
                {errors.name && (
                  <p className="text-xs text-destructive">{t("project.create.nameRequired")}</p>
                )}
              </div>

              {/* 식별자 — hint는 label 옆 inline */}
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="identifier">{t("project.create.identifier")}</Label>
                  <span className="text-2xs text-muted-foreground truncate">
                    {identifierValue
                      ? t("project.create.identifierPreview", { id: identifierValue })
                      : t("project.create.identifierHint")}
                  </span>
                </div>
                <Input
                  id="identifier"
                  {...register("identifier")}
                  className="font-mono uppercase"
                  onChange={(e) => {
                    /* 사용자가 소문자/특수문자 입력해도 자동으로 A-Z/0-9 대문자로 변환 */
                    const sanitized = e.target.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 12);
                    setValue("identifier", sanitized, { shouldValidate: true });
                  }}
                />
                {errors.identifier && (
                  <p className="text-xs text-destructive">{t("project.create.identifierInvalid")}</p>
                )}
                {idChecking && <p className="text-xs text-muted-foreground">{t("project.settings.general.identifierChecking")}</p>}
                {!idChecking && idAvailable === true && <p className="text-xs text-green-600">{t("project.settings.general.identifierAvailable")}</p>}
                {!idChecking && idAvailable === false && <p className="text-xs text-destructive">{t("project.settings.general.identifierTaken")}</p>}
              </div>

              {/* 설명 — rows=2로 압축 */}
              <div className="space-y-1">
                <Label htmlFor="description">{t("project.create.description")}</Label>
                <textarea
                  id="description"
                  placeholder={t("project.create.descriptionPlaceholder")}
                  rows={2}
                  {...register("description")}
                  className="flex w-full rounded-md border border-border bg-input/60 px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
              </div>
            </div>

            {/* 오른쪽: 리더 + 공개범위 */}
            <div className="space-y-4">
              {/* 프로젝트 리더 — hint는 label 옆 inline */}
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="lead">{t("project.create.lead")}</Label>
                  <span className="text-2xs text-muted-foreground truncate">
                    {t("project.create.leadHint")}
                  </span>
                </div>
                <Controller
                  control={control}
                  name="lead"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(v) => field.onChange(v || null)}
                    >
                      <SelectTrigger id="lead">
                        <SelectValue placeholder={t("project.create.leadPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {wsMembers.map((wm) => (
                          <SelectItem key={wm.member.id} value={wm.member.id}>
                            {wm.member.display_name}
                            {wm.member.id === currentUser?.id
                              ? ` (${t("project.create.leadYou")})`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              {/* 공개/비공개 카드 선택 — 컴팩트 */}
              <div className="space-y-1">
                <Label>{t("project.create.network")}</Label>
                <Controller
                  control={control}
                  name="network"
                  render={({ field }) => (
                    <div className="grid grid-cols-2 gap-2">
                      <NetworkCard
                        selected={field.value === 2}
                        onClick={() => field.onChange(2)}
                        icon={<Lock className="h-3.5 w-3.5" />}
                        title={t("project.create.networkSecret")}
                        description={t("project.create.networkSecretHint")}
                      />
                      <NetworkCard
                        selected={field.value === 0}
                        onClick={() => field.onChange(0)}
                        icon={<Globe className="h-3.5 w-3.5" />}
                        title={t("project.create.networkPublic")}
                        description={t("project.create.networkPublicHint")}
                      />
                    </div>
                  )}
                />
              </div>
            </div>
          </div>

          {/* 참여자 선택 — 풀 폭 (검색 가능한 멀티셀렉트, 생성자/리더 자동 포함) */}
          <div className="border-t border-border px-5 py-4">
            <Controller
              control={control}
              name="lead"
              render={({ field }) => {
                const leadId = field.value;
                /* locked: 생성자 본인 + 현재 리더 — 제거 불가 */
                const lockedIds = [currentUser?.id, leadId].filter((v): v is string => !!v);
                /* UI 표시용 전체 selectedIds = lockedIds ∪ memberIds (중복 제거) */
                const allSelected = Array.from(new Set([...lockedIds, ...memberIds]));

                const options = wsMembers.map((wm) => ({
                  id: wm.member.id,
                  name: wm.member.display_name,
                  email: wm.member.email,
                  avatar: wm.member.avatar,
                }));

                const getBadge = (id: string): string | null => {
                  if (id === currentUser?.id) return `(${t("project.create.leadYou")})`;
                  if (id === leadId) return "★";
                  return null;
                };

                return (
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label>{t("project.create.members")}</Label>
                      <span className="text-2xs text-muted-foreground">
                        {t("project.create.membersHint")}
                      </span>
                    </div>
                    <MemberMultiSelect
                      options={options}
                      selectedIds={allSelected}
                      lockedIds={lockedIds}
                      getBadge={getBadge}
                      placeholder={t("project.create.membersPlaceholder")}
                      onChange={(ids) => {
                        /* locked는 항상 포함 상태로 간주하므로 내부 state에는 그 외만 저장 */
                        const lockedSet = new Set(lockedIds);
                        setMemberIds(ids.filter((id) => !lockedSet.has(id)));
                      }}
                    />
                  </div>
                );
              }}
            />
          </div>

          {/* 액션 — 취소/생성 (카드 하단 border) */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20 rounded-b-xl">
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate(`/${workspaceSlug}`)}
              disabled={mutation.isPending}
            >
              {t("project.create.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t("project.create.submitting") : t("project.create.submit")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* 공개/비공개 선택 카드 — 컴팩트 버전 (description 2줄 -> 1줄) */
function NetworkCard({
  selected, onClick, icon, title, description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-all ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${
            selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {icon}
        </span>
        <span className="text-sm font-medium">{title}</span>
        {selected && <Check className="h-3.5 w-3.5 text-primary ml-auto" />}
      </div>
      <p className="text-2xs text-muted-foreground line-clamp-1">{description}</p>
    </button>
  );
}
