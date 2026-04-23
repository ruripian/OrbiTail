import { api } from "@/lib/axios";
import type { DocumentSpace, Document, DocumentIssueLink, DocumentComment, DocumentVersion, CommentThread, DocumentTemplate } from "@/types";

export const documentsApi = {
  /* ─── 스페이스 ─── */
  spaces: {
    list: (workspaceSlug: string) =>
      api.get<DocumentSpace[]>(`/workspaces/${workspaceSlug}/documents/spaces/`).then((r) => r.data),

    create: (
      workspaceSlug: string,
      data: {
        name: string;
        icon?: string;
        identifier?: string;
        description?: string;
        members?: string[];
      },
    ) =>
      api.post<DocumentSpace>(`/workspaces/${workspaceSlug}/documents/spaces/`, data).then((r) => r.data),

    update: (workspaceSlug: string, spaceId: string, data: Partial<DocumentSpace>) =>
      api.patch<DocumentSpace>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/`, data).then((r) => r.data),

    delete: (workspaceSlug: string, spaceId: string) =>
      api.delete(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/`),
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

  delete: (workspaceSlug: string, spaceId: string, docId: string) =>
    api.delete(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/`),

  move: (workspaceSlug: string, spaceId: string, docId: string, data: { parent?: string | null; sort_order?: number }) =>
    api.post<Document>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/move/`, data).then((r) => r.data),

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

  /* ─── 첨부파일 ─── */
  attachments: {
    list: (workspaceSlug: string, spaceId: string, docId: string) =>
      api.get<any[]>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/attachments/`).then((r) => r.data),

    upload: (workspaceSlug: string, spaceId: string, docId: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<any>(`/workspaces/${workspaceSlug}/documents/spaces/${spaceId}/docs/${docId}/attachments/`, fd, {
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

  /* ─── 템플릿 ─── */
  templates: {
    list: (workspaceSlug: string, scope?: "built_in" | "user" | "workspace") =>
      api.get<DocumentTemplate[]>(
        `/workspaces/${workspaceSlug}/documents/templates/`,
        { params: scope ? { scope } : {} },
      ).then((r) => r.data),

    create: (workspaceSlug: string, data: {
      name: string; description?: string; icon_prop?: Record<string, unknown> | null;
      content_html: string; scope?: "user" | "workspace" | "built_in"; sort_order?: number;
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
