/**
 * 문서 탐색기 — 윈도우 탐색기 스타일 파일/폴더 관리.
 * 그리드/목록 전환, 드래그앤드롭 이동, 우클릭 컨텍스트 메뉴.
 */

import { useState, useMemo } from "react";
import { useParams, useNavigate, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  FileText, FolderOpen, LayoutGrid, List, ArrowLeft,
  MoreHorizontal, Pencil, Trash2, FolderInput, FilePlus, FolderPlus,
  ChevronRight,
} from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Document as DocType } from "@/types";

interface LayoutContext {
  activeSpaceId: string;
  invalidate: () => void;
}

type ViewMode = "grid" | "list";

export default function DocumentExplorerPage() {
  const { t } = useTranslation();
  const { workspaceSlug, spaceId } = useParams<{ workspaceSlug: string; spaceId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ctx = useOutletContext<LayoutContext | undefined>();

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string | null; title: string }[]>([
    { id: null, title: t("documents.title") },
  ]);

  const { data: allDocs = [] } = useQuery({
    queryKey: ["documents", workspaceSlug, spaceId, "all"],
    queryFn: () => documentsApi.list(workspaceSlug!, spaceId!, { all: "true" }),
    enabled: !!workspaceSlug && !!spaceId,
  });

  // 현재 폴더의 하위 항목
  const currentItems = useMemo(
    () => allDocs.filter((d) => (d.parent ?? null) === currentFolder),
    [allDocs, currentFolder],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["documents", workspaceSlug, spaceId] });
    ctx?.invalidate();
  };

  const createMutation = useMutation({
    mutationFn: (data: Partial<DocType>) =>
      documentsApi.create(workspaceSlug!, spaceId!, { ...data, parent: currentFolder }),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(workspaceSlug!, spaceId!, id),
    onSuccess: () => { invalidate(); toast.success(t("documents.deleted")); },
  });

  const openFolder = (doc: DocType) => {
    setCurrentFolder(doc.id);
    setBreadcrumb((prev) => [...prev, { id: doc.id, title: doc.title }]);
  };

  const navigateBreadcrumb = (index: number) => {
    const item = breadcrumb[index];
    setCurrentFolder(item.id);
    setBreadcrumb(breadcrumb.slice(0, index + 1));
  };

  const openDoc = (doc: DocType) => {
    if (doc.is_folder) {
      openFolder(doc);
    } else {
      navigate(`/${workspaceSlug}/documents/space/${spaceId}/${doc.id}`);
    }
  };

  const fmtDate = (d: string) => new Date(d).toLocaleDateString();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0" data-print-hide>
        {/* 뒤로 (에디터 모드로) */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}`)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("documents.backToEditor")}
        </Button>

        <div className="w-px h-5 bg-border" />

        {/* 브레드크럼 */}
        <div className="flex items-center gap-1 text-sm flex-1 min-w-0 overflow-hidden">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <button
                onClick={() => navigateBreadcrumb(i)}
                className={cn(
                  "text-xs truncate max-w-[120px]",
                  i === breadcrumb.length - 1 ? "font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {b.title}
              </button>
            </span>
          ))}
        </div>

        {/* 생성 + 뷰 전환 */}
        <Button variant="ghost" size="icon" className="h-8 w-8"
          onClick={() => createMutation.mutate({ title: t("documents.untitled") })}
        >
          <FilePlus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8"
          onClick={() => createMutation.mutate({ title: t("documents.newFolder"), is_folder: true })}
        >
          <FolderPlus className="h-4 w-4" />
        </Button>

        <div className="w-px h-5 bg-border" />

        <Button
          variant={viewMode === "grid" ? "secondary" : "ghost"}
          size="icon" className="h-8 w-8"
          onClick={() => setViewMode("grid")}
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        <Button
          variant={viewMode === "list" ? "secondary" : "ghost"}
          size="icon" className="h-8 w-8"
          onClick={() => setViewMode("list")}
        >
          <List className="h-4 w-4" />
        </Button>
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto p-4">
        {currentItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            <FolderOpen className="h-10 w-10 opacity-20" />
            <p className="text-sm">{t("documents.emptyFolder")}</p>
          </div>
        ) : viewMode === "grid" ? (
          /* 그리드 뷰 */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {currentItems.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-col items-center p-4 rounded-xl border bg-card hover:bg-accent/50 cursor-pointer transition-all group relative"
                onDoubleClick={() => openDoc(doc)}
                onClick={() => openDoc(doc)}
              >
                {doc.is_folder
                  ? <FolderOpen className="h-10 w-10 text-amber-500 mb-2" />
                  : <FileText className="h-10 w-10 text-muted-foreground mb-2" />
                }
                <span className="text-xs font-medium text-center truncate w-full">{doc.title}</span>
                <span className="text-2xs text-muted-foreground mt-0.5">{fmtDate(doc.updated_at)}</span>

                {/* 컨텍스트 메뉴 */}
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ItemMenu doc={doc} onDelete={() => {
                    if (window.confirm(t("documents.deleteConfirm"))) deleteMutation.mutate(doc.id);
                  }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* 목록 뷰 */
          <div className="rounded-xl border overflow-hidden">
            <div className="flex items-center gap-4 px-4 py-2 border-b bg-muted/20 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <span className="flex-1">{t("documents.name")}</span>
              <span className="w-28 text-center">{t("documents.modified")}</span>
              <span className="w-20" />
            </div>
            {currentItems.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-4 px-4 py-2.5 border-b last:border-0 hover:bg-accent/30 cursor-pointer transition-colors"
                onClick={() => openDoc(doc)}
              >
                {doc.is_folder
                  ? <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                  : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <span className="flex-1 text-sm truncate">{doc.title}</span>
                <span className="w-28 text-center text-xs text-muted-foreground">{fmtDate(doc.updated_at)}</span>
                <div className="w-20 flex justify-end">
                  <ItemMenu doc={doc} onDelete={() => {
                    if (window.confirm(t("documents.deleteConfirm"))) deleteMutation.mutate(doc.id);
                  }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ItemMenu({ onDelete }: { doc: DocType; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="p-1 rounded-md hover:bg-accent" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem>
          <Pencil className="h-3.5 w-3.5 mr-2" /> {t("documents.rename")}
        </DropdownMenuItem>
        <DropdownMenuItem>
          <FolderInput className="h-3.5 w-3.5 mr-2" /> {t("documents.moveTo")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5 mr-2" /> {t("documents.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
