import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Plus, Tag, Trash2, Edit3, X, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { announcementsApi, type Announcement } from "@/api/announcements";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/date-format";

const CATEGORY_STYLES: Record<Announcement["category"], { label: string; cls: string }> = {
  feature:     { label: "신규 기능",   cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  improvement: { label: "개선",       cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  bugfix:      { label: "버그 수정",   cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  notice:      { label: "공지",       cls: "bg-purple-500/15 text-purple-700 dark:text-purple-400" },
};

export function AnnouncementsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isStaff = useAuthStore((s) => s.user?.is_staff);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn:  announcementsApi.list,
  });

  /* 페이지 진입 시 모든 공지를 본 것으로 표시 → 사이드바 unread 배지 초기화 */
  useEffect(() => {
    if (items.length > 0) {
      announcementsApi.markSeen().then(() => {
        qc.invalidateQueries({ queryKey: ["announcements-unread"] });
      }).catch(() => {});
    }
  }, [items.length, qc]);

  const [editing, setEditing] = useState<Announcement | null>(null);
  const [creating, setCreating] = useState(false);

  const createMutation = useMutation({
    mutationFn: (data: Partial<Announcement>) => announcementsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements"] });
      setCreating(false);
      toast.success("공지가 등록되었습니다");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Announcement> }) =>
      announcementsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements"] });
      setEditing(null);
      toast.success("공지가 수정되었습니다");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => announcementsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements"] });
      toast.success("공지가 삭제되었습니다");
    },
  });

  return (
    <div className="h-full overflow-y-auto p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Megaphone className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">{t("announcements.title")}</h1>
        </div>
        {isStaff && !creating && !editing && (
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("announcements.new")}
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <AnnouncementEditor
          initial={editing}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSubmit={(data) => {
            if (editing) updateMutation.mutate({ id: editing.id, data });
            else createMutation.mutate(data);
          }}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-10 w-10" />}
          title={t("empty.announcements.title")}
          description={t("empty.announcements.description")}
        />
      ) : (
        <div className="space-y-4">
          {items.map((a) => {
            const cat = CATEGORY_STYLES[a.category];
            return (
              <article
                key={a.id}
                className="rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <header className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-2xs font-bold uppercase px-2 py-0.5 rounded-md tracking-wider", cat.cls)}>
                      {cat.label}
                    </span>
                    {a.version && (
                      <span className="inline-flex items-center gap-1 text-2xs font-mono px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                        <Tag className="h-3 w-3" />
                        {a.version}
                      </span>
                    )}
                    <h2 className="text-lg font-semibold">{a.title}</h2>
                  </div>
                  {isStaff && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditing(a)}
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="수정"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("이 공지를 삭제할까요?")) deleteMutation.mutate(a.id);
                        }}
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        title="삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </header>
                <div className="text-2xs text-muted-foreground mb-3">
                  {a.created_by_detail?.display_name ?? "—"} · {formatDate(a.created_at)}
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                  {a.body}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnnouncementEditor({
  initial, onCancel, onSubmit, submitting,
}: {
  initial: Announcement | null;
  onCancel: () => void;
  onSubmit: (data: Partial<Announcement>) => void;
  submitting: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [version, setVersion] = useState(initial?.version ?? "");
  const [category, setCategory] = useState<Announcement["category"]>(initial?.category ?? "notice");

  return (
    <div className="rounded-2xl border border-primary/40 bg-card p-5 mb-6 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1">
          <Label>제목</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="공지 제목" />
        </div>
        <div className="space-y-1">
          <Label>버전</Label>
          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1.4.0" />
        </div>
      </div>

      <div className="space-y-1">
        <Label>카테고리</Label>
        <div className="flex gap-1.5 flex-wrap">
          {(Object.keys(CATEGORY_STYLES) as Announcement["category"][]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "text-xs font-medium px-3 py-1.5 rounded-md border transition-all",
                category === c
                  ? CATEGORY_STYLES[c].cls + " border-transparent"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {CATEGORY_STYLES[c].label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label>본문</Label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder="공지 내용 (markdown 지원)"
          className="flex w-full rounded-md border border-border bg-input/60 px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-ring/60 resize-y font-mono"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        <Button variant="ghost" onClick={onCancel} className="gap-1.5">
          <X className="h-4 w-4" /> 취소
        </Button>
        <Button
          disabled={!title.trim() || !body.trim() || submitting}
          onClick={() => onSubmit({ title, body, version, category })}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" /> 저장
        </Button>
      </div>
    </div>
  );
}
