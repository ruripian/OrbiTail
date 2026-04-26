import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, X, FileText, Image as ImageIcon } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { formatLongDate } from "@/utils/date-format";
import type { IssueAttachment } from "@/types";

/** PASS5-D — Attachments tab. upload/delete mutation 자체 소유. formatFileSize 도 함께 이동. */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  attachments: IssueAttachment[];
  readOnly: boolean;
}

export function AttachmentsTab({ workspaceSlug, projectId, issueId, attachments, readOnly }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();

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
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => deleteMutation.mutate(att.id)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
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
    </div>
  );
}
