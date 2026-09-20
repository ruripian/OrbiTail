/**
 * 탈퇴자 개인 스페이스 관리 — 슈퍼유저 전용, 워크스페이스 상세 아래(`/admin/workspaces/:slug/spaces`).
 * 탈퇴/비활성 사용자의 personal 스페이스 목록 표시 + 영구 삭제.
 */
import { Link, useParams } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, Trash2, User as UserIcon, Loader2 } from "lucide-react";
import { api } from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/lib/dialogs";

interface OrphanSpace {
  id: string;
  name: string;
  owner_email: string | null;
  owner_display_name: string | null;
  owner_deleted_at: string | null;
  owner_is_active: boolean;
  document_count: number;
  created_at: string;
}

export function AdminOrphanSpacesPage() {
  const { t } = useTranslation();
  const { confirmDelete } = useDialogs();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data: spaces = [], isLoading } = useQuery({
    queryKey: ["orphan-spaces", workspaceSlug],
    queryFn: () =>
      api.get<OrphanSpace[]>(`/workspaces/${workspaceSlug}/documents/admin/orphan-spaces/`).then((r) => r.data),
    enabled: !!workspaceSlug,
  });

  const delMut = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/workspaces/${workspaceSlug}/documents/admin/orphan-spaces/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orphan-spaces", workspaceSlug] });
      toast.success(t("admin.orphanSpaces.deleted"));
    },
    onError: () => toast.error(t("sprints.deleteFailed")),
    onSettled: () => setDeleting(null),
  });

  const handleDelete = async (s: OrphanSpace) => {
    if (!(await confirmDelete(t("admin.orphanSpaces.deleteConfirm", { name: s.name })))) return;
    setDeleting(s.id);
    delMut.mutate(s.id);
  };

  return (
    <div className="space-y-4">
      <div>
        {/* 콘솔의 다른 탭은 전역이지만 이 페이지만 워크스페이스 한정이다 — 스코프를 상단에 못박는다. */}
        <Link
          to="/admin/workspaces"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t("admin.orphanSpaces.backToList")}
        </Link>
        <h1 className="text-lg font-semibold mt-1.5">{t("admin.orphanSpaces.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          <Trans i18nKey="admin.orphanSpaces.subtitle" values={{ slug: workspaceSlug }} components={{ b: <span className="font-medium text-foreground" /> }} />
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : spaces.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("admin.orphanSpaces.empty")}
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground bg-muted/30">
                <th className="px-3 py-2 text-left">{t("admin.audit.targetUser")}</th>
                <th className="px-3 py-2 text-left">{t("documents.docPicker.space")}</th>
                <th className="px-3 py-2 text-center">{t("admin.orphanSpaces.docCount")}</th>
                <th className="px-3 py-2 text-left">{t("documents.issueEmbed.state")}</th>
                <th className="px-3 py-2 text-left">{t("admin.orphanSpaces.createdOn")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {spaces.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <div>
                        <div className="font-medium text-xs">{s.owner_display_name || t("workspaceSettings.projects.noName")}</div>
                        <div className="text-2xs text-muted-foreground">{s.owner_email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">{s.name}</td>
                  <td className="px-3 py-2.5 text-center text-xs tabular-nums">{s.document_count}</td>
                  <td className="px-3 py-2.5 text-2xs">
                    {s.owner_deleted_at ? (
                      <span className="text-rose-500">{t("admin.orphanSpaces.deletedOn", { date: new Date(s.owner_deleted_at).toLocaleDateString() })}</span>
                    ) : (
                      <span className="text-amber-500">{t("memberDetail.inactive")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-2xs text-muted-foreground tabular-nums">
                    {new Date(s.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={deleting === s.id}
                      onClick={() => handleDelete(s)}
                    >
                      {deleting === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
