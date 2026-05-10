import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Users } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { AssigneePicker } from "@/components/issues/assignee-picker";
import { cn } from "@/lib/utils";
import { projectsApi } from "@/api/projects";
import { meApi } from "@/api/me";
import { EVENT_TYPES, EVENT_TYPE_LIST, EVENT_COLORS, type EventType } from "@/constants/event-types";
import type { ProjectEvent, PersonalEvent } from "@/types";

/**
 * EventDialog — 프로젝트 캘린더 이벤트 생성/수정
 *
 * 생성 모드: event prop 없음, defaultDate 있음
 * 수정 모드: event prop 전달
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "project": 프로젝트 캘린더 이벤트(워크스페이스/프로젝트 컨텍스트 필요).
   *  "me": 마이 페이지 개인 일정(워크스페이스/프로젝트 무관, 본인만 보고 본인만 편집). */
  mode?: "project" | "me";
  /** mode="project" 에서만 사용 */
  workspaceSlug?: string;
  projectId?: string;
  /** 수정할 이벤트 (없으면 생성 모드) */
  event?: ProjectEvent | PersonalEvent | null;
  /** 생성 모드 시 기본 날짜 (셀에서 클릭한 날짜) */
  defaultDate?: string;
}

export function EventDialog({
  open, onOpenChange, mode = "project",
  workspaceSlug, projectId, event, defaultDate,
}: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEdit = !!event;
  const isMe = mode === "me";

  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string | null>(null);
  const [eventType, setEventType] = useState<EventType>("meeting");
  const [color, setColor] = useState<string>(EVENT_COLORS[0]);
  const [description, setDescription] = useState("");
  const [isGlobal, setIsGlobal] = useState(true);
  const [participants, setParticipants] = useState<string[]>([]);

  /* 프로젝트 모드에서만 멤버 fetch — me 모드는 참여자 개념 없음 */
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn:  () => projectsApi.members.list(workspaceSlug!, projectId!),
    enabled:  open && !isMe && !!workspaceSlug && !!projectId,
  });

  /* 다이얼로그 열릴 때 초기값 세팅, 닫힐 때 명시적 초기화 */
  useEffect(() => {
    if (!open) {
      /* 닫힐 때 제목 등 초기화 — 재오픈 시 이전 값 잔류 방지 */
      setTitle("");
      setDescription("");
      setIsGlobal(true);
      setParticipants([]);
      return;
    }
    if (event) {
      setTitle(event.title);
      setDate(event.date);
      setEndDate(event.end_date);
      setEventType(event.event_type as EventType);
      setColor(event.color);
      setDescription(event.description);
      /* me 모드 PersonalEvent 는 is_global/participants 가 없음 — 기본값 유지 */
      const proj = event as ProjectEvent;
      setIsGlobal(proj.is_global ?? true);
      setParticipants(proj.participants ?? []);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const initial = defaultDate ?? today;
      setTitle("");
      /* 생성 시 기본값: 시작일/마감일 모두 선택한 날짜 (단일 날짜 이벤트) */
      setDate(initial);
      setEndDate(initial);
      setEventType("meeting");
      setColor(EVENT_TYPES.meeting.defaultColor);
      setDescription("");
      setIsGlobal(true);
      setParticipants([]);
    }
  }, [open, event, defaultDate]);

  const invalidate = () => {
    if (isMe) {
      qc.invalidateQueries({ queryKey: ["me", "personal-events"] });
      qc.invalidateQueries({ queryKey: ["me", "events"] });
    } else {
      qc.invalidateQueries({ queryKey: ["events", workspaceSlug, projectId] });
    }
  };

  const createMutation = useMutation({
    mutationFn: () => isMe
      ? meApi.personalEvents.create(workspaceSlug!, {
          title, date, end_date: endDate,
          event_type: eventType, color, description,
        })
      : projectsApi.events.create(workspaceSlug!, projectId!, {
          title, date, end_date: endDate, event_type: eventType, color, description,
          is_global: isGlobal, participants,
        }),
    onSuccess: () => { invalidate(); onOpenChange(false); toast.success(t("events.created")); },
    onError: () => toast.error(t("events.createFailed")),
  });

  const updateMutation = useMutation({
    mutationFn: () => isMe
      ? meApi.personalEvents.update(event!.id, {
          title, date, end_date: endDate,
          event_type: eventType, color, description,
        })
      : projectsApi.events.update(workspaceSlug!, projectId!, event!.id, {
          title, date, end_date: endDate, event_type: eventType, color, description,
          is_global: isGlobal, participants,
        }),
    onSuccess: () => { invalidate(); onOpenChange(false); toast.success(t("events.updated")); },
    onError: () => toast.error(t("events.updateFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => isMe
      ? meApi.personalEvents.delete(event!.id)
      : projectsApi.events.delete(workspaceSlug!, projectId!, event!.id),
    onSuccess: () => { invalidate(); onOpenChange(false); toast.success(t("events.deleted")); },
    onError: () => toast.error(t("events.deleteFailed")),
  });

  const submit = () => {
    if (!title.trim() || !date) return;
    if (isEdit) updateMutation.mutate();
    else createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("events.editTitle") : t("events.createTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 제목 */}
          <div className="space-y-1">
            <Label htmlFor="event-title">{t("events.fields.title")}</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("events.fields.titlePlaceholder")}
              autoFocus
            />
          </div>

          {/* 날짜 + 종료일 — IssueCreateDialog와 동일한 border 스타일 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("events.fields.date")}</Label>
              <DatePicker
                value={date}
                onChange={(v) => setDate(v ?? "")}
                placeholder={t("events.fields.date")}
                className="border border-border rounded-md bg-input/60"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("events.fields.endDate")}</Label>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                placeholder={t("events.fields.endDateOptional")}
                className="border border-border rounded-md bg-input/60"
              />
            </div>
          </div>

          {/* 이벤트 타입 — 아이콘 그리드 */}
          <div className="space-y-1.5">
            <Label>{t("events.fields.type")}</Label>
            <div className="grid grid-cols-3 gap-2">
              {EVENT_TYPE_LIST.map((type) => {
                const cfg = EVENT_TYPES[type];
                const Icon = cfg.icon;
                const active = eventType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setEventType(type);
                      /* 타입 변경 시 기본 색상 제안 (사용자가 아직 바꾸지 않았다면) */
                      if (!EVENT_COLORS.every((c) => c !== color) || EVENT_TYPE_LIST.some((t) => EVENT_TYPES[t].defaultColor === color)) {
                        setColor(cfg.defaultColor);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-all",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t(cfg.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 색상 팔레트 */}
          <div className="space-y-1.5">
            <Label>{t("events.fields.color")}</Label>
            <div className="flex items-center gap-2">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : undefined }}
                  aria-label={t("common.colorLabel", { color: c })}
                >
                  {color === c && <Check className="h-4 w-4 text-white" />}
                </button>
              ))}
            </div>
          </div>

          {/* 참여자 + 전역 토글 — 프로젝트 모드에서만 (me 모드는 본인 한정이라 의미 없음) */}
          {!isMe && (
            <>
              <div className="space-y-1">
                <Label>{t("events.fields.participants")}</Label>
                <AssigneePicker
                  members={members}
                  currentIds={participants}
                  currentDetails={null}
                  onChange={setParticipants}
                  className="w-full justify-start"
                />
              </div>

              <button
                type="button"
                onClick={() => setIsGlobal((v) => !v)}
                className={cn(
                  "flex items-center gap-2 w-full rounded-lg border px-3 py-2 text-sm transition-all",
                  isGlobal
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                )}
              >
                <Users className="h-4 w-4 shrink-0" />
                <div className="flex-1 text-left">
                  <div className="font-medium">{t("events.fields.global")}</div>
                  <div className="text-2xs opacity-70">{t("events.fields.globalHint")}</div>
                </div>
                <div className={cn(
                  "h-5 w-9 rounded-full border flex items-center px-0.5",
                  isGlobal ? "bg-primary border-primary" : "bg-muted/40 border-border"
                )}>
                  <div className={cn(
                    "h-4 w-4 rounded-full transition-all",
                    isGlobal ? "translate-x-4 bg-primary-foreground" : "bg-muted-foreground/60"
                  )} />
                </div>
              </button>
            </>
          )}

          {/* 설명 */}
          <div className="space-y-1">
            <Label htmlFor="event-desc">{t("events.fields.description")}</Label>
            <textarea
              id="event-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={t("events.fields.descriptionPlaceholder")}
              className="flex w-full rounded-md border border-border bg-input/60 px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-ring/60 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          {isEdit && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {t("events.delete")}
            </Button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("events.cancel")}
            </Button>
            <Button type="button" onClick={submit} disabled={!title.trim() || !date || createMutation.isPending || updateMutation.isPending}>
              {isEdit ? t("events.save") : t("events.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
