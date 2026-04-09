import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Layers, Trash2, Settings, GripVertical } from "lucide-react";
import { projectsApi } from "@/api/projects";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectIconPicker, ProjectIcon, type IconProp } from "@/components/ui/project-icon-picker";
import type { Category } from "@/types";

/* 카테고리 = 거대 분류(백엔드/프론트엔드/DB 등). 단순한 이름·설명만 유지.
   상태/일정은 Sprint(스프린트)에서 관리하므로 여기선 제거. */
const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function CategoriesPage() {
  const { workspaceSlug, projectId } = useParams<{
    workspaceSlug: string;
    projectId: string;
  }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  /* 아이콘 선택 — ProjectIconPicker는 Zod 바깥의 controlled state로 관리 */
  const [iconProp, setIconProp] = useState<IconProp | null>(null);

  /* 편집 다이얼로그 상태 */
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [editIconProp, setEditIconProp] = useState<IconProp | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories", workspaceSlug, projectId],
    queryFn: () => projectsApi.categories.list(workspaceSlug!, projectId!),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const {
    register: editRegister,
    handleSubmit: editHandleSubmit,
    reset: editReset,
    formState: { errors: editErrors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  /* 편집 다이얼로그 열릴 때 폼 초기화 */
  useEffect(() => {
    if (editCategory) {
      editReset({ name: editCategory.name, description: editCategory.description ?? "" });
      setEditIconProp(editCategory.icon_prop as unknown as IconProp | null);
    }
  }, [editCategory, editReset]);

  const createMutation = useMutation({
    mutationFn: (data: FormValues) => {
      /* status는 백엔드 기본값 "backlog" 사용, 날짜는 전송하지 않음
         iconProp: 사용자가 선택했으면 함께 전송, 안 했으면 null → 백엔드에서 기본 아이콘 */
      return projectsApi.categories.create(workspaceSlug!, projectId!, {
        ...data,
        icon_prop: iconProp as unknown as Record<string, unknown> | null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories", workspaceSlug, projectId] });
      reset();
      setIconProp(null);
      setCreateOpen(false);
    },
    onError: () => toast.error(t("modules.createFailed")),
  });

  const updateMutation = useMutation({
    mutationFn: (data: FormValues) => {
      if (!editCategory) throw new Error("No category selected");
      return projectsApi.categories.update(workspaceSlug!, projectId!, editCategory.id, {
        ...data,
        icon_prop: editIconProp as unknown as Record<string, unknown> | null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories", workspaceSlug, projectId] });
      toast.success(t("modules.updated"));
      setEditCategory(null);
    },
    onError: () => toast.error(t("modules.updateFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (categoryId: string) => projectsApi.categories.delete(workspaceSlug!, projectId!, categoryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories", workspaceSlug, projectId] });
      toast.success(t("modules.deleted"));
    },
    onError: () => toast.error(t("modules.deleteFailed")),
  });

  /* ── 카테고리 DnD 순서 변경 ── */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => projectsApi.categories.reorder(workspaceSlug!, projectId!, order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories", workspaceSlug, projectId] }),
  });

  const handleCategoryDrop = (targetId: string) => {
    const currentDragId = dragIdRef.current;
    if (!currentDragId || currentDragId === targetId) { setDragId(null); setDragOverId(null); dragIdRef.current = null; return; }
    const ids = categories.map((c: Category) => c.id);
    const fromIdx = ids.indexOf(currentDragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { setDragId(null); setDragOverId(null); dragIdRef.current = null; return; }
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, currentDragId);
    reorderMutation.mutate(ids);
    setDragId(null);
    setDragOverId(null);
    dragIdRef.current = null;
  };

  const handleDelete = (e: React.MouseEvent, categoryId: string) => {
    e.stopPropagation();
    if (window.confirm(t("modules.deleteConfirm"))) {
      deleteMutation.mutate(categoryId);
    }
  };

  const handleEdit = (e: React.MouseEvent, cat: Category) => {
    e.stopPropagation();
    setEditCategory(cat);
  };

  // 카테고리 클릭 → 카테고리 전용 이슈 뷰로 이동
  const handleCategoryClick = (cat: Category) => {
    navigate(`/${workspaceSlug}/projects/${projectId}/categories/${cat.id}/issues`);
  };

  return (
    <div className="p-6 space-y-6 relative">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{t("modules.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("modules.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          {t("modules.create")}
        </Button>
      </div>

      {/* 카테고리 목록 */}
      {categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Layers className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">{t("modules.empty")}</p>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {categories.map((cat: Category) => (
            <div
              key={cat.id}
              draggable
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; dragIdRef.current = cat.id; setDragId(cat.id); }}
              onDragOver={(e) => { e.preventDefault(); setDragOverId(cat.id); }}
              onDragEnd={() => { dragIdRef.current = null; setDragId(null); setDragOverId(null); }}
              onDrop={(e) => { e.preventDefault(); handleCategoryDrop(cat.id); }}
              onClick={() => handleCategoryClick(cat)}
              className={cn(
                "group flex items-center gap-4 rounded-xl border glass p-4 hover:bg-accent/50 cursor-pointer transition-all",
                dragOverId === cat.id && dragId !== cat.id && "ring-2 ring-primary/40",
                dragId === cat.id && "opacity-50",
              )}
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors cursor-grab" />
              <ProjectIcon value={cat.icon_prop} size={20} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{cat.name}</p>
                {cat.description && (
                  <p className="text-xs text-muted-foreground truncate">{cat.description}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {t("modules.issueCount", { count: cat.issue_count })}
              </span>
              <button
                onClick={(e) => handleEdit(e, cat)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                title={t("modules.editTitle")}
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => handleDelete(e, cat.id)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                title={t("modules.delete")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 카테고리 생성 다이얼로그 */}
      <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("modules.createTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
            {/* 아이콘 선택 + 이름 */}
            <div className="space-y-1.5">
              <Label>{t("modules.name")}</Label>
              <div className="flex items-center gap-3">
                <ProjectIconPicker value={iconProp as unknown as Record<string, unknown> | null} onChange={setIconProp} size="lg" />
                <Input placeholder={t("modules.namePlaceholder")} {...register("name")} autoFocus className="h-10 flex-1" />
              </div>
              {errors.name && <p className="text-xs text-destructive">{t("modules.nameRequired")}</p>}
            </div>

            <div className="space-y-1">
              <Label>{t("modules.description")}</Label>
              <Input placeholder={t("modules.descriptionPlaceholder")} {...register("description")} />
              <p className="text-2xs text-muted-foreground">{t("modules.categoryHint")}</p>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t("modules.cancel")}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? t("modules.creating") : t("modules.create")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 카테고리 편집 다이얼로그 */}
      <Dialog open={!!editCategory} onOpenChange={(v) => { if (!v) setEditCategory(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("modules.editTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={editHandleSubmit((d) => updateMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("modules.name")}</Label>
              <div className="flex items-center gap-3">
                <ProjectIconPicker value={editIconProp as unknown as Record<string, unknown> | null} onChange={setEditIconProp} size="lg" />
                <Input placeholder={t("modules.namePlaceholder")} {...editRegister("name")} autoFocus className="h-10 flex-1" />
              </div>
              {editErrors.name && <p className="text-xs text-destructive">{t("modules.nameRequired")}</p>}
            </div>

            <div className="space-y-1">
              <Label>{t("modules.description")}</Label>
              <Input placeholder={t("modules.descriptionPlaceholder")} {...editRegister("description")} />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditCategory(null)}>
                {t("modules.cancel")}
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("modules.saving") : t("modules.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
