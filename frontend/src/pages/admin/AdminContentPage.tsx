import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink, FileStack, Lock, MessageSquare, Paperclip } from "lucide-react";

import { adminApi } from "@/api/admin";
import {
  AdminResourceTable,
  type AdminColumn,
  type AdminFilter,
} from "@/components/admin/AdminResourceTable";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/utils/format-bytes";
import { formatLongDate } from "@/utils/date-format";
import { cn } from "@/lib/utils";
import type { AdminAttachmentRow } from "@/types";

type Tab = "document" | "issue";

/** mime 앞부분으로 거르는 종류 필터 — 대용량 정리할 때 이미지/동영상만 보는 용도. */
const MIME_GROUPS = [
  { value: "image/", labelKey: "admin.content.mimeImage", fallback: "이미지" },
  { value: "video/", labelKey: "admin.content.mimeVideo", fallback: "동영상" },
  { value: "application/pdf", labelKey: "admin.content.mimePdf", fallback: "PDF" },
];

/**
 * 콘텐츠 탐색기 — 전 워크스페이스의 첨부를 찾고 정리한다.
 *
 * 문서 첨부와 이슈 첨부는 모델이 달라 탭으로 나눈다. 하나의 목록으로 합치려면 DB UNION 이
 * 필요한데, 얻는 것은 "둘을 한 화면에서 시간순 정렬" 하나뿐이라 지금은 하지 않는다.
 */
export function AdminContentPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("document");

  /* 워크스페이스 필터 옵션 — 콘솔은 전역이므로 어느 워크스페이스인지 직접 골라야 한다. */
  const { data: workspaces } = useQuery({
    queryKey: ["admin_workspaces", "filter-options"],
    queryFn: () => adminApi.listWorkspaces({ page_size: 200 }),
  });

  const workspaceOptions = (workspaces?.results ?? []).map((ws) => ({
    value: ws.slug,
    label: ws.name,
  }));

  const commonColumns: AdminColumn<AdminAttachmentRow>[] = [
    {
      key: "filename",
      label: t("admin.content.columnFile", "파일명"),
      sortKey: "filename",
      render: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-medium truncate max-w-[240px]" title={row.filename}>
            {row.filename}
          </span>
          {row.space_type === "personal" && (
            <Badge variant="outline" className="shrink-0 gap-1 text-[10px] text-amber-600 border-amber-500/30">
              <Lock className="h-2.5 w-2.5" />
              {t("admin.content.badgePersonal", "개인")}
            </Badge>
          )}
          {row.origin === "from_comment" && (
            <Badge variant="outline" className="shrink-0 gap-1 text-[10px] text-muted-foreground">
              <MessageSquare className="h-2.5 w-2.5" />
              {t("admin.content.badgeComment", "댓글")}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "parent",
      label:
        tab === "document"
          ? t("admin.content.columnDocument", "문서")
          : t("admin.content.columnIssue", "이슈"),
      render: (row) => (
        <div className="min-w-0">
          <div className="text-xs truncate max-w-[260px]" title={row.parent_title}>
            {row.parent_title}
          </div>
          <div className="text-2xs text-muted-foreground truncate">{row.location_name}</div>
        </div>
      ),
    },
    {
      key: "workspace",
      label: t("admin.content.columnWorkspace", "워크스페이스"),
      render: (row) => <span className="text-xs text-muted-foreground">{row.workspace_name}</span>,
    },
    {
      key: "size",
      label: t("admin.content.columnSize", "크기"),
      sortKey: tab === "document" ? "file_size" : "size",
      align: "right",
      render: (row) => (
        <span className="text-2xs tabular-nums text-muted-foreground">{formatBytes(row.size)}</span>
      ),
    },
    {
      key: "uploader",
      label: t("admin.content.columnUploader", "업로더"),
      render: (row) => (
        <span className="text-2xs text-muted-foreground">{row.uploaded_by_name ?? "-"}</span>
      ),
    },
    {
      key: "uploaded_at",
      label: t("admin.content.columnUploaded", "업로드"),
      sortKey: "created_at",
      align: "right",
      render: (row) => (
        <span className="text-2xs tabular-nums text-muted-foreground whitespace-nowrap">
          {formatLongDate(row.uploaded_at)}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.file_url && (
            <a
              href={row.file_url}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground"
              title={t("admin.content.download", "다운로드")}
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          )}
          <a
            href={
              row.kind === "document"
                ? `/${row.workspace_slug}/documents/space/${row.location_id}/${row.parent_id}`
                : `/${row.workspace_slug}/projects/${row.location_id}/issues?issue=${row.parent_id}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground"
            title={t("admin.content.openParent", "원본 열기")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      ),
    },
  ];

  const filters: AdminFilter[] = [
    { key: "search", label: t("admin.content.searchPlaceholder", "파일명 · 제목 검색"), type: "text" },
    ...(workspaceOptions.length > 0
      ? ([{
          key: "workspace",
          label: t("admin.content.filterWorkspace", "워크스페이스"),
          type: "select",
          options: workspaceOptions,
        }] as AdminFilter[])
      : []),
    {
      key: "mime_prefix",
      label: t("admin.content.filterKind", "종류"),
      type: "select",
      options: MIME_GROUPS.map((g) => ({ value: g.value, label: t(g.labelKey, g.fallback) })),
    },
    ...(tab === "issue"
      ? ([{
          key: "origin",
          label: t("admin.content.filterOrigin", "업로드 경로"),
          type: "select",
          options: [
            { value: "direct", label: t("admin.content.originDirect", "첨부 탭") },
            { value: "from_comment", label: t("admin.content.originComment", "댓글") },
          ],
        }] as AdminFilter[])
      : []),
    { key: "uploaded_after", label: t("admin.content.filterFrom", "시작일"), type: "date" },
    { key: "uploaded_before", label: t("admin.content.filterTo", "종료일"), type: "date" },
  ];

  const TABS: { key: Tab; label: string }[] = [
    { key: "document", label: t("admin.content.tabDocument", "문서 첨부") },
    { key: "issue", label: t("admin.content.tabIssue", "이슈 첨부") },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{t("admin.content.title", "콘텐츠 탐색기")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("admin.content.desc", "전체 워크스페이스의 첨부를 찾고 정리합니다.")}
        </p>
      </div>

      <div className="flex items-center gap-1 border-b">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px px-3 py-2 text-sm border-b-2 transition-colors",
              tab === key
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <AdminResourceTable<AdminAttachmentRow>
        key={tab}
        queryKey={["admin_content", tab]}
        fetchPage={
          tab === "document"
            ? adminApi.content.documentAttachments
            : adminApi.content.issueAttachments
        }
        columns={commonColumns}
        rowKey={(row) => row.id}
        filters={filters}
        emptyIcon={<FileStack className="h-10 w-10" />}
        emptyTitle={t("admin.content.empty", "첨부가 없습니다")}
        emptyDescription={t("admin.content.emptyDesc", "검색어나 필터를 바꿔보세요.")}
      />
    </div>
  );
}
