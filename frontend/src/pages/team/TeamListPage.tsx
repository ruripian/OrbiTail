/**
 * 팀 목록 페이지 — /<ws>/teams.
 *
 * 본인이 멤버인 팀만 나열. + 새 팀 만들기.
 * 탐색(비멤버 팀 노출) 은 현재 정책상 미지원.
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-error";
import { Plus, Users, ArrowRight } from "lucide-react";
import { teamsApi } from "@/api/teams";
import { TeamAvatar } from "./TeamAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ProjectIconPicker, parseIconProp, type IconProp } from "@/components/ui/project-icon-picker";

export function TeamListPage() {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["teams", workspaceSlug],
    queryFn: () => teamsApi.list(workspaceSlug),
    enabled: !!workspaceSlug,
  });

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-regular mx-auto px-6 py-10">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">{t("team.title")}</h1>
          <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" />
            {t("team.create")}
          </Button>
        </header>

        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-12">{t("team.loading")}</p>
        ) : teams.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center">
            <Users className="h-8 w-8 mx-auto mb-3 text-muted-foreground/60" />
            <p className="text-sm font-medium mb-1">{t("team.empty.title")}</p>
            <p className="text-xs text-muted-foreground mb-4">{t("team.empty.description")}</p>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              {t("team.create")}
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {teams.map((team) => (
              <li key={team.id}>
                <button
                  onClick={() => navigate(`/${workspaceSlug}/teams/${team.id}`)}
                  className="group w-full text-left rounded-xl border bg-card hover:bg-accent/40 hover:border-primary/40 transition-colors p-4"
                >
                  <div className="flex items-start gap-3">
                    <TeamAvatar team={team} box={40} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h3 className="text-sm font-semibold truncate">{team.name}</h3>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>
                      {team.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{team.description}</p>
                      )}
                      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        <span>{t("team.memberCount", { count: team.member_count })}</span>
                        {team.my_role === 20 && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-2xs font-semibold">
                            {t("team.role.admin")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (team) => {
          qc.invalidateQueries({ queryKey: ["teams", workspaceSlug] });
          setCreateOpen(false);
          navigate(`/${workspaceSlug}/teams/${team.id}`);
        }}
      />
    </div>
  );
}

/* ────────────── 새 팀 만들기 다이얼로그 ────────────── */
function CreateTeamDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (team: { id: string }) => void | Promise<void>;
}) {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<IconProp>(() => parseIconProp({ name: "Users", color: "#5E6AD2" }));

  const createMutation = useMutation({
    mutationFn: () =>
      teamsApi.create(workspaceSlug, {
        name: name.trim(),
        description,
        icon_prop: icon as unknown as Record<string, unknown>,
      }),
    onSuccess: (team) => {
      setName(""); setDescription("");
      onCreated(team);
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("team.createDialog.failed"))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("team.createDialog.title")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) createMutation.mutate(); }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label>{t("team.form.icon")}</Label>
            <ProjectIconPicker
              value={icon as unknown as Record<string, unknown>}
              onChange={setIcon}
              size="md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">
              {t("team.form.name")} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("team.form.namePlaceholder")}
              maxLength={100}
              required
              autoFocus
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">
              {t("team.form.descriptionOptional")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("team.form.descriptionPlaceholder")}
              rows={2}
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 resize-y"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("team.form.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
              {createMutation.isPending
                ? t("team.createDialog.submitting")
                : t("team.createDialog.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
