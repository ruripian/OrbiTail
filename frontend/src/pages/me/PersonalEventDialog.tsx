/** 개인 일정 추가/편집 다이얼로그 — title/date/end_date/type/color/description */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { meApi } from "@/api/me";
import type { PersonalEvent } from "@/types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TYPES: PersonalEvent["event_type"][] = ["task", "meeting", "deadline", "reminder", "other"];
const PRESET_COLORS = ["#5E6AD2", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#64748b"];

interface Props {
  open: boolean;
  onClose: () => void;
  /** 편집 모드. 없으면 신규 생성. */
  event?: PersonalEvent | null;
  /** 신규 생성 시 기본 날짜(셀 클릭 등). */
  defaultDate?: string;
}

export function PersonalEventDialog({ open, onClose, event, defaultDate }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [type, setType] = useState<PersonalEvent["event_type"]>("other");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title);
      setDate(event.date);
      setEndDate(event.end_date ?? "");
      setType(event.event_type);
      setColor(event.color);
      setDescription(event.description);
    } else {
      setTitle("");
      setDate(defaultDate ?? new Date().toISOString().slice(0, 10));
      setEndDate("");
      setType("other");
      setColor(PRESET_COLORS[0]);
      setDescription("");
    }
  }, [open, event, defaultDate]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["me", "personal-events"] });
    qc.invalidateQueries({ queryKey: ["me", "events"] });
  };

  const createMutation = useMutation({
    mutationFn: () => meApi.personalEvents.create({
      title, date, end_date: endDate || null, event_type: type, color, description,
    }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: () => toast.error(t("me.event.toast.createFailed", "일정 생성에 실패했습니다.")),
  });

  const updateMutation = useMutation({
    mutationFn: () => meApi.personalEvents.update(event!.id, {
      title, date, end_date: endDate || null, event_type: type, color, description,
    }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: () => toast.error(t("me.event.toast.updateFailed", "일정 수정에 실패했습니다.")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => meApi.personalEvents.delete(event!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: () => toast.error(t("me.event.toast.deleteFailed", "일정 삭제에 실패했습니다.")),
  });

  const submit = () => {
    if (!title.trim() || !date) return;
    if (event) updateMutation.mutate();
    else createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {event ? t("me.event.editTitle", "일정 수정") : t("me.event.newTitle", "새 일정")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">{t("me.event.title", "제목")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("me.event.date", "시작일")}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t("me.event.endDate", "종료일 (선택)")}</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("me.event.type", "유형")}</Label>
            <select
              className="w-full text-sm rounded-md border border-border bg-background px-3 py-2"
              value={type}
              onChange={(e) => setType(e.target.value as PersonalEvent["event_type"])}
            >
              {TYPES.map((tp) => (
                <option key={tp} value={tp}>{t(`me.event.types.${tp}`, tp)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">{t("me.event.color", "색상")}</Label>
            <div className="flex gap-1.5 mt-1">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={"w-6 h-6 rounded-full transition-transform " + (color === c ? "ring-2 ring-offset-2 ring-foreground scale-110" : "")}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("me.event.description", "메모 (선택)")}</Label>
            <textarea
              className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 min-h-[64px] resize-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-between gap-2 mt-2">
          {event ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {t("common.delete", "삭제")}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t("common.cancel", "취소")}
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={!title.trim() || !date || createMutation.isPending || updateMutation.isPending}
            >
              {event ? t("common.save", "저장") : t("common.create", "생성")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
