import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Ban,
  Building2,
  ChevronRight,
  FileText,
  FolderKanban,
  HardDrive,
  ListChecks,
  Loader2,
  MailWarning,
  Paperclip,
  UserCheck,
  Users as UsersIcon,
} from "lucide-react";

import { adminApi } from "@/api/admin";
import { formatBytes } from "@/utils/format-bytes";
import { cn } from "@/lib/utils";

/**
 * 콘솔 개요 — "지금 손봐야 할 것"을 위에, "규모"를 아래에 둔다.
 *
 * 차트는 두지 않는다. 운영 판단에 쓰이는 값은 전부 현재 수치 하나짜리라
 * 그래프로 만들면 읽는 시간만 늘어난다.
 */
export function AdminOverviewPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["admin_overview"],
    queryFn: adminApi.overview,
  });

  if (isLoading || !data) {
    return (
      <div className="py-20 flex justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const { users, workspaces, content } = data;

  /* 처리 대기 항목 — 0인 것은 아예 보여주지 않는다. 빈 줄이 늘어나면 남은 항목이 묻힌다. */
  const queue = [
    {
      key: "pending",
      count: users.pending,
      label: t("admin.overview.queuePending", "가입 승인 대기"),
      hint: t("admin.overview.queuePendingHint", "이메일 인증까지 끝낸 사용자입니다"),
      icon: UserCheck,
      to: "/admin/users?status=pending",
      tone: "text-primary bg-primary/10 border-primary/25",
    },
    {
      key: "unverified",
      count: users.unverified,
      label: t("admin.overview.queueUnverified", "이메일 미인증"),
      hint: t("admin.overview.queueUnverifiedHint", "인증 전에는 승인할 수 없습니다"),
      icon: MailWarning,
      to: "/admin/users",
      tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25",
    },
    {
      key: "suspended",
      count: users.suspended,
      label: t("admin.overview.queueSuspended", "정지된 계정"),
      hint: t("admin.overview.queueSuspendedHint", "로그인이 차단된 상태입니다"),
      icon: Ban,
      to: "/admin/users?status=suspended",
      tone: "text-destructive bg-destructive/10 border-destructive/25",
    },
  ].filter((item) => item.count > 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">{t("admin.overview.title", "시스템 개요")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("admin.overview.desc", "전체 시스템의 현재 상태입니다.")}
        </p>
      </div>

      {/* ─── 처리 대기 ─── */}
      <section className="space-y-3">
        <SectionLabel icon={ListChecks} text={t("admin.overview.sectionQueue", "처리 대기")} />
        {queue.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
            {t("admin.overview.queueClear", "처리할 항목이 없습니다.")}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {queue.map(({ key, count, label, hint, icon: Icon, to, tone }) => (
              <Link
                key={key}
                to={to}
                className="group rounded-xl border bg-card px-4 py-3 flex items-center gap-3 hover:border-primary/40 transition-colors"
              >
                <span className={cn("h-9 w-9 shrink-0 rounded-lg border flex items-center justify-center", tone)}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-xl font-semibold tabular-nums leading-none">{count}</span>
                    <span className="text-sm font-medium truncate">{label}</span>
                  </span>
                  <span className="block text-2xs text-muted-foreground mt-1 truncate">{hint}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-primary transition-colors" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ─── 규모 ─── */}
      <section className="space-y-3">
        <SectionLabel icon={UsersIcon} text={t("admin.overview.sectionScale", "규모")} />
        <div className="rounded-xl border bg-card divide-y sm:divide-y-0 sm:grid sm:grid-cols-2 lg:grid-cols-4 sm:divide-x">
          <Stat
            icon={UsersIcon}
            label={t("admin.overview.statUsers", "사용자")}
            value={users.total}
            sub={t("admin.overview.statUsersSub", "슈퍼유저 {{count}}명", { count: users.superusers })}
          />
          <Stat
            icon={Building2}
            label={t("admin.overview.statWorkspaces", "워크스페이스")}
            value={workspaces.total}
          />
          <Stat
            icon={FolderKanban}
            label={t("admin.overview.statProjects", "프로젝트")}
            value={workspaces.projects}
          />
          <Stat
            icon={FileText}
            label={t("admin.overview.statDocuments", "문서")}
            value={content.documents}
            sub={t("admin.overview.statIssuesSub", "이슈 {{count}}건", { count: content.issues })}
          />
        </div>
      </section>

      {/* ─── 저장 용량 ─── */}
      <section className="space-y-3">
        <SectionLabel icon={HardDrive} text={t("admin.overview.sectionStorage", "저장 용량")} />
        <div className="rounded-xl border bg-card px-4 py-4 space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {formatBytes(content.storage_bytes)}
            </span>
            <span className="text-sm text-muted-foreground">
              {t("admin.overview.storageTotal", "첨부 {{count}}개", { count: content.attachments })}
            </span>
          </div>
          <dl className="grid gap-2 sm:grid-cols-2 text-xs">
            <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                {t("admin.overview.storageDocuments", "문서 첨부")}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatBytes(content.document_storage_bytes)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" />
                {t("admin.overview.storageIssues", "이슈 첨부")}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatBytes(content.issue_storage_bytes)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ─── 가입 추이 ─── */}
      <section className="space-y-3">
        <SectionLabel icon={UserCheck} text={t("admin.overview.sectionSignups", "최근 가입")} />
        <div className="rounded-xl border bg-card divide-y sm:divide-y-0 sm:grid sm:grid-cols-3 sm:divide-x">
          <Stat label={t("admin.overview.signup7d", "최근 7일")} value={users.joined_last_7d} />
          <Stat label={t("admin.overview.signup30d", "최근 30일")} value={users.joined_last_30d} />
          <Stat label={t("admin.overview.deletedUsers", "탈퇴 계정")} value={users.deleted} />
        </div>
      </section>
    </div>
  );
}

function SectionLabel({ icon: Icon, text }: { icon: typeof UsersIcon; text: string }) {
  return (
    <h2 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {text}
    </h2>
  );
}

function Stat({
  icon: Icon, label, value, sub,
}: {
  icon?:  typeof UsersIcon;
  label:  string;
  value:  number;
  sub?:   ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums leading-none">{value}</p>
      {sub && <p className="mt-1.5 text-2xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
