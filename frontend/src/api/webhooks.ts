import { api } from "@/lib/axios";

export const WEBHOOK_EVENTS = [
  "issue.created", "issue.updated", "issue.deleted", "comment.created",
  "document.created", "document.updated", "document.deleted",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  is_active: boolean;
  /** 연속 실패로 자동으로 꺼졌을 때의 사유 */
  disabled_reason: string;
  consecutive_failures: number;
  created_by: { id: string; display_name: string };
  created_at: string;
  last_delivery: { event: string; status: WebhookDeliveryStatus; response_status: number | null; created_at: string } | null;
}

/** 만든 직후 응답에만 서명용 secret 이 실린다 */
export interface CreatedWebhook extends Webhook {
  secret: string;
}

export type WebhookDeliveryStatus = "pending" | "success" | "failed";

export interface WebhookDelivery {
  id: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  response_status: number | null;
  response_body: string;
  error: string;
  created_at: string;
  delivered_at: string | null;
  payload: unknown;
}

export const webhooksApi = {
  list: (workspaceSlug: string) =>
    api.get<Webhook[]>(`/workspaces/${workspaceSlug}/webhooks/`).then((r) => r.data),

  create: (workspaceSlug: string, data: { name: string; url: string; events: WebhookEvent[] }) =>
    api.post<CreatedWebhook>(`/workspaces/${workspaceSlug}/webhooks/`, data).then((r) => r.data),

  update: (workspaceSlug: string, id: string, data: Partial<{ name: string; url: string; events: WebhookEvent[]; is_active: boolean }>) =>
    api.patch<Webhook>(`/workspaces/${workspaceSlug}/webhooks/${id}/`, data).then((r) => r.data),

  remove: (workspaceSlug: string, id: string) =>
    api.delete(`/workspaces/${workspaceSlug}/webhooks/${id}/`),

  ping: (workspaceSlug: string, id: string) =>
    api.post(`/workspaces/${workspaceSlug}/webhooks/${id}/ping/`),

  deliveries: (workspaceSlug: string, id: string) =>
    api.get<WebhookDelivery[]>(`/workspaces/${workspaceSlug}/webhooks/${id}/deliveries/`).then((r) => r.data),
};
