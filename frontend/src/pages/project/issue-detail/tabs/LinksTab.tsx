import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Link2, ExternalLink, X } from "lucide-react";
import { issuesApi } from "@/api/issues";
import type { IssueLink } from "@/types";

/** PASS5-D — Links tab (외부 URL 첨부). create/delete mutation 자체 소유. */
interface Props {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  links: IssueLink[];
  readOnly: boolean;
}

export function LinksTab({ workspaceSlug, projectId, issueId, links, readOnly }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", url: "" });

  const createMutation = useMutation({
    mutationFn: () => issuesApi.links.create(workspaceSlug, projectId, issueId, form),
    onSuccess: () => {
      setForm({ title: "", url: "" });
      setAdding(false);
      qc.invalidateQueries({ queryKey: ["links", issueId] });
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.linkCreateFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (linkId: string) => issuesApi.links.delete(workspaceSlug, projectId, issueId, linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["links", issueId] });
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.linkDeleteFailed")),
  });

  return (
    <div className="space-y-3">
      {links.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground py-2">{t("issues.detail.links.empty")}</p>
      )}

      {links.map((link) => (
        <div
          key={link.id}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md border hover:bg-muted/20 transition-colors group"
        >
          <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            {link.title && <p className="text-xs font-medium truncate">{link.title}</p>}
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-primary hover:underline flex items-center gap-1 truncate"
            >
              {link.url}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={() => deleteMutation.mutate(link.id)}
            title={t("common.delete")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {readOnly ? null : adding ? (
        <div className="border rounded-md p-3 space-y-2">
          <input
            className="w-full text-xs bg-transparent border-b border-border outline-none pb-1 placeholder:text-muted-foreground"
            placeholder={t("issues.detail.links.titlePlaceholder")}
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          />
          <input
            className="w-full text-xs bg-transparent border-b border-border outline-none pb-1 placeholder:text-muted-foreground"
            placeholder={t("issues.detail.links.urlPlaceholder")}
            value={form.url}
            onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && form.url.trim()) createMutation.mutate();
              if (e.key === "Escape") { setAdding(false); setForm({ title: "", url: "" }); }
            }}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { setAdding(false); setForm({ title: "", url: "" }); }}
            >
              {t("issues.detail.links.cancel")}
            </button>
            <button
              className="text-xs text-primary hover:underline disabled:opacity-40"
              disabled={!form.url.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {t("issues.detail.links.submit")}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("issues.detail.links.add")}
        </button>
      )}
    </div>
  );
}
