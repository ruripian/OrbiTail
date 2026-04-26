import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { issuesApi } from "@/api/issues";
import type { IssueTemplate } from "@/types";

/**
 * PASS4-3bis — Templates contextual 관리 다이얼로그.
 *
 * TemplatesPage 를 대체. TemplatePicker 안의 "관리" 링크에서 열린다.
 * CRUD 한 화면 — 좌측 list + 우측 form. 새로 만들기 / 편집 / 삭제 모두.
 */
interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceSlug: string;
  projectId: string;
}

interface FormState {
  name: string;
  title_template: string;
  description_html: string;
  priority: "none" | "urgent" | "high" | "medium" | "low";
}

const EMPTY_FORM: FormState = {
  name: "",
  title_template: "",
  description_html: "",
  priority: "none",
};

export function TemplateManageDialog({ open, onOpenChange, workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data: templates = [] } = useQuery({
    queryKey: ["templates", workspaceSlug, projectId],
    queryFn: () => issuesApi.templates.list(workspaceSlug, projectId),
    enabled: open,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["templates", workspaceSlug, projectId] });

  const createMutation = useMutation({
    mutationFn: () => issuesApi.templates.create(workspaceSlug, projectId, form),
    onSuccess: () => {
      invalidate();
      toast.success(t("issues.templates.saved"));
      setForm(EMPTY_FORM);
      setEditingId(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => issuesApi.templates.update(workspaceSlug, projectId, editingId!, form),
    onSuccess: () => {
      invalidate();
      toast.success(t("issues.templates.saved"));
      setEditingId(null);
      setForm(EMPTY_FORM);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => issuesApi.templates.delete(workspaceSlug, projectId, id),
    onSuccess: () => {
      invalidate();
      toast.success(t("issues.templates.deleted"));
      if (editingId) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
    },
  });

  const startEdit = (tmpl: IssueTemplate) => {
    setEditingId(tmpl.id);
    setForm({
      name: tmpl.name,
      title_template: tmpl.title_template ?? "",
      description_html: tmpl.description_html ?? "",
      priority: (tmpl.priority ?? "none") as FormState["priority"],
    });
  };

  const startNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const submit = () => {
    if (!form.name.trim()) return;
    if (editingId) updateMutation.mutate();
    else createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("issues.templates.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[220px_1fr] gap-4 min-h-[420px]">
          {/* 좌측 리스트 */}
          <aside className="border-r border-border pr-3 space-y-1 overflow-y-auto max-h-[480px]">
            <button
              type="button"
              onClick={startNew}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("issues.templates.create")}
            </button>
            {templates.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{t("issues.templates.empty")}</p>
            ) : (
              templates.map((tmpl: IssueTemplate) => {
                const active = editingId === tmpl.id;
                return (
                  <div
                    key={tmpl.id}
                    className={`group flex items-center gap-1 px-1 rounded-md ${active ? "bg-accent" : "hover:bg-accent/50"}`}
                  >
                    <button
                      type="button"
                      onClick={() => startEdit(tmpl)}
                      className="flex-1 flex items-center gap-2 px-1.5 py-1.5 text-xs text-left min-w-0"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{tmpl.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t("issues.templates.deleteConfirm"))) deleteMutation.mutate(tmpl.id);
                      }}
                      className="p-1 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })
            )}
          </aside>

          {/* 우측 폼 */}
          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="space-y-1">
              <Label>{t("issues.templates.name")}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("issues.templates.namePlaceholder")}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>{t("issues.templates.titleTemplate")}</Label>
              <Input
                value={form.title_template}
                onChange={(e) => setForm({ ...form, title_template: e.target.value })}
                placeholder={t("issues.templates.titleTemplatePlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("issues.templates.description")}</Label>
              <textarea
                rows={5}
                value={form.description_html}
                onChange={(e) => setForm({ ...form, description_html: e.target.value })}
                placeholder={t("issues.templates.descriptionPlaceholder")}
                className="flex w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("issues.templates.priority")}</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as FormState["priority"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("issues.priority.none")}</SelectItem>
                  <SelectItem value="urgent">{t("issues.priority.urgent")}</SelectItem>
                  <SelectItem value="high">{t("issues.priority.high")}</SelectItem>
                  <SelectItem value="medium">{t("issues.priority.medium")}</SelectItem>
                  <SelectItem value="low">{t("issues.priority.low")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                <X className="h-3.5 w-3.5" />
                {t("issues.create.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={!form.name.trim() || createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending)
                  ? t("issues.templates.saving")
                  : t("issues.templates.save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
