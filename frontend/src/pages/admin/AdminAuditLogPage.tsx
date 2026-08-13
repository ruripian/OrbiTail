import { useTranslation } from "react-i18next";
import { ScrollText } from "lucide-react";

import { adminApi } from "@/api/admin";
import {
  AdminResourceTable,
  type AdminColumn,
  type AdminFilter,
} from "@/components/admin/AdminResourceTable";
import { Badge } from "@/components/ui/badge";
import { formatLongDate, formatTime } from "@/utils/date-format";
import type { AuditAction, AuditLog } from "@/types";

const ACTIONS: AuditAction[] = [
  "superuser_grant", "superuser_revoke",
  "user_approve", "user_suspend", "user_unsuspend", "user_delete",
  "workspace_create", "workspace_delete", "workspace_owner",
];

const ACTION_TONE: Record<AuditAction, string> = {
  superuser_grant:  "text-amber-600 border-amber-500/30 bg-amber-500/10",
  superuser_revoke: "text-amber-600 border-amber-500/30 bg-amber-500/5",
  user_approve:     "text-emerald-600 border-emerald-500/30 bg-emerald-500/10",
  user_suspend:     "text-orange-600 border-orange-500/30 bg-orange-500/10",
  user_unsuspend:   "text-emerald-600 border-emerald-500/30 bg-emerald-500/10",
  user_delete:      "text-destructive border-destructive/30 bg-destructive/10",
  workspace_create: "text-blue-600 border-blue-500/30 bg-blue-500/10",
  workspace_delete: "text-destructive border-destructive/30 bg-destructive/10",
  workspace_owner:  "text-violet-600 border-violet-500/30 bg-violet-500/10",
};

export function AdminAuditLogPage() {
  const { t } = useTranslation();

  /* target_type 은 향후 attachment/document 등으로 늘어나므로, 라벨이 없는 값은 원문을 그대로 보여준다. */
  const targetLabel = (type: string) =>
    ({
      user: t("admin.audit.targetUser", "사용자"),
      workspace: t("admin.audit.targetWorkspace", "워크스페이스"),
    })[type] ?? type;

  const columns: AdminColumn<AuditLog>[] = [
    {
      key: "action",
      label: t("admin.audit.columnAction", "행위"),
      sortKey: "action",
      render: (log) => (
        <Badge variant="outline" className={`text-[10px] whitespace-nowrap ${ACTION_TONE[log.action] ?? ""}`}>
          {t(`admin.audit.action.${log.action}`)}
        </Badge>
      ),
    },
    {
      key: "actor",
      label: t("admin.audit.columnActor", "행위자"),
      render: (log) => (
        <span className="text-xs font-medium">
          {log.actor_label || t("admin.audit.system")}
        </span>
      ),
    },
    {
      key: "target",
      label: t("admin.audit.columnTarget", "대상"),
      render: (log) => (
        <div className="min-w-0">
          <div className="text-xs truncate max-w-[280px]" title={log.target_label}>
            {log.target_label}
          </div>
          <div className="text-2xs text-muted-foreground">{targetLabel(log.target_type)}</div>
        </div>
      ),
    },
    {
      key: "metadata",
      label: t("admin.audit.columnMetadata", "상세"),
      render: (log) =>
        log.metadata && Object.keys(log.metadata).length > 0 ? (
          <span className="text-2xs text-muted-foreground font-mono">
            {Object.entries(log.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
          </span>
        ) : (
          <span className="text-2xs text-muted-foreground/50">-</span>
        ),
    },
    {
      key: "created_at",
      label: t("admin.audit.columnTime", "시각"),
      sortKey: "created_at",
      align: "right",
      render: (log) => (
        <div className="text-2xs text-muted-foreground tabular-nums whitespace-nowrap">
          <div>{formatLongDate(log.created_at)}</div>
          <div>{formatTime(log.created_at)}</div>
        </div>
      ),
    },
  ];

  const filters: AdminFilter[] = [
    { key: "search", label: t("admin.audit.searchPlaceholder", "행위자 · 대상 검색"), type: "text" },
    {
      key: "action",
      label: t("admin.audit.action.all"),
      type: "select",
      options: ACTIONS.map((a) => ({ value: a, label: t(`admin.audit.action.${a}`) })),
    },
    {
      key: "target_type",
      label: t("admin.audit.filterTargetType", "대상 종류"),
      type: "select",
      options: [
        { value: "user", label: t("admin.audit.targetUser", "사용자") },
        { value: "workspace", label: t("admin.audit.targetWorkspace", "워크스페이스") },
      ],
    },
    { key: "created_after", label: t("admin.audit.filterFrom", "시작일"), type: "date" },
    { key: "created_before", label: t("admin.audit.filterTo", "종료일"), type: "date" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{t("admin.audit.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("admin.audit.desc")}</p>
      </div>

      <AdminResourceTable<AuditLog>
        queryKey={["admin_audit"]}
        fetchPage={adminApi.listAudit}
        columns={columns}
        rowKey={(log) => log.id}
        filters={filters}
        emptyIcon={<ScrollText className="h-10 w-10" />}
        emptyTitle={t("admin.audit.empty")}
      />
    </div>
  );
}
