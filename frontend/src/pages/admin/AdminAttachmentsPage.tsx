/**
 * 첨부파일 검색 — 워크스페이스 전체 첨부파일 파일명 검색.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Paperclip, Loader2, ExternalLink, Download } from "lucide-react";
import { api } from "@/lib/axios";

interface AttachmentResult {
  id: string;
  filename: string;
  file_size: number;
  content_type: string | null;
  file_url: string | null;
  document_id: string;
  document_title: string;
  space_id: string;
  space_name: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function AdminAttachmentsPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["attachment-search", workspaceSlug, debounced],
    queryFn: () =>
      api.get<AttachmentResult[]>(`/workspaces/${workspaceSlug}/documents/admin/attachments/`, {
        params: debounced ? { q: debounced } : undefined,
      }).then((r) => r.data),
    enabled: !!workspaceSlug,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">첨부파일 검색</h1>
        <p className="text-sm text-muted-foreground mt-1">
          워크스페이스 전체에서 파일명으로 첨부를 찾습니다. (최근 200개까지)
        </p>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="파일명으로 검색 (비워두면 최근 첨부)"
          className="flex-1 bg-transparent outline-none text-sm"
        />
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {results.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            <Paperclip className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            결과 없음
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground bg-muted/30">
                <th className="px-3 py-2 text-left">파일명</th>
                <th className="px-3 py-2 text-left">문서 / 스페이스</th>
                <th className="px-3 py-2 text-right">크기</th>
                <th className="px-3 py-2 text-left">업로더</th>
                <th className="px-3 py-2 text-left">업로드</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {results.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <Paperclip className="h-3 w-3 text-muted-foreground" />
                      <span className="truncate max-w-[280px]" title={a.filename}>{a.filename}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => navigate(`/${workspaceSlug}/documents/space/${a.space_id}/${a.document_id}`)}
                      className="text-left text-xs hover:text-primary"
                    >
                      <div className="truncate max-w-[280px]">{a.document_title}</div>
                      <div className="text-2xs text-muted-foreground truncate">{a.space_name}</div>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-right text-2xs tabular-nums text-muted-foreground">
                    {fmtSize(a.file_size)}
                  </td>
                  <td className="px-3 py-2.5 text-2xs text-muted-foreground">
                    {a.uploaded_by || "-"}
                  </td>
                  <td className="px-3 py-2.5 text-2xs text-muted-foreground tabular-nums">
                    {new Date(a.uploaded_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {a.file_url && (
                        <a
                          href={a.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                          title="다운로드"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        onClick={() => navigate(`/${workspaceSlug}/documents/space/${a.space_id}/${a.document_id}`)}
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                        title="문서 열기"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
