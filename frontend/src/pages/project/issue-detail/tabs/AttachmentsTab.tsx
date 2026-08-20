import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, X, FileText, Image as ImageIcon, ChevronRight, ChevronDown, Layers, Download, MessageSquare } from "lucide-react";
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

/** 첨부 출처 배지 — 댓글 RichEditor 에서 올라온 첨부에만 표시. 직접 업로드는 라벨 없음(노이즈 회피). */
function SourceBadge({ source }: { source?: string }) {
  if (source !== "from_comment") return null;
  return (
    <span
      title="댓글에서 업로드됨"
      className="inline-flex items-center gap-0.5 text-2xs px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0"
    >
      <MessageSquare className="h-2.5 w-2.5" />
      댓글
    </span>
  );
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

  /* 업로드·삭제 후 무효화할 키 묶음.
     트리 쿼리를 빠뜨리면 "하위 이슈 포함" 을 켠 상태에서 지운 파일이 화면에 그대로 남는다. */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["attachments", issueId] });
    qc.invalidateQueries({ queryKey: ["issue", issueId] });
    qc.invalidateQueries({ queryKey: ["attachments-tree", workspaceSlug, projectId, issueId] });
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => issuesApi.attachments.upload(workspaceSlug, projectId, issueId, file),
    onSuccess: invalidate,
    onError: () => toast.error(t("issues.detail.toast.attachmentUploadFailed")),
  });

  /* 삭제는 첨부가 실제로 달린 이슈 id 로 보내야 한다. 백엔드가 issue_pk 로 스코프하므로
     트리에서 하위 이슈의 첨부를 루트 id 로 지우려 하면 404 가 난다. */
  const deleteMutation = useMutation({
    mutationFn: ({ ownerIssueId, attachmentId }: { ownerIssueId: string; attachmentId: string }) =>
      issuesApi.attachments.delete(workspaceSlug, projectId, ownerIssueId, attachmentId),
    onSuccess: invalidate,
    onError: () => toast.error(t("issues.detail.toast.attachmentDeleteFailed")),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => uploadMutation.mutate(file));
    e.target.value = ""; // 같은 파일 재업로드 허용
  };

  /* 드래그앤드롭 업로드.
     dragenter/dragleave 는 자식 요소를 넘나들 때마다 발생하므로, 깊이를 세서
     상쇄하지 않으면 하이라이트가 깜빡인다. */
  const [dragDepth, setDragDepth] = useState(0);
  const isDragOver = dragDepth > 0;

  /* 파일이 아닌 드래그(텍스트·이슈 카드 등)에는 반응하지 않는다 */
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const dropZone = readOnly ? {} : {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragDepth((d) => d + 1);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();                 // 이게 있어야 drop 이 발생한다 (HTML5 DnD 규약)
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => setDragDepth((d) => Math.max(0, d - 1)),
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragDepth(0);
      Array.from(e.dataTransfer.files).forEach((file) => uploadMutation.mutate(file));
    },
  };

  return (
    <div
      {...dropZone}
      className={cn(
        "space-y-3 rounded-lg transition-colors",
        isDragOver && "ring-2 ring-primary/50 bg-primary/[0.04]",
      )}
    >
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
            onDelete={(ownerIssueId, attachmentId) => deleteMutation.mutate({ ownerIssueId, attachmentId })}
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
              <div className="flex items-center gap-1.5 min-w-0">
                <a
                  href={att.file}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-primary hover:underline truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  {att.filename}
                </a>
                <SourceBadge source={att.source} />
              </div>
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
                onClick={() => deleteMutation.mutate({ ownerIssueId: issueId, attachmentId: att.id })}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}

        </>
      )}

      {/* 업로드는 "하위 이슈 포함" 토글과 무관하게 항상 보여야 한다.
          분기 안에 있던 탓에 토글을 켜면 첨부할 방법이 사라졌었다. */}
      {!readOnly && (
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 cursor-pointer">
          <Upload className="h-3.5 w-3.5" />
          {uploadMutation.isPending
            ? t("issues.detail.attachments.uploading")
            : isDragOver
              ? t("issues.detail.attachments.dropHere")
              : t("issues.detail.attachments.upload")}
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

/* ── 첨부 트리 뷰 ── */
interface TreeProps {
  node: AttachmentTreeNode;
  depth: number;
  isRoot?: boolean;
  projectIdentifier?: string;
  /** 첨부가 달린 이슈 id 를 함께 넘긴다 — 하위 이슈 첨부를 루트 id 로 지우면 404 */
  onDelete: (ownerIssueId: string, attachmentId: string) => void;
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
                  <div className="flex items-center gap-1.5 min-w-0">
                    <a
                      href={att.file}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-primary hover:underline truncate"
                    >
                      {att.filename}
                    </a>
                    <SourceBadge source={att.source} />
                  </div>
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
                    onClick={() => onDelete(node.id, att.id)}
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
