/**
 * 공개 공유 문서 뷰어 — /s/:token 경로, 인증 불필요.
 * 토큰이 유효하면 title + cover + content_html 읽기 전용 렌더.
 */

import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { documentsApi } from "@/api/documents";

export default function PublicDocumentPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-doc", token],
    queryFn: () => documentsApi.public(token!),
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-screen px-6">
        <div className="text-center max-w-md">
          <p className="text-5xl mb-3">🔒</p>
          <h1 className="text-2xl font-semibold mb-1">공유 링크를 사용할 수 없습니다</h1>
          <p className="text-sm text-muted-foreground">
            링크가 만료되었거나, 공유가 해제되었거나, 존재하지 않는 문서일 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-[860px] mx-auto py-8 px-4 sm:px-6">
        <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
          {data.cover_image_url && (
            <div
              className="h-40 sm:h-52 bg-muted"
              style={{
                backgroundImage: `url(${data.cover_image_url})`,
                backgroundSize: "cover",
                backgroundPosition: `center ${data.cover_offset_y ?? 50}%`,
              }}
            />
          )}
          <div className="px-6 sm:px-10 py-8">
            <h1 className="text-4xl font-bold mb-4">{data.title}</h1>
            <div className="h-px bg-border/40 mb-6" />
            <article
              className="doc-editor prose prose-sm sm:prose-base max-w-none"
              dangerouslySetInnerHTML={{ __html: data.content_html }}
            />
          </div>
        </div>
        <p className="text-2xs text-muted-foreground text-center mt-4">
          읽기 전용 공개 링크 · 최종 수정 {new Date(data.updated_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
