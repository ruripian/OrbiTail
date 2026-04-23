/**
 * 탈퇴자 개인 스페이스 관리 — 워크스페이스 관리자 전용.
 * 탈퇴/비활성 사용자의 personal 스페이스 목록 표시 + 영구 삭제.
 */
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, User as UserIcon, Loader2 } from "lucide-react";
import { api } from "@/lib/axios";
import { Button } from "@/components/ui/button";

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
      toast.success("스페이스가 삭제되었습니다.");
    },
    onError: () => toast.error("삭제 실패"),
    onSettled: () => setDeleting(null),
  });

  const handleDelete = (s: OrphanSpace) => {
    if (!window.confirm(`"${s.name}" 스페이스를 영구 삭제할까요?\n안의 모든 문서/첨부가 함께 삭제됩니다.`)) return;
    setDeleting(s.id);
    delMut.mutate(s.id);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">탈퇴자 개인 스페이스</h1>
        <p className="text-sm text-muted-foreground mt-1">
          탈퇴했거나 비활성화된 사용자의 개인 스페이스. 내용은 볼 수 없으며 영구 삭제만 가능합니다.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : spaces.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          정리할 탈퇴자 스페이스가 없습니다.
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground bg-muted/30">
                <th className="px-3 py-2 text-left">사용자</th>
                <th className="px-3 py-2 text-left">스페이스</th>
                <th className="px-3 py-2 text-center">문서 수</th>
                <th className="px-3 py-2 text-left">상태</th>
                <th className="px-3 py-2 text-left">생성일</th>
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
                        <div className="font-medium text-xs">{s.owner_display_name || "(이름 없음)"}</div>
                        <div className="text-2xs text-muted-foreground">{s.owner_email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">{s.name}</td>
                  <td className="px-3 py-2.5 text-center text-xs tabular-nums">{s.document_count}</td>
                  <td className="px-3 py-2.5 text-2xs">
                    {s.owner_deleted_at ? (
                      <span className="text-rose-500">탈퇴 ({new Date(s.owner_deleted_at).toLocaleDateString()})</span>
                    ) : (
                      <span className="text-amber-500">비활성</span>
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
