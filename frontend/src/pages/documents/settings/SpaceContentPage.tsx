/**
 * 문서 스페이스 설정 · 콘텐츠 — 라벨 · 조회 통계 · 내보내기 · 템플릿.
 *
 * 휴지통은 설정이 아니라 전용 화면(DocumentTrashPage)에 있다 — 문서를 되찾는 건
 * 설정을 바꾸는 일이 아니라 목록을 훑고 고르는 작업이라서.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileText, Trash2 } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api-error";
import { useSpaceSettings } from "./DocumentSpaceSettingsLayout";

export default function SpaceContentPage() {
  const { space, workspaceSlug, spaceId } = useSpaceSettings();
  const qc = useQueryClient();
  const [exporting, setExporting] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ["document-templates", workspaceSlug, "space", spaceId],
    queryFn: () => documentsApi.templates.list(workspaceSlug, undefined, spaceId),
    /* 워크스페이스 공유 + 이 스페이스 전용만 추려 보여준다 — 개인 템플릿은 남의 설정 화면에 뜰 이유가 없다 */
    select: (list) => list.filter((t) => t.scope === "workspace" || t.scope === "space"),
  });

  const { data: labels = [] } = useQuery({
    queryKey: ["document-labels", workspaceSlug],
    queryFn: () => documentsApi.labels.list(workspaceSlug),
  });

  const { data: analytics } = useQuery({
    queryKey: ["space-analytics", workspaceSlug, spaceId],
    queryFn: () => documentsApi.spaces.analytics(workspaceSlug, spaceId, 30),
  });

  const renameLabel = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name?: string; color?: string }) =>
      documentsApi.labels.update(workspaceSlug, id, { name, color }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-labels", workspaceSlug] }),
    onError: (e) => toast.error(apiErrorMessage(e, "라벨 수정 실패")),
  });

  const deleteLabel = useMutation({
    mutationFn: (id: string) => documentsApi.labels.delete(workspaceSlug, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-labels", workspaceSlug] });
      toast.success("라벨 삭제됨");
    },
    onError: (e) => toast.error(apiErrorMessage(e, "라벨 삭제 실패")),
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await documentsApi.spaces.exportZip(workspaceSlug, spaceId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${space.name}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(apiErrorMessage(e, "내보내기 실패"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-regular space-y-6">
      <div>
        <h1 className="text-lg font-semibold">콘텐츠</h1>
        <p className="text-sm text-muted-foreground mt-1">
          라벨과 템플릿을 관리하고, 조회 현황을 보거나 스페이스를 통째로 내보냅니다.
        </p>
      </div>

      {/* 라벨 — 워크스페이스 단위라 여기서 고치면 다른 스페이스 문서에도 반영된다 */}
      <section className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">라벨</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            워크스페이스 전체에서 공유하는 분류입니다. 이름·색을 바꾸면 이 라벨이 붙은 모든 문서에 반영됩니다.
          </p>
        </div>
        {labels.length === 0 ? (
          <p className="p-5 text-xs text-muted-foreground">
            아직 라벨이 없습니다. 문서 편집 화면에서 라벨을 붙이면 여기에 나타납니다.
          </p>
        ) : (
          <ul className="divide-y">
            {labels.map((label) => (
              <li key={label.id} className="flex items-center gap-3 px-5 py-2.5">
                <input
                  type="color"
                  value={label.color}
                  onChange={(e) => renameLabel.mutate({ id: label.id, color: e.target.value })}
                  className="h-5 w-5 rounded cursor-pointer border-0 bg-transparent p-0"
                  title="색 변경"
                />
                <input
                  defaultValue={label.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== label.name) renameLabel.mutate({ id: label.id, name });
                  }}
                  className="flex-1 bg-transparent text-sm outline-none focus:border-b focus:border-primary"
                />
                <span className="text-2xs text-muted-foreground shrink-0">문서 {label.document_count}개</span>
                <button
                  onClick={() => {
                    if (window.confirm(`"${label.name}" 라벨을 삭제할까요? 문서는 지워지지 않고 라벨만 떨어집니다.`)) {
                      deleteLabel.mutate(label.id);
                    }
                  }}
                  className="text-muted-foreground hover:text-destructive p-1"
                  title="라벨 삭제"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 조회 통계 — 개인별 이력은 두지 않고 집계만 보여준다 */}
      <section className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">많이 본 문서</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            최근 30일 · 조회 {analytics?.total_views ?? 0}회 · 조회자 {analytics?.unique_viewers ?? 0}명
          </p>
        </div>
        {!analytics || analytics.top_documents.length === 0 ? (
          <p className="p-5 text-xs text-muted-foreground">최근 30일 조회 기록이 없습니다.</p>
        ) : (
          <ul className="divide-y">
            {analytics.top_documents.map((row, i) => (
              <li key={row.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="w-5 text-2xs font-mono text-muted-foreground shrink-0">{i + 1}</span>
                <span className="flex-1 truncate text-sm">{row.title}</span>
                <span className="text-2xs text-muted-foreground shrink-0">
                  {row.views}회 · {row.viewers}명
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 내보내기 */}
      <section className="rounded-xl border bg-card p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">스페이스 내보내기</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            모든 문서를 폴더 구조 그대로 HTML 묶음(zip)으로 받습니다. 첨부 이미지는 링크로만 남습니다.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={exporting} onClick={handleExport}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          {exporting ? "준비 중..." : "zip 내려받기"}
        </Button>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">템플릿</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            새 문서를 만들 때 고를 수 있는 양식입니다. 문서 편집 화면의 "템플릿으로 저장"으로 추가합니다.
          </p>
        </div>
        {templates.length === 0 ? (
          <p className="p-5 text-xs text-muted-foreground">등록된 템플릿이 없습니다.</p>
        ) : (
          <ul className="divide-y">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-center gap-3 px-5 py-2.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{tpl.name}</div>
                  {tpl.description && (
                    <div className="text-2xs text-muted-foreground truncate">{tpl.description}</div>
                  )}
                </div>
                <span className="text-2xs text-muted-foreground shrink-0">
                  {tpl.scope === "space" ? "이 스페이스 전용" : "워크스페이스 공유"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
