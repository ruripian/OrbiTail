/**
 * 워크스페이스 설정 · API 토큰 — 외부 프로그램이 공개 API(/api/v1/)를 부를 때 쓰는 토큰.
 *
 * 토큰은 만든 사람의 권한으로 동작한다. 그래서 모든 멤버가 자기 토큰을 만들 수 있고,
 * 관리자는 워크스페이스의 모든 토큰을 보고 끊을 수 있다(퇴사자·유출 대응).
 *
 * 원문은 발급 직후 한 번만 보여 준다. 서버는 지문만 저장해서 다시 보여줄 수가 없다.
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Plus } from "lucide-react";

import { apiTokensApi, type ApiToken, type ApiTokenScope, type IssuedApiToken } from "@/api/apiTokens";
import { workspacesApi } from "@/api/workspaces";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";
import { formatLongDate, formatRelative } from "@/utils/date-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Expiry = 30 | 90 | 365 | null;
const EXPIRY_OPTIONS: Expiry[] = [30, 90, 365, null];

export function WorkspaceApiTokensPage() {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isDemo = useDemoStore((s) => s.isDemo);

  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: () => workspacesApi.members(workspaceSlug),
    enabled: !!workspaceSlug,
  });
  const myRole = members.find((m) => m.member.id === currentUser?.id)?.role ?? 0;
  const isAdmin = myRole >= 20;
  const isGuest = myRole > 0 && myRole < 15;

  const [showAll, setShowAll] = useState(false);
  const all = isAdmin && showAll;

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ["api-tokens", workspaceSlug, all],
    queryFn: () => apiTokensApi.list(workspaceSlug, all),
    enabled: !!workspaceSlug,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);

  const revoke = useMutation({
    mutationFn: (id: string) => apiTokensApi.revoke(workspaceSlug, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-tokens", workspaceSlug] });
      setRevoking(null);
      toast.success(t("settings.apiTokens.revoked"));
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("settings.apiTokens.revokeFailed"))),
  });

  const canCreate = !isDemo && !isGuest;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{t("settings.apiTokens.title")}</h1>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {t("settings.apiTokens.subtitle")}
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus className="h-4 w-4 mr-1" />
            {t("settings.apiTokens.create")}
          </Button>
        )}
      </div>

      {isDemo && <p className="text-sm text-muted-foreground">{t("settings.apiTokens.demoBlocked")}</p>}
      {!isDemo && isGuest && <p className="text-sm text-muted-foreground">{t("settings.apiTokens.guestBlocked")}</p>}

      {isAdmin && (
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-xs">
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setShowAll(v)}
              className={
                showAll === v
                  ? "px-3 py-1.5 rounded-[5px] bg-background font-medium shadow-sm"
                  : "px-3 py-1.5 rounded-[5px] text-muted-foreground hover:text-foreground"
              }
            >
              {v ? t("settings.apiTokens.tabAll") : t("settings.apiTokens.tabMine")}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("settings.apiTokens.loading")}</p>
      ) : tokens.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-2">
          <KeyRound className="h-8 w-8 opacity-50" />
          <p className="text-sm">{t("settings.apiTokens.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tokens.map((tk) => (
            <TokenRow
              key={tk.id}
              token={tk}
              showOwner={all}
              onRevoke={() => setRevoking(tk)}
            />
          ))}
        </div>
      )}

      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} workspaceSlug={workspaceSlug} />

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => { if (!o) setRevoking(null); }}
        title={t("settings.apiTokens.revokeTitle", { name: revoking?.name ?? "" })}
        description={t("settings.apiTokens.revokeDescription")}
        confirmLabel={t("settings.apiTokens.revoke")}
        variant="destructive"
        loading={revoke.isPending}
        onConfirm={() => { if (revoking) revoke.mutate(revoking.id); }}
      />
    </div>
  );
}

function TokenRow({ token, showOwner, onRevoke }: { token: ApiToken; showOwner: boolean; onRevoke: () => void }) {
  const { t } = useTranslation();
  const active = token.status === "active";

  const statusClass =
    token.status === "active" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" :
    token.status === "expired" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" :
    "bg-muted text-muted-foreground border-border";

  return (
    <div className={cn("flex items-center gap-3 rounded-lg border bg-background p-3", !active && "opacity-70")}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
        <KeyRound className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">{token.name}</p>
          <span className="text-2xs font-semibold px-1.5 py-0.5 rounded-md border bg-muted/40 shrink-0">
            {t(`settings.apiTokens.scope.${token.scope}`)}
          </span>
          <span className={cn("text-2xs font-semibold px-1.5 py-0.5 rounded-md border shrink-0", statusClass)}>
            {t(`settings.apiTokens.status.${token.status}`)}
          </span>
        </div>
        <p className="text-2xs text-muted-foreground font-mono truncate mt-0.5">
          {token.prefix}…
          {showOwner && <span className="font-sans"> · {token.owner.display_name}</span>}
        </p>
        <p className="text-2xs text-muted-foreground mt-0.5">
          {t("settings.apiTokens.createdOn", { date: formatLongDate(token.created_at) })}
          {" · "}
          {token.last_used_at
            ? t("settings.apiTokens.lastUsed", { when: formatRelative(token.last_used_at, t) })
            : t("settings.apiTokens.neverUsed")}
          {" · "}
          {token.revoked_at
            ? t("settings.apiTokens.revokedOn", { date: formatLongDate(token.revoked_at) })
            : token.expires_at
              ? t("settings.apiTokens.expiresOn", { date: formatLongDate(token.expires_at) })
              : t("settings.apiTokens.noExpiry")}
        </p>
      </div>
      {active && (
        <button
          type="button"
          onClick={onRevoke}
          className="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
        >
          {t("settings.apiTokens.revoke")}
        </button>
      )}
    </div>
  );
}

function CreateTokenDialog({
  open, onOpenChange, workspaceSlug,
}: { open: boolean; onOpenChange: (open: boolean) => void; workspaceSlug: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiTokenScope>("read");
  const [expiry, setExpiry] = useState<Expiry>(90);
  const [issued, setIssued] = useState<IssuedApiToken | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () => apiTokensApi.create(workspaceSlug, { name: name.trim(), scope, expires_in_days: expiry }),
    onSuccess: (data) => {
      setIssued(data);
      qc.invalidateQueries({ queryKey: ["api-tokens", workspaceSlug] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("settings.apiTokens.createFailed"))),
  });

  /* 닫으면 원문을 메모리에서도 지운다 — 다시 열었을 때 남아 있으면 안 된다 */
  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setName(""); setScope("read"); setExpiry(90); setIssued(null); setCopied(false);
    }
    onOpenChange(o);
  };

  const copy = () => {
    if (!issued) return;
    navigator.clipboard.writeText(issued.token).then(() => setCopied(true));
  };

  const exampleCurl = issued
    ? `curl -H "Authorization: Bearer ${issued.token}" ${window.location.origin}/api/v1/me/`
    : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{issued ? t("settings.apiTokens.issuedTitle") : t("settings.apiTokens.create")}</DialogTitle>
        </DialogHeader>

        {issued ? (
          <div className="space-y-4">
            <p className="text-sm text-amber-600 dark:text-amber-400 leading-relaxed">
              {t("settings.apiTokens.issuedWarning")}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 rounded-md border bg-muted/40 px-2.5 py-2 text-xs font-mono break-all select-all">
                {issued.token}
              </code>
              <Button variant="outline" size="sm" onClick={copy} className="shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1">{copied ? t("settings.apiTokens.copied") : t("settings.apiTokens.copy")}</span>
              </Button>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("settings.apiTokens.tryIt")}</p>
              <code className="block rounded-md border bg-muted/40 px-2.5 py-2 text-2xs font-mono break-all">
                {exampleCurl}
              </code>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => handleOpenChange(false)}>{t("settings.apiTokens.done")}</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="api-token-name">{t("settings.apiTokens.name")}</Label>
              <Input
                id="api-token-name"
                value={name}
                maxLength={100}
                autoFocus
                placeholder={t("settings.apiTokens.namePlaceholder")}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("settings.apiTokens.scopeLabel")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["read", "write"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    aria-pressed={scope === s}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors",
                      scope === s ? "border-primary bg-primary/5" : "hover:bg-accent",
                    )}
                  >
                    <span className="block text-sm font-medium">{t(`settings.apiTokens.scope.${s}`)}</span>
                    <span className="block text-2xs text-muted-foreground mt-0.5">
                      {t(`settings.apiTokens.scopeHint.${s}`)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("settings.apiTokens.expiryLabel")}</Label>
              <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-xs">
                {EXPIRY_OPTIONS.map((d) => (
                  <button
                    key={String(d)}
                    type="button"
                    onClick={() => setExpiry(d)}
                    aria-pressed={expiry === d}
                    className={
                      expiry === d
                        ? "px-3 py-1.5 rounded-[5px] bg-background font-medium shadow-sm"
                        : "px-3 py-1.5 rounded-[5px] text-muted-foreground hover:text-foreground"
                    }
                  >
                    {d === null ? t("settings.apiTokens.noExpiry") : t("settings.apiTokens.days", { count: d })}
                  </button>
                ))}
              </div>
              {expiry === null && (
                <p className="text-2xs text-muted-foreground">{t("settings.apiTokens.noExpiryHint")}</p>
              )}
            </div>

            <p className="text-2xs text-muted-foreground leading-relaxed">{t("settings.apiTokens.actsAsYou")}</p>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                {t("settings.apiTokens.createSubmit")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
