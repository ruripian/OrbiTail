import { api } from "@/lib/axios";
import type { DocumentSpace, DocumentSpaceMember, DocumentSpaceRole, DocumentLabel, TrashedDocument, Document, DocumentIssueLink, DocumentComment, DocumentVersion, CommentThread, DocumentTemplate, DocumentAttachment } from "@/types";

/** 스페이스 조회 통계 — 개인 이력은 내보내지 않고 집계만 */
export interface SpaceAnalytics {
  days: number;
  total_views: number;
  unique_viewers: number;
  top_documents: { id: string; title: string; views: number; viewers: number }[];
}

export const documentsApi = {
  /* ─── 스페이스 ─── */
  spaces: {
    list: (workspaceSlug: string) =>
      api.get<DocumentSpace[]>(`/workspaces/${workspaceSlug}/documents/spaces/`).then((r) => r.data),

    /** 탐색 — 본인이 아직 멤버가 아닌 공개 공용 스페이스 */
    discoverable: (workspaceSlug: string) =>
      api.get<DocumentSpace[]>(`/workspaces/${workspaceSlug}/documents/spaces/discoverable/`).then((r) => r.data),

    /** 공개 공용 스페이스 자가 가입 */
    join: (workspaceSlug: string, spaceId: string) =>
      api.post<DocumentSpace>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/join/`).then((r) => r.data),

    create: (
      workspaceSlug: string,
      data: {
        name: string;
        icon?: string;
        identifier?: string;
        description?: string;
        members?: string[];
        is_private?: boolean;
      },
    ) =>
      api.post<DocumentSpace>(`/workspaces/${workspaceSlug}/documents/spaces/`, data).then((r) => r.data),

    update: (workspaceSlug: string, spaceId: string, data: Partial<DocumentSpace>) =>
      api.patch<DocumentSpace>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/`, data).then((r) => r.data),

    delete: (workspaceSlug: string, spaceId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/`),

    /* 멤버 — 역할(뷰어/편집자/관리자)까지 다루는 전용 엔드포인트 */
    members: {
      list: (workspaceSlug: string, spaceId: string) =>
        api.get<DocumentSpaceMember[]>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/members/`).then((r) => r.data),

      add: (workspaceSlug: string, spaceId: string, memberId: string, role: DocumentSpaceRole) =>
        api.post<DocumentSpaceMember>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/members/`, { member: memberId, role }).then((r) => r.data),

      setRole: (workspaceSlug: string, spaceId: string, memberId: string, role: DocumentSpaceRole) =>
        api.patch<DocumentSpaceMember>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/members/${memberId}/`, { role }).then((r) => r.data),

      remove: (workspaceSlug: string, spaceId: string, memberId: string) =>
        api.delete(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/members/${memberId}/`),
    },

    /* 휴지통 — 소프트 삭제된 문서 */
    trash: {
      list: (workspaceSlug: string, spaceId: string) =>
        api.get<TrashedDocument[]>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/trash/`).then((r) => r.data),

      /** 미리보기 — 본문 포함 단건. 삭제된 문서는 일반 상세 API 로 열 수 없다. */
      get: (workspaceSlug: string, spaceId: string, docId: string) =>
        api.get<TrashedDocument>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/trash/${docId}/`).then((r) => r.data),

      restore: (workspaceSlug: string, spaceId: string, ids: string[]) =>
        api.post<{ restored: number }>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/trash/`, { ids }).then((r) => r.data),

      /** ids 를 비우면 휴지통 전체 비우기 */
      purge: (workspaceSlug: string, spaceId: string, ids?: string[]) =>
        api.delete<{ deleted: number }>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/trash/`, { data: { ids } }).then((r) => r.data),
    },

    /** 스페이스 전체를 zip 으로 — 응답이 바이너리라 blob 으로 받는다 */
    exportZip: (workspaceSlug: string, spaceId: string) =>
      api.get<Blob>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/export/`, { responseType: "blob" }).then((r) => r.data),

    analytics: (workspaceSlug: string, spaceId: string, days = 30) =>
      api.get<SpaceAnalytics>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/analytics/`, { params: { days } }).then((r) => r.data),
  },

  /* ─── 라벨 (워크스페이스 단위) ─── */
  labels: {
    list: (workspaceSlug: string) =>
      api.get<DocumentLabel[]>(`/workspaces/${workspaceSlug}/documents/labels/`).then((r) => r.data),

    /** 같은 이름이 이미 있으면 서버가 기존 라벨을 그대로 돌려준다 */
    create: (workspaceSlug: string, data: { name: string; color?: string }) =>
      api.post<DocumentLabel>(`/workspaces/${workspaceSlug}/documents/labels/`, data).then((r) => r.data),

    update: (workspaceSlug: string, id: string, data: { name?: string; color?: string }) =>
      api.patch<DocumentLabel>(`/workspaces/${workspaceSlug}/documents/labels/${id}/`, data).then((r) => r.data),

    delete: (workspaceSlug: string, id: string) =>
      api.delete(`/workspaces/${workspaceSlug}/documents/labels/${id}/`),
  },

  /* ─── 문서 ─── */
  list: (workspaceSlug: string, spaceId: string, params?: { parent?: string; all?: string }) =>
    api.get<Document[]>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/`, { params }).then((r) => r.data),

  get: (workspaceSlug: string, spaceId: string, docId: string) =>
    api.get<Document>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/`).then((r) => r.data),

  create: (workspaceSlug: string, spaceId: string, data: Partial<Document>) =>
    api.post<Document>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/`, data).then((r) => r.data),

  update: (workspaceSlug: string, spaceId: string, docId: string, data: Partial<Document>) =>
    api.patch<Document>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/`, data).then((r) => r.data),

  /** 커버 이미지 업로드 (multipart) — file을 다른 PATCH 필드와 분리해 보냄.
      file=null이면 커버 제거. offset만 바꾸려면 update()에 cover_offset_y. */
  uploadCover: (workspaceSlug: string, spaceId: string, docId: string, file: File | null) => {
    const fd = new FormData();
    if (file) fd.append("cover_image", file);
    else fd.append("cover_image", "");
    return api.patch<Document>(
      `/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    ).then((r) => r.data);
  },

  /** 커버 + zoom/offset 메타를 한 번에 보냄 (CoverEditDialog 저장 경로) */
  uploadCoverWithMeta: (workspaceSlug: string, spaceId: string, docId: string, fd: FormData) =>
    api.patch<Document>(
      `/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    ).then((r) => r.data),

  delete: (workspaceSlug: string, spaceId: string, docId: string) =>
    api.delete(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/`),

  move: (workspaceSlug: string, spaceId: string, docId: string, data: { parent?: string | null; sort_order?: number }) =>
    api.post<Document>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/move/`, data).then((r) => r.data),

  /** 여러 문서를 한 폴더로 — 순환 검사를 모두 통과해야 저장된다(부분 적용 없음) */
  bulkMove: (workspaceSlug: string, spaceId: string, ids: string[], parent: string | null) =>
    api.post<{ moved: number }>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/bulk-move/`, { ids, parent }).then((r) => r.data),

  /* ─── 이슈 연결 ─── */
  issues: {
    list: (workspaceSlug: string, spaceId: string, docId: string) =>
      api.get<DocumentIssueLink[]>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/issues/`).then((r) => r.data),

    link: (workspaceSlug: string, spaceId: string, docId: string, issueId: string) =>
      api.post<DocumentIssueLink>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/issues/`, { issue: issueId }).then((r) => r.data),

    unlink: (workspaceSlug: string, spaceId: string, docId: string, issueId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/issues/${issueId}/`),
  },

  /* ─── 검색 ─── */
  search: (workspaceSlug: string, q: string) =>
    api.get<Document[]>(`/workspaces/${workspaceSlug}/documents/search/`, { params: { q } }).then((r) => r.data),

  /* ─── 탐색 탭 + 즐겨찾기 ─── */
  mine: (workspaceSlug: string) =>
    api.get<Document[]>(`/workspaces/${workspaceSlug}/documents/mine/`).then((r) => r.data),
  recent: (workspaceSlug: string) =>
    api.get<Document[]>(`/workspaces/${workspaceSlug}/documents/recent/`).then((r) => r.data),
  bookmarks: {
    list: (workspaceSlug: string) =>
      api.get<Document[]>(`/workspaces/${workspaceSlug}/documents/bookmarks/`).then((r) => r.data),
    add: (workspaceSlug: string, docId: string) =>
      api.post<{ bookmarked: boolean }>(`/workspaces/${workspaceSlug}/documents/bookmarks/${docId}/`).then((r) => r.data),
    remove: (workspaceSlug: string, docId: string) =>
      api.delete<{ bookmarked: boolean }>(`/workspaces/${workspaceSlug}/documents/bookmarks/${docId}/`).then((r) => r.data),
  },

  /** 스페이스 단위 즐겨찾기 — 자주 쓰는 스페이스 핀 */
  spaceBookmarks: {
    list: (workspaceSlug: string) =>
      api.get<DocumentSpace[]>(`/workspaces/${workspaceSlug}/documents/space-bookmarks/`).then((r) => r.data),
    add: (workspaceSlug: string, spaceId: string) =>
      api.post<{ bookmarked: boolean }>(`/workspaces/${workspaceSlug}/documents/space-bookmarks/${spaceId}/`).then((r) => r.data),
    remove: (workspaceSlug: string, spaceId: string) =>
      api.delete<{ bookmarked: boolean }>(`/workspaces/${workspaceSlug}/documents/space-bookmarks/${spaceId}/`).then((r) => r.data),
  },

  /* ─── 첨부파일 ─── */
  attachments: {
    list: (workspaceSlug: string, spaceId: string, docId: string) =>
      api.get<DocumentAttachment[]>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/attachments/`).then((r) => r.data),

    upload: (workspaceSlug: string, spaceId: string, docId: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<DocumentAttachment>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/attachments/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      }).then((r) => r.data);
    },

    delete: (workspaceSlug: string, spaceId: string, docId: string, attachmentId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/attachments/${attachmentId}/`),
  },

  /* ─── 댓글 ─── */
  comments: {
    list: (workspaceSlug: string, spaceId: string, docId: string) =>
      api.get<DocumentComment[]>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/comments/`).then((r) => r.data),

    create: (workspaceSlug: string, spaceId: string, docId: string, content: string) =>
      api.post<DocumentComment>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/comments/`, { content }).then((r) => r.data),

    update: (workspaceSlug: string, spaceId: string, docId: string, commentId: string, content: string) =>
      api.patch<DocumentComment>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/comments/${commentId}/`, { content }).then((r) => r.data),

    delete: (workspaceSlug: string, spaceId: string, docId: string, commentId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/comments/${commentId}/`),
  },

  /* ─── 블록 댓글 스레드 ─── */
  threads: {
    list: (workspaceSlug: string, spaceId: string, docId: string, resolved?: boolean) =>
      api.get<CommentThread[]>(
        `/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/threads/`,
        { params: resolved === undefined ? {} : { resolved: resolved ? "true" : "false" } },
      ).then((r) => r.data),

    create: (workspaceSlug: string, spaceId: string, docId: string, data: { anchor_text: string; initial_content: string }) =>
      api.post<CommentThread>(
        `/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/threads/`,
        data,
      ).then((r) => r.data),

    reply: (workspaceSlug: string, spaceId: string, docId: string, threadId: string, content: string) =>
      api.post<DocumentComment>(
        `/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/threads/${threadId}/reply/`,
        { content },
      ).then((r) => r.data),

    resolve: (workspaceSlug: string, spaceId: string, docId: string, threadId: string) =>
      api.post<CommentThread>(
        `/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/threads/${threadId}/resolve/`,
      ).then((r) => r.data),

    delete: (workspaceSlug: string, spaceId: string, docId: string, threadId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/threads/${threadId}/`),
  },

  /* ─── 공개 공유 링크 ─── */
  share: {
    get: (workspaceSlug: string, spaceId: string, docId: string) =>
      api.get<{ enabled: boolean; token?: string; url?: string; expires_at?: string | null }>(
        `/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/share/`,
      ).then((r) => r.data),
    enable: (workspaceSlug: string, spaceId: string, docId: string, expires_at?: string | null) =>
      api.post<{ enabled: true; token: string; url: string; expires_at: string | null }>(
        `/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/share/`,
        expires_at !== undefined ? { expires_at } : {},
      ).then((r) => r.data),
    disable: (workspaceSlug: string, spaceId: string, docId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/share/`),
  },

  /* ─── 공개 조회 (인증 불필요) ─── */
  public: (token: string) =>
    api.get<{
      id: string; title: string; icon_prop: Record<string, unknown> | null;
      content_html: string; cover_image_url: string | null; cover_offset_y: number;
      updated_at: string;
    }>(`/public/documents/${token}/`).then((r) => r.data),

  /* ─── 템플릿 ─── */
  templates: {
    /** spaceId 를 주면 그 스페이스 전용 템플릿까지 함께 받는다 */
    list: (workspaceSlug: string, scope?: "built_in" | "user" | "workspace" | "space", spaceId?: string) =>
      api.get<DocumentTemplate[]>(
        `/workspaces/${workspaceSlug}/documents/templates/`,
        { params: { ...(scope ? { scope } : {}), ...(spaceId ? { space: spaceId } : {}) } },
      ).then((r) => r.data),

    create: (workspaceSlug: string, data: {
      name: string; description?: string; icon_prop?: Record<string, unknown> | null;
      content_html: string; scope?: "user" | "workspace" | "built_in" | "space";
      space?: string; sort_order?: number;
    }) =>
      api.post<DocumentTemplate>(`/workspaces/${workspaceSlug}/documents/templates/`, data).then((r) => r.data),

    get: (workspaceSlug: string, id: string) =>
      api.get<DocumentTemplate>(`/workspaces/${workspaceSlug}/documents/templates/${id}/`).then((r) => r.data),

    delete: (workspaceSlug: string, id: string) =>
      api.delete(`/workspaces/${workspaceSlug}/documents/templates/${id}/`),
  },

  /* ─── 버전 ─── */
  versions: {
    list: (workspaceSlug: string, spaceId: string, docId: string) =>
      api.get<DocumentVersion[]>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/versions/`).then((r) => r.data),

    create: (workspaceSlug: string, spaceId: string, docId: string) =>
      api.post<DocumentVersion>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/versions/`, {}).then((r) => r.data),

    get: (workspaceSlug: string, spaceId: string, docId: string, versionId: string) =>
      api.get<DocumentVersion>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/versions/${versionId}/`).then((r) => r.data),
  },
};
