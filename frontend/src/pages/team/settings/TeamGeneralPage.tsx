/**
 * 팀 설정 · 일반 — 아이콘 · 이름 · 설명 · 삭제.
 *
 * 아이콘/이름/설명 모두 [저장] 을 눌러야 반영된다. 아이콘만 즉시 저장되면
 * "무엇이 이미 저장됐고 무엇이 안 됐는지" 가 화면에서 구분되지 않는다.
 * (프로젝트 설정은 아이콘을 즉시 저장한다 — 의도적으로 다르게 둔 지점)
 *
 * 단, 사용자 지정 이미지의 **파일 업로드 자체**는 고르는 즉시 일어난다.
 * URL 을 받아야 icon_prop 에 담을 수 있기 때문이다. 저장하지 않고 나가면
 * 업로드된 파일만 남는데, 이는 프로젝트/스페이스 아이콘도 동일하다.
 *
 * 팀 색(Team.color)은 아이콘이 색을 갖고 있어 별도 입력을 두지 않는다 —
 * 아이콘을 지정하지 않은 기존 팀의 첫 글자 아바타 색으로만 남는다(TeamAvatar).
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-error";
import { teamsApi } from "@/api/teams";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DangerZone } from "@/components/ui/danger-zone";
import { ProjectIconPicker, parseIconProp, type IconProp } from "@/components/ui/project-icon-picker";

export function TeamGeneralPage() {
  const { workspaceSlug = "", teamId = "" } = useParams<{ workspaceSlug: string; teamId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: team, isLoading } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => teamsApi.get(workspaceSlug, teamId),
    enabled: !!workspaceSlug && !!teamId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["team", teamId] });
    qc.invalidateQueries({ queryKey: ["teams", workspaceSlug] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => teamsApi.delete(workspaceSlug, teamId),
    onSuccess: () => {
      toast.success(t("team.settings.general.deleted"));
      qc.invalidateQueries({ queryKey: ["teams", workspaceSlug] });
      navigate(`/${workspaceSlug}/teams`, { replace: true });
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("team.settings.general.deleteFailed"))),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("team.loading")}</p>;
  }
  if (!team) {
    return <p className="text-sm text-muted-foreground">{t("team.notFound")}</p>;
  }

  const isAdmin = team.my_role === 20;

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-lg font-semibold">{t("team.settings.tabs.general")}</h1>

      <section className="rounded-xl border bg-card p-5 space-y-5">
        <h2 className="text-sm font-semibold">{t("team.settings.general.sectionTitle")}</h2>

        {/* key — 서버 값이 바뀌면 폼을 새로 마운트해 초기값을 다시 잡는다.
            useEffect + setState 로 동기화하면 cascading render 가 된다. */}
        <TeamInfoForm
          key={team.updated_at}
          workspaceSlug={workspaceSlug}
          teamId={teamId}
          initialName={team.name}
          initialDescription={team.description}
          initialIcon={team.icon_prop}
          disabled={!isAdmin}
          onSaved={invalidate}
        />
      </section>

      {isAdmin && (
        <DangerZone
          title={t("team.settings.general.dangerTitle")}
          description={t("team.settings.general.dangerDescription")}
          confirmText={team.name}
          confirmPlaceholder={t("team.settings.general.dangerPlaceholder")}
          buttonLabel={t("team.settings.general.dangerButton")}
          onConfirm={() => deleteMutation.mutate()}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

/* ────────────── 아이콘/이름/설명 폼 — [저장] 으로 한 번에 반영 ────────────── */
function TeamInfoForm({
  workspaceSlug, teamId, initialName, initialDescription, initialIcon, disabled, onSaved,
}: {
  workspaceSlug: string;
  teamId: string;
  initialName: string;
  initialDescription: string;
  initialIcon: Record<string, unknown> | null;
  disabled: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [icon, setIcon] = useState<IconProp>(() => parseIconProp(initialIcon));

  /* 저장할 게 없으면 버튼을 잠가 "안 눌러도 되는 상태" 를 눈으로 알 수 있게 한다 */
  const dirty =
    name !== initialName ||
    description !== initialDescription ||
    JSON.stringify(icon) !== JSON.stringify(parseIconProp(initialIcon));

  const updateMutation = useMutation({
    mutationFn: () =>
      teamsApi.update(workspaceSlug, teamId, {
        name: name.trim(),
        description,
        icon_prop: icon as unknown as Record<string, unknown>,
      }),
    onSuccess: () => {
      toast.success(t("team.settings.general.saved"));
      onSaved();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("team.settings.general.saveFailed"))),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) updateMutation.mutate(); }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label>{t("team.form.icon")}</Label>
        <div className="flex items-center gap-3">
          <ProjectIconPicker
            value={icon as unknown as Record<string, unknown>}
            onChange={setIcon}
            size="lg"
          />
          <p className="text-xs text-muted-foreground">{t("team.settings.general.iconHint")}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="team-name">{t("team.form.name")}</Label>
        <Input
          id="team-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          disabled={disabled}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="team-description">{t("team.form.description")}</Label>
        <textarea
          id="team-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={disabled}
          placeholder={t("team.form.descriptionPlaceholder")}
          className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 resize-y disabled:opacity-60"
        />
      </div>

      {!disabled && (
        <Button type="submit" disabled={!name.trim() || !dirty || updateMutation.isPending}>
          {updateMutation.isPending
            ? t("team.settings.general.saving")
            : t("team.settings.general.save")}
        </Button>
      )}
    </form>
  );
}
