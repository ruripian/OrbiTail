import { api } from "@/lib/axios";
import type { User } from "@/types";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  version: string;
  category: "feature" | "improvement" | "bugfix" | "notice";
  is_published: boolean;
  created_by: string | null;
  created_by_detail: User | null;
  created_at: string;
  updated_at: string;
}

export const announcementsApi = {
  list: (): Promise<Announcement[]> =>
    api.get<{ results: Announcement[] } | Announcement[]>("/auth/announcements/").then((r) => {
      const d = r.data as unknown;
      return Array.isArray(d) ? d : (d as { results: Announcement[] }).results;
    }),

  create: (data: Partial<Announcement>): Promise<Announcement> =>
    api.post<Announcement>("/auth/announcements/", data).then((r) => r.data),

  update: (id: string, data: Partial<Announcement>): Promise<Announcement> =>
    api.patch<Announcement>(`/auth/announcements/${id}/`, data).then((r) => r.data),

  delete: (id: string): Promise<void> =>
    api.delete(`/auth/announcements/${id}/`).then(() => undefined),

  unreadCount: (): Promise<number> =>
    api.get<{ unread: number }>("/auth/announcements/unread/").then((r) => r.data.unread),

  markSeen: (): Promise<void> =>
    api.post("/auth/announcements/mark-seen/").then(() => undefined),
};
