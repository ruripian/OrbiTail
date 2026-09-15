/**
 * 워크스페이스 설정 · 웹훅 — 이슈·문서에 일이 생기면 외부 주소로 알린다.
 *
 * 관리자 전용. 웹훅은 만든 사람의 눈으로 보므로, 그 사람이 볼 수 없는 프로젝트·문서의 이벤트는 가지 않는다.
 * 서명용 비밀값은 만든 직후 한 번만 보여 준다.
 */
import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, Copy, Plus, Send, Webhook as WebhookIcon } from "lucide-react";

import { webhooksApi, WEBHOOK_EVENTS, type CreatedWebhook, type Webhook, type WebhookEvent } from "@/api/webhooks";
import { workspacesApi } from "@/api/workspaces";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";
import { formatRelative } from "@/utils/date-format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* 이벤트 이름의 점은 i18next 가 키 경로로 읽으므로 번역 키에서는 밑줄로 바꾼다 */
const eventLabelKey = (e: string) => `settings.webhooks.event.${e.replace(".", "_")}`;

const STATUS_CLASS = {
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  pending: "bg-muted text-muted-foreground border-border",
} as const;

export function WorkspaceWebhooksPage() {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isDemo = useDemoStore((s) => s.isDemo);

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug),
    enabled: !!workspaceSlug,
  });
  const isAdmin = (members.find((m) => m.member.id === currentUser?.id)?.role ?? 0) >= 20;

  const { data: hooks = [], isLoading } = useQuery({
    queryKey: ["webhooks", workspaceSlug],
    queryFn: () => webhooksApi.list(workspaceSlug),
    enabled: !!workspaceSlug && isAdmin,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<Webhook | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["webhooks", workspaceSlug] });
  const toggle = useMutation({
    mutationFn: (hook: Webhook) => webhooksApi.update(workspaceSlug, hook.id, { is_active: !hook.is_active }),
    onSuccess: invalidate,
    onError: (e) => toast.error(apiErrorMessage(e, t("settings.webhooks.updateFailed"))),
  });
  const remove = useMutation({
    mutationFn: (id: string) => webhooksApi.remove(workspaceSlug, id),
    onSuccess: () => { invalidate(); setDeleting(null); },
    onError: (e) => toast.error(apiErrorMessage(e, t("settings.webhooks.deleteFailed"))),
  });

  if (!membersLoading && !isAdmin) {
    return <Navigate to={`/${workspaceSlug}/workspace-settings/api-tokens`} replace />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{t("settings.webhooks.title")}</h1>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t("settings.webhooks.subtitle")}</p>
        </div>
        {!isDemo && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus className="h-4 w-4 mr-1" />
            {t("settings.webhooks.create")}
          </Button>
        )}
      </div>

      {isDemo && <p className="text-sm text-muted-foreground">{t("settings.webhooks.demoBlocked")}</p>}

      {isLoading || membersLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("settings.webhooks.loading")}</p>
      ) : hooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-2">
          <WebhookIcon className="h-8 w-8 opacity-50" />
          <p className="text-sm">{t("settings.webhooks.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {hooks.map((hook) => (
            <WebhookRow
              key={hook.id}
              hook={hook}
              workspaceSlug={workspaceSlug}
              onToggle={() => toggle.mutate(hook)}
              onDelete={() => setDeleting(hook)}
            />
          ))}
        </div>
      )}

      <CreateWebhookDialog open={createOpen} onOpenChange={setCreateOpen} workspaceSlug={workspaceSlug} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={t("settings.webhooks.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("settings.webhooks.deleteDescription")}
        confirmLabel={t("settings.webhooks.delete")}
        variant="destructive"
        loading={remove.isPending}
        onConfirm={() => { if (deleting) remove.mutate(deleting.id); }}
      />
    </div>
  );
}

function WebhookRow({ hook, workspaceSlug, onToggle, onDelete }: {
  hook: Webhook; workspaceSlug: string; onToggle: () => void; onDelete: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ["webhook-deliveries", workspaceSlug, hook.id],
    queryFn: () => webhooksApi.deliveries(workspaceSlug, hook.id),
    enabled: open,
    /* 시험 발송 직후 결과가 뜨는 것을 보여주려고, 펼쳐 둔 동안만 짧게 다시 불러온다 */
    refetchInterval: open ? 5000 : false,
  });

  const ping = useMutation({
    mutationFn: () => webhooksApi.ping(workspaceSlug, hook.id),
    onSuccess: () => {
      toast.success(t("settings.webhooks.pingQueued"));
      setOpen(true);
      qc.invalidateQueries({ queryKey: ["webhook-deliveries", workspaceSlug, hook.id] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("settings.webhooks.pingFailed"))),
  });

  return (
    <div className={cn("rounded-lg border bg-background", !hook.is_active && "opacity-80")}>
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t("settings.webhooks.deliveries")}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{hook.name}</p>
            <span className={cn(
              "text-2xs font-semibold px-1.5 py-0.5 rounded-md border shrink-0",
              hook.is_active ? STATUS_CLASS.success : STATUS_CLASS.pending,
            )}>
              {hook.is_active ? t("settings.webhooks.active") : t("settings.webhooks.inactive")}
            </span>
          </div>
          <p className="text-2xs text-muted-foreground font-mono truncate mt-0.5">{hook.url}</p>
          <p className="text-2xs text-muted-foreground mt-0.5">
            {hook.events.map((e) => t(eventLabelKey(e))).join(" · ")}
          </p>
          {hook.disabled_reason && (
            <p className="text-2xs text-destructive mt-0.5">{hook.disabled_reason}</p>
          )}
          {hook.last_delivery && (
            <p className="text-2xs text-muted-foreground mt-0.5">
              {t("settings.webhooks.lastDelivery", {
                when: formatRelative(hook.last_delivery.created_at, t),
                status: t(`settings.webhooks.status.${hook.last_delivery.status}`),
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => ping.mutate()}
            disabled={!hook.is_active || ping.isPending}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            {t("settings.webhooks.ping")}
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            {hook.is_active ? t("settings.webhooks.disable") : t("settings.webhooks.enable")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            {t("settings.webhooks.delete")}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t px-3 py-2 space-y-1">
          {isLoading ? (
            <p className="text-2xs text-muted-foreground py-2">{t("settings.webhooks.loading")}</p>
          ) : deliveries.length === 0 ? (
            <p className="text-2xs text-muted-foreground py-2">{t("settings.webhooks.noDeliveries")}</p>
          ) : (
            deliveries.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-2xs py-1">
                <span className={cn("font-semibold px-1.5 py-0.5 rounded-md border shrink-0", STATUS_CLASS[d.status])}>
                  {t(`settings.webhooks.status.${d.status}`)}
                </span>
                <span className="font-mono shrink-0">{d.event}</span>
                <span className="text-muted-foreground shrink-0">
                  {d.response_status ?? "—"} · {t("settings.webhooks.attempts", { count: d.attempts })}
                </span>
                <span className="text-muted-foreground truncate min-w-0">{d.error || d.response_body}</span>
                <span className="text-muted-foreground ml-auto shrink-0">{formatRelative(d.created_at, t)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CreateWebhookDialog({ open, onOpenChange, workspaceSlug }: {
  open: boolean; onOpenChange: (open: boolean) => void; workspaceSlug: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["issue.created", "issue.updated"]);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () => webhooksApi.create(workspaceSlug, { name: name.trim(), url: url.trim(), events }),
    onSuccess: (data) => {
      setCreated(data);
      qc.invalidateQueries({ queryKey: ["webhooks", workspaceSlug] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("settings.webhooks.createFailed"))),
  });

  /* 닫으면 비밀값을 메모리에서도 지운다 */
  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setName(""); setUrl(""); setEvents(["issue.created", "issue.updated"]); setCreated(null); setCopied(false);
    }
    onOpenChange(o);
  };

  const toggleEvent = (e: WebhookEvent) =>
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{created ? t("settings.webhooks.createdTitle") : t("settings.webhooks.create")}</DialogTitle>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <p className="text-sm text-amber-600 dark:text-amber-400 leading-relaxed">
              {t("settings.webhooks.secretWarning")}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 rounded-md border bg-muted/40 px-2.5 py-2 text-xs font-mono break-all select-all">
                {created.secret}
              </code>
              <Button
                variant="outline" size="sm" className="shrink-0"
                onClick={() => navigator.clipboard.writeText(created.secret).then(() => setCopied(true))}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1">{copied ? t("settings.webhooks.copied") : t("settings.webhooks.copy")}</span>
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground leading-relaxed">{t("settings.webhooks.verifyHint")}</p>
            <div className="flex justify-end">
              <Button onClick={() => handleOpenChange(false)}>{t("settings.webhooks.done")}</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); if (name.trim() && url.trim() && events.length) create.mutate(); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="webhook-name">{t("settings.webhooks.name")}</Label>
              <Input id="webhook-name" value={name} maxLength={100} autoFocus
                     placeholder={t("settings.webhooks.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">{t("settings.webhooks.url")}</Label>
              <Input id="webhook-url" value={url} maxLength={500} placeholder="https://"
                     onChange={(e) => setUrl(e.target.value)} />
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t("settings.webhooks.events")}</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {WEBHOOK_EVENTS.map((e) => (
                  <div key={e} className="flex items-center gap-2 text-sm">
                    <Checkbox id={`webhook-event-${e}`} checked={events.includes(e)} onChange={() => toggleEvent(e)} />
                    <label htmlFor={`webhook-event-${e}`} className="cursor-pointer">{t(eventLabelKey(e))}</label>
                  </div>
                ))}
              </div>
            </fieldset>
            <p className="text-2xs text-muted-foreground leading-relaxed">{t("settings.webhooks.actsAsYou")}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={!name.trim() || !url.trim() || events.length === 0 || create.isPending}>
                {t("settings.webhooks.createSubmit")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
