import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, X, FileText, Image as ImageIcon, ChevronRight, ChevronDown, Layers, Download } from "lucide-react";
import { issuesApi, type AttachmentTreeNode } from "@/api/issues";
import { formatLongDate } from "@/utils/date-format";
import { cn } from "@/lib/utils";
import type { IssueAttachment } from "@/types";

/** PASS5-D — Attachments tab. upload/delete mutation 자체 소유. formatFileSize 도 함께 이동. */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 강제 다운로드 — nginx Content-Disposition 이 inline 인 이미지/PDF 도 fetch+blob 으로 받아서 저장. */
async function downloadFile(url: string, filename: string) {
  try {
    const r = await fetch(url, { credentials: "include" });
    const blob = await r.blob();
    const a = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank");
  }
}

interface Props {
  workspaceSlug: string;
  projectId: string;
  projectIdentifier?: string;
  issueId: string;
  attachments: IssueAttachment[];
  readOnly: boolean;
}

export function AttachmentsTab({ workspaceSlug, projectId, projectIdentifier, issueId, attachments, readOnly }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [includeSubs, setIncludeSubs] = useState(false);

  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ["attachments-tree", workspaceSlug, projectId, issueId],
    queryFn: () => issuesApi.attachments.tree(workspaceSlug, projectId, issueId),
    enabled: includeSubs,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => issuesApi.attachments.upload(workspaceSlug, projectId, issueId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments", issueId] });
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.attachmentUploadFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => issuesApi.attachments.delete(workspaceSlug, projectId, issueId, attachmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments", issueId] });
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
    },
    onError: () => toast.error(t("issues.detail.toast.attachmentDeleteFailed")),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => uploadMutation.mutate(file));
    e.target.value = ""; // 같은 파일 재업로드 허용
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setIncludeSubs((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 text-2xs px-2 py-1 rounded-md border transition-colors",
            includeSubs
              ? "bg-primary/10 text-primary border-primary/30"
              : "text-muted-foreground border-border hover:bg-muted/40 hover:text-foreground"
          )}
        >
          <Layers className="h-3 w-3" />
          {t("issues.detail.attachments.includeSubs")}
        </button>
      </div>

      {includeSubs ? (
        treeLoading ? (
          <p className="text-xs text-muted-foreground py-2">…</p>
        ) : tree ? (
          <AttachmentTreeView
            node={tree}
            depth={0}
            isRoot
            projectIdentifier={projectIdentifier}
            onDelete={(id) => deleteMutation.mutate(id)}
            readOnly={readOnly}
          />
        ) : null
      ) : (
        <>
      {attachments.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">{t("issues.detail.attachments.empty")}</p>
      )}

      {attachments.map((att) => {
        const isImage = att.mime_type.startsWith("image/");
        return (
          <div
            key={att.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded-md border hover:bg-muted/20 transition-colors group"
          >
            {isImage ? (
              <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <a
                href={att.file}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary hover:underline truncate block"
                onClick={(e) => e.stopPropagation()}
              >
                {att.filename}
              </a>
              <p className="text-2xs text-muted-foreground">
                {formatFileSize(att.size)} · {att.uploaded_by_detail?.display_name} · {formatLongDate(att.created_at)}
              </p>
            </div>
            {isImage && (
              <a href={att.file} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                <img src={att.file} alt={att.filename} className="h-10 w-10 rounded object-cover border shrink-0" />
              </a>
            )}
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => downloadFile(att.file, att.filename)}
              title={t("issues.detail.attachments.download")}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            {!readOnly && (
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => deleteMutation.mutate(att.id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 cursor-pointer">
          <Upload className="h-3.5 w-3.5" />
          {uploadMutation.isPending ? t("issues.detail.attachments.uploading") : t("issues.detail.attachments.upload")}
          <input
            type="file"
            multiple
            className="hidden"
            onChange={handleFileUpload}
            disabled={uploadMutation.isPending}
          />
        </label>
      )}
        </>
      )}
    </div>
  );
}

/* ── 첨부 트리 뷰 ── */
interface TreeProps {
  node: AttachmentTreeNode;
  depth: number;
  isRoot?: boolean;
  projectIdentifier?: string;
  onDelete: (attachmentId: string) => void;
  readOnly: boolean;
}

function AttachmentTreeView({ node, depth, isRoot, projectIdentifier, onDelete, readOnly }: TreeProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const hasContent = node.attachments.length > 0 || node.children.length > 0;
  const ref = projectIdentifier ? `${projectIdentifier}-${node.sequence_id}` : `#${node.sequence_id}`;

  if (isRoot && !hasContent) {
    return <p className="text-xs text-muted-foreground py-2">{t("issues.detail.attachments.empty")}</p>;
  }

  return (
    <div className={cn(!isRoot && "border-l border-border pl-3 ml-1")} style={{ marginLeft: depth > 0 ? 4 : 0 }}>
      {!isRoot && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1 transition-colors w-full text-left"
        >
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="font-mono shrink-0">{ref}</span>
          <span className="truncate">{node.title}</span>
          <span className="text-2xs text-muted-foreground/70 shrink-0">
            {node.attachments.length > 0 ? `· ${node.attachments.length}` : ""}
          </span>
        </button>
      )}

      {open && (
        <div className="space-y-1.5">
          {node.attachments.map((att) => {
            const isImage = att.mime_type.startsWith("image/");
            return (
              <div
                key={att.id}
                className="flex items-center gap-3 px-3 py-2 rounded-md border hover:bg-muted/20 transition-colors group"
              >
                {isImage ? (
                  <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <a
                    href={att.file}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-primary hover:underline truncate block"
                  >
                    {att.filename}
                  </a>
                  <p className="text-2xs text-muted-foreground">
                    {formatFileSize(att.size)} · {att.uploaded_by_detail?.display_name} · {formatLongDate(att.created_at)}
                  </p>
                </div>
                {isImage && (
                  <a href={att.file} target="_blank" rel="noopener noreferrer">
                    <img src={att.file} alt={att.filename} className="h-9 w-9 rounded object-cover border shrink-0" />
                  </a>
                )}
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => downloadFile(att.file, att.filename)}
                  title={t("issues.detail.attachments.download")}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                {!readOnly && (
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => onDelete(att.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}

          {node.children.map((child) => (
            <AttachmentTreeView
              key={child.id}
              node={child}
              depth={depth + 1}
              projectIdentifier={projectIdentifier}
              onDelete={onDelete}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}
