/**
 * WorkspaceGeneralPage — 워크스페이스 기본 정보 설정 (Admin 이상).
 *
 * 편집 항목:
 *   - name        : 자동저장 (blur)
 *   - slug        : 별도 다이얼로그(경고 포함) — Admin 이상
 *   - description : 자동저장 (blur)
 *   - logo        : 업로드/제거 즉시
 *   - brand_color : 색 선택 즉시
 *   - priority_colors : 우선순위별 5개 색 + 기본값 reset
 *
 * UX:
 *   - 변경 사항은 즉시 PATCH (저장 버튼 없음)
 *   - slug 만 confirm dialog 거침 — 변경 시 모든 URL/북마크 깨짐 경고
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Trash2, AlertTriangle, RotateCcw } from "lucide-react";
import { workspacesApi } from "@/api/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PriorityColors, Workspace } from "@/types";

/** 우선순위 색 디폴트 — backend 가 빈 dict 반환 시 표시할 fallback. tokens.css 와 일치 권장. */
const PRIORITY_KEYS = ["urgent", "high", "medium", "low", "none"] as const;
type PriorityKey = (typeof PRIORITY_KEYS)[number];
const PRIORITY_DEFAULTS: Record<PriorityKey, string> = {
  urgent: "#ff4444",
  high: "#ff4db8",
  medium: "#f5c400",
  low: "#aaff00",
  none: "#6b7080",
};

export function WorkspaceGeneralPage() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: workspace, isLoading } = useQuery({
    queryKey: ["workspace", workspaceSlug],
    queryFn: () => workspacesApi.get(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  /* 로컬 편집 state — server 데이터 기준으로 매번 동기화 */
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [priorityColors, setPriorityColors] = useState<PriorityColors>({});
  /* slug 변경 다이얼로그 */
  const [slugDialogOpen, setSlugDialogOpen] = useState(false);
  const [pendingSlug, setPendingSlug] = useState("");

  useEffect(() => {
    if (!workspace) return;
    setName(workspace.name);
    setDescription(workspace.description ?? "");
    setBrandColor(workspace.brand_color ?? "");
    setPriorityColors(workspace.priority_colors ?? {});
  }, [workspace?.id]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Workspace>) => workspacesApi.update(workspaceSlug!, data),
    onSuccess: (updated) => {
      qc.setQueryData(["workspace", workspaceSlug], updated);
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.detail ?? t("workspaceSettings.general.updateFailed", "변경에 실패했습니다");
      toast.error(msg);
    },
  });

  /* slug 변경은 별도 mutation — 성공 시 새 slug 로 라우트 이동 (URL 자체가 바뀌므로) */
  const slugMutation = useMutation({
    mutationFn: (newSlug: string) => workspacesApi.update(workspaceSlug!, { slug: newSlug }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.removeQueries({ queryKey: ["workspace", workspaceSlug] });
      toast.success(t("workspaceSettings.general.slugChanged", "주소가 변경되었습니다"));
      /* 현재 URL의 ws slug 부분만 새 값으로 치환해 같은 화면으로 이동 */
      const path = window.location.pathname.replace(`/${workspaceSlug}/`, `/${updated.slug}/`);
      navigate(path, { replace: true });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.slug?.[0]
        ?? e?.response?.data?.detail
        ?? t("workspaceSettings.general.slugFailed", "주소 변경에 실패했습니다");
      toast.error(msg);
    },
  });

  /* 로고 — File 직접 업로드 */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoUpload = useMutation({
    mutationFn: (file: File) => workspacesApi.uploadLogo(workspaceSlug!, file),
    onSuccess: (updated) => {
      qc.setQueryData(["workspace", workspaceSlug], updated);
      toast.success(t("workspaceSettings.general.logoUpdated", "로고가 변경되었습니다"));
    },
    onError: () => toast.error(t("workspaceSettings.general.logoFailed", "로고 업로드 실패")),
  });
  const logoRemove = useMutation({
    mutationFn: () => workspacesApi.removeLogo(workspaceSlug!),
    onSuccess: (updated) => qc.setQueryData(["workspace", workspaceSlug], updated),
  });

  /* blur / picker close 시 변경 commit. 값이 같으면 noop. */
  const commitName = () => {
    if (workspace && name !== workspace.name && name.trim()) {
      updateMutation.mutate({ name });
    }
  };
  const commitDescription = () => {
    if (workspace && description !== (workspace.description ?? "")) {
      updateMutation.mutate({ description });
    }
  };
  const commitBrandColor = (color: string) => {
    setBrandColor(color);
    updateMutation.mutate({ brand_color: color });
  };
  const commitPriorityColor = (key: PriorityKey, color: string) => {
    const next = { ...priorityColors, [key]: color };
    setPriorityColors(next);
    updateMutation.mutate({ priority_colors: next });
  };
  const resetPriorityColors = () => {
    setPriorityColors({});
    updateMutation.mutate({ priority_colors: {} });
  };

  if (isLoading || !workspace) {
    return <div className="text-sm text-muted-foreground">{t("common.loading", "불러오는 중…")}</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-1">{t("workspaceSettings.general.title", "일반 설정")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("workspaceSettings.general.subtitle", "워크스페이스 기본 정보 — 변경은 자동 저장됩니다")}
        </p>
      </div>

      {/* 로고 */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("workspaceSettings.general.logo", "로고")}</h2>
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-xl border bg-muted/30 overflow-hidden flex items-center justify-center">
            {workspace.logo ? (
              <img src={workspace.logo} alt={workspace.name} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xl font-bold text-primary">{workspace.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={logoUpload.isPending}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              {t("workspaceSettings.general.upload", "업로드")}
            </Button>
            {workspace.logo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => logoRemove.mutate()}
                disabled={logoRemove.isPending}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                {t("workspaceSettings.general.remove", "제거")}
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) logoUpload.mutate(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </section>

      {/* 이름 */}
      <section className="space-y-2">
        <label className="text-sm font-semibold">{t("workspaceSettings.general.name", "이름")}</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          placeholder={t("workspaceSettings.general.namePlaceholder", "워크스페이스 이름") as string}
          maxLength={255}
        />
      </section>

      {/* slug */}
      <section className="space-y-2">
        <label className="text-sm font-semibold flex items-center gap-2">
          {t("workspaceSettings.general.slug", "주소(slug)")}
          <span className="text-2xs text-muted-foreground font-normal">
            {t("workspaceSettings.general.slugHint", "URL 의 일부 — 변경 시 모든 링크가 깨집니다")}
          </span>
        </label>
        <div className="flex gap-2">
          <Input value={workspace.slug} readOnly className="flex-1 font-mono text-sm bg-muted/30" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPendingSlug(workspace.slug);
              setSlugDialogOpen(true);
            }}
          >
            {t("workspaceSettings.general.changeSlug", "변경")}
          </Button>
        </div>
      </section>

      {/* 설명 */}
      <section className="space-y-2">
        <label className="text-sm font-semibold">{t("workspaceSettings.general.description", "설명")}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          placeholder={t("workspaceSettings.general.descriptionPlaceholder", "이 워크스페이스의 용도/팀 소개") as string}
          rows={3}
          className={cn(
            "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
            "ring-offset-background placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
      </section>

      {/* brand color */}
      <section className="space-y-2">
        <label className="text-sm font-semibold">
          {t("workspaceSettings.general.brandColor", "브랜드 색")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("workspaceSettings.general.brandColorDesc", "워크스페이스 아바타와 액센트에 사용. 빈 값이면 기본 색 사용.")}
        </p>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={brandColor || "#5e6ad2"}
            onChange={(e) => commitBrandColor(e.target.value)}
            className="h-10 w-14 rounded-md cursor-pointer border"
          />
          <Input
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            onBlur={() => commitBrandColor(brandColor)}
            placeholder="#5e6ad2 또는 빈 값"
            className="flex-1 font-mono text-sm"
          />
          {brandColor && (
            <Button variant="ghost" size="sm" onClick={() => commitBrandColor("")}>
              {t("workspaceSettings.general.useDefault", "기본값")}
            </Button>
          )}
        </div>
      </section>

      {/* 우선순위 색 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">
              {t("workspaceSettings.general.priorityColors", "우선순위 색")}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("workspaceSettings.general.priorityColorsDesc", "이슈 우선순위 5단계의 색을 워크스페이스 단위로 커스터마이즈")}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={resetPriorityColors}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            {t("workspaceSettings.general.resetDefaults", "기본값으로")}
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PRIORITY_KEYS.map((key) => {
            const cur = priorityColors[key] ?? PRIORITY_DEFAULTS[key];
            return (
              <div key={key} className="flex items-center gap-2 p-2 rounded-md border">
                <input
                  type="color"
                  value={cur}
                  onChange={(e) => commitPriorityColor(key, e.target.value)}
                  className="h-8 w-10 rounded cursor-pointer border"
                />
                <span className="text-xs font-medium capitalize w-16">{key}</span>
                <Input
                  value={cur}
                  onChange={(e) => setPriorityColors({ ...priorityColors, [key]: e.target.value })}
                  onBlur={() => commitPriorityColor(key, priorityColors[key] ?? PRIORITY_DEFAULTS[key])}
                  className="flex-1 font-mono text-xs h-8"
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* slug 변경 다이얼로그 */}
      <Dialog open={slugDialogOpen} onOpenChange={setSlugDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t("workspaceSettings.general.slugWarn.title", "주소 변경 — 신중하게")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>{t("workspaceSettings.general.slugWarn.line1", "주소를 바꾸면 다음이 모두 영향을 받습니다:")}</p>
            <ul className="text-xs list-disc pl-5 space-y-1">
              <li>{t("workspaceSettings.general.slugWarn.l1", "북마크/공유 링크 모두 깨짐")}</li>
              <li>{t("workspaceSettings.general.slugWarn.l2", "외부 시스템(CI/Webhook)에 등록된 URL 도 수동 업데이트 필요")}</li>
              <li>{t("workspaceSettings.general.slugWarn.l3", "이전 주소는 즉시 사용 불가")}</li>
            </ul>
          </div>
          <div className="space-y-2 pt-2">
            <label className="text-xs font-medium text-foreground">
              {t("workspaceSettings.general.slugWarn.newSlug", "새 주소 (영문 소문자/숫자/하이픈만)")}
            </label>
            <Input
              value={pendingSlug}
              onChange={(e) => setPendingSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="my-workspace"
              className="font-mono"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={() => setSlugDialogOpen(false)}>
              {t("common.cancel", "취소")}
            </Button>
            <Button
              variant="destructive"
              disabled={!pendingSlug || pendingSlug === workspace.slug || slugMutation.isPending}
              onClick={() => {
                slugMutation.mutate(pendingSlug, {
                  onSuccess: () => setSlugDialogOpen(false),
                });
              }}
            >
              {t("workspaceSettings.general.slugWarn.confirm", "변경하기")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
