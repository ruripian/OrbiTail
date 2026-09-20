/**
 * 문서 스페이스 설정 · 일반 — 이름·아이콘·식별자·설명·공개 범위·보관·삭제.
 *
 * 아이콘/식별자/공개 범위는 모델에 이미 있던 필드인데 화면이 없어 손댈 수 없었다.
 * 프로젝트 스페이스는 프로젝트가 원본이라 대부분 읽기 전용으로 둔다.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Globe, Lock, Trash2 } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProjectIconPicker } from "@/components/ui/project-icon-picker";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api-error";
import { useSpaceSettings } from "./DocumentSpaceSettingsLayout";
import type { DocumentSpace } from "@/types";
import { useDialogs } from "@/lib/dialogs";

/** Radix Select 는 빈 문자열을 placeholder 로 예약하므로 "지정 안 함"에 sentinel 이 필요하다 */
const NO_HOME = "__none__";

export default function SpaceGeneralPage() {
  const { t } = useTranslation();
  const { confirmDelete } = useDialogs();
  const { space, workspaceSlug, spaceId, isAdmin } = useSpaceSettings();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isProject = space.space_type === "project";
  const isShared = space.space_type === "shared";

  const [name, setName] = useState(space.name);
  const [identifier, setIdentifier] = useState(space.identifier ?? "");
  const [description, setDescription] = useState(space.description ?? "");
  useEffect(() => {
    setName(space.name);
    setIdentifier(space.identifier ?? "");
    setDescription(space.description ?? "");
  }, [space.id, space.name, space.identifier, space.description]);

  /* 홈 문서 후보 — 폴더를 뺀 이 스페이스의 문서들 */
  const { data: docs = [] } = useQuery({
    queryKey: ["documents", workspaceSlug, spaceId, "all"],
    queryFn: () => documentsApi.list(workspaceSlug, spaceId, { all: "true" }),
  });

  const update = useMutation({
    mutationFn: (data: Partial<DocumentSpace>) => documentsApi.spaces.update(workspaceSlug, spaceId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
      toast.success(t("documents.spaceGeneral.saved"));
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("documents.cover.saveFailed"))),
  });

  const remove = useMutation({
    mutationFn: () => documentsApi.spaces.delete(workspaceSlug, spaceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
      toast.success(t("workspaceSettings.spaces.deleted"));
      navigate(`/${workspaceSlug}/documents`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("sprints.deleteFailed"))),
  });

  const archived = !!space.archived_at;

  return (
    <div className="max-w-regular space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{t("documents.spaceSettings.general")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("documents.spaceGeneral.subtitle")}
        </p>
      </div>

      {!isAdmin && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {t("documents.spaceGeneral.readOnly")}
        </p>
      )}

      <section className="rounded-xl border bg-card p-5 space-y-4">
        {/* 아이콘은 트리거가 정사각(48px)이라 입력창(36px)과 한 줄에 두면 높이가 어긋난다 —
            프로젝트 설정과 같이 독립 필드로 둔다 */}
        <div className="space-y-1.5">
          <Label className="text-xs">{t("documents.spaceGeneral.icon")}</Label>
          <div className="flex items-center gap-3">
            <ProjectIconPicker
              value={space.icon_prop}
              size="md"
              onChange={(next) => isAdmin && update.mutate({ icon_prop: next as unknown as Record<string, unknown> })}
            />
            <p className="text-xs text-muted-foreground">
              {t("documents.spaceGeneral.iconHint")}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">{t("documents.templates.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={isProject || !isAdmin} />
            {isProject && (
              <p className="text-2xs text-muted-foreground">{t("documents.spaceGeneral.nameSynced")}</p>
            )}
          </div>
          <div className="w-40 space-y-1.5">
            <Label className="text-xs">{t("documents.spaceGeneral.identifier")}</Label>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
              disabled={isProject || !isAdmin}
              placeholder="DOC"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{t("sprints.description")}</Label>
          <textarea
            className="w-full min-h-[72px] rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
            value={description}
            disabled={!isAdmin}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!isAdmin || update.isPending}
            onClick={() => update.mutate({ name: name.trim(), identifier: identifier.trim(), description: description.trim() })}
          >
            {update.isPending ? t("documents.templates.saving") : t("documents.templates.save")}
          </Button>
        </div>
      </section>

      {/* 홈 문서 — 스페이스 홈 맨 위에 고정해 보여 줄 개요 페이지 */}
      <section className="rounded-xl border bg-card p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{t("documents.spaceGeneral.homeDoc")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("documents.spaceGeneral.homeDocHint")}
          </p>
        </div>
        <Select
          value={space.home_document ?? NO_HOME}
          disabled={!isAdmin}
          onValueChange={(v) => update.mutate({ home_document: v === NO_HOME ? null : v })}
        >
          <SelectTrigger className="h-9 max-w-sm text-sm">
            <SelectValue placeholder={t("documents.spaceGeneral.none")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_HOME}>{t("documents.spaceGeneral.none")}</SelectItem>
            {docs.filter((d) => !d.is_folder).map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {/* 공개 범위 — 공용 스페이스에서만 의미가 있다.
          프로젝트 스페이스는 프로젝트 network 를, 개인 스페이스는 owner 를 따른다. */}
      <section className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">{t("request.visibility")}</h2>
        {isShared ? (
          <div className="space-y-2">
            {[
              { value: false, icon: Globe, title: t("workspaceSettings.projects.public"), desc: t("documents.spaceGeneral.publicDesc") },
              { value: true, icon: Lock, title: t("workspaceSettings.projects.private"), desc: t("documents.spaceGeneral.privateDesc") },
            ].map(({ value, icon: Icon, title, desc }) => (
              <button
                key={title}
                disabled={!isAdmin}
                onClick={() => update.mutate({ is_private: value })}
                className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                  !!space.is_private === value ? "border-primary bg-primary/5" : "hover:bg-accent/40"
                }`}
              >
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {isProject
              ? t("documents.spaceGeneral.followsProject")
              : t("documents.spaceGeneral.personalOnly")}
          </p>
        )}
      </section>

      {/* 보관 / 삭제 */}
      {!isProject && (
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-destructive">{t("documents.spaceGeneral.dangerZone")}</h2>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{archived ? t("workspaceSettings.projects.archived") : t("documents.spaceGeneral.archiveSpace")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("documents.spaceGeneral.archiveHint")}
              </p>
            </div>
            <Button
              size="sm" variant="outline" disabled={!isAdmin || update.isPending}
              onClick={() => update.mutate({ archived_at: archived ? null : new Date().toISOString() })}
            >
              {archived ? <ArchiveRestore className="h-3.5 w-3.5 mr-1.5" /> : <Archive className="h-3.5 w-3.5 mr-1.5" />}
              {archived ? t("workspaceSettings.projects.unarchive") : t("workspaceSettings.projects.archive")}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-destructive/20 pt-4">
            <div>
              <p className="text-sm font-medium">{t("documents.spaceGeneral.deleteSpace")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("documents.spaceGeneral.deleteHint")}
              </p>
            </div>
            <Button
              size="sm" variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              disabled={!isAdmin || remove.isPending}
              onClick={async () => {
                if (await confirmDelete(t("documents.spaceGeneral.deleteConfirm", { name: space.name }))) remove.mutate();
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {t("common.delete")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
