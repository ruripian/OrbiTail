/**
 * DatePicker — 커스텀 달력 UI
 *
 * 디자인:
 *  - 구글 캘린더처럼 월 단위 그리드
 *  - 글라스모피즘 + 게임 UI 느낌 (backdrop-blur, 반투명 패널, 골드 강조)
 *  - 오늘 날짜 골드 링 강조
 *  - 선택된 날짜 골드 채움 원
 *  - fixed 좌표 팝오버 → overflow:hidden 테이블에서도 잘림 없음
 *  - Escape 키 / 바깥 클릭으로 닫기
 *
 * 사용:
 *  <DatePicker value={issue.due_date} onChange={(v) => update({ due_date: v })} />
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Z_DATEPICKER } from "@/constants/z-index";

export interface DatePickerProps {
  value:        string | null;
  onChange:     (date: string | null) => void;
  placeholder?: string;
  /** 날짜가 지났을 때 텍스트 색상 클래스 (선택) */
  overdueClass?: string;
  className?:   string;
  /** 기준 날짜 힌트 — 이 날짜 이전(before) 또는 이후(after)를 흐림 처리 */
  hintDate?:    string | null;
  /** hintDate 기준 흐림 방향: "before" = hintDate 이전 흐림, "after" = hintDate 이후 흐림 */
  hintMode?:    "before" | "after";
}

export function DatePicker({
  value, onChange, placeholder, overdueClass, className, hintDate, hintMode,
}: DatePickerProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("datePicker.placeholder");

  const WEEKDAYS = [t("datePicker.sun"), t("datePicker.mon"), t("datePicker.tue"), t("datePicker.wed"), t("datePicker.thu"), t("datePicker.fri"), t("datePicker.sat")];
  const MONTHS = Array.from({ length: 12 }, (_, i) => t(`datePicker.month${i + 1}`));
  const [open, setOpen]     = useState(false);
  const [pos,  setPos]      = useState({ top: 0, left: 0, openUp: false });
  const [viewDate, setViewDate] = useState<Date>(new Date());

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);

  /* 선택된 날짜 파싱 */
  const selectedDate = value ? (() => {
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  })() : null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  /* hintDate 파싱 — 시작일/마감일 간 상대 흐림 처리용 */
  const parsedHint = hintDate ? (() => {
    const [y, m, d] = hintDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  })() : null;

  /* 달력 열기 — trigger 위치 기준으로 팝오버 위치 계산 */
  const openCalendar = () => {
    if (!triggerRef.current) return;
    const rect       = triggerRef.current.getBoundingClientRect();
    const panelH     = 300; // 예상 패널 높이
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp     = spaceBelow < panelH && rect.top > panelH;

    setPos({
      top:    openUp ? rect.top - panelH - 4 : rect.bottom + 4,
      left:   Math.min(rect.left, window.innerWidth - 260),
      openUp,
    });

    /* viewDate를 선택값 또는 오늘 기준으로 초기화 */
    if (value) {
      const [y, m] = value.split("-").map(Number);
      setViewDate(new Date(y, m - 1, 1));
    } else {
      setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
    }
    setOpen(true);
  };

  /* 바깥 클릭 / Escape 닫기 */
  useEffect(() => {
    if (!open) return;
    const onKey   = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouse);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouse);
    };
  }, [open]);

  /* 달력 날짜 배열 */
  const getDays = useCallback(() => {
    const year     = viewDate.getFullYear();
    const month    = viewDate.getMonth();
    const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInM  = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = Array(firstDow).fill(null);
    for (let i = 1; i <= daysInM; i++) days.push(i);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [viewDate]);

  /* 날짜 선택 */
  const selectDay = (day: number) => {
    const y = String(viewDate.getFullYear());
    const m = String(viewDate.getMonth() + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    onChange(`${y}-${m}-${d}`);
    setOpen(false);
  };

  /* 트리거 버튼에 표시할 날짜 — yyyy.mm.dd */
  const displayValue = value ? (() => {
    const [y, m, d] = value.split("-").map(Number);
    return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
  })() : null;

  const days = getDays();

  return (
    <>
      {/* ── 트리거 버튼 + 날짜 지우기 ── */}
      <div className={cn("flex items-center group/date w-full", className)}>
        <button
          type="button"
          ref={triggerRef}
          onClick={(e) => {
            e.stopPropagation();
            open ? setOpen(false) : openCalendar();
          }}
          className={cn(
            "flex items-center gap-1 text-xs rounded-lg px-2 py-1 transition-all duration-fast flex-1 text-left min-h-[28px]",
            "hover:bg-primary/15 hover:text-primary hover:shadow-sm",
            displayValue ? (overdueClass ?? "text-foreground") : "text-muted-foreground/40",
            open && "bg-primary/15 text-primary",
          )}
        >
          {displayValue ?? <span className="opacity-40">{resolvedPlaceholder}</span>}
        </button>
        {displayValue && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="p-1 rounded-md opacity-0 group-hover/date:opacity-100 transition-opacity text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 shrink-0"
            title={t("datePicker.clear")}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* ── 달력 팝오버 — body에 포탈로 렌더 (Dialog/backdrop-filter containing block 회피) ── */}
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed w-60 select-none pointer-events-auto"
          style={{ top: pos.top, left: pos.left, zIndex: Z_DATEPICKER }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* 글라스 패널 */}
          <div className="rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
               style={{
                 background: "var(--glass-bg)",
                 boxShadow: "var(--glass-shadow)",
               }}
          >

            {/* ── 헤더: 월 이동 ── */}
            <div className="flex items-center justify-between px-4 py-3"
                 style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
            >
              <button
                onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
                className="p-1 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              <span className="text-sm font-bold tracking-wide">
                {viewDate.getFullYear()}{" "}
                <span className="text-primary">{MONTHS[viewDate.getMonth()]}</span>
              </span>

              <button
                onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
                className="p-1 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* ── 요일 헤더 — 토/일 색상 구분 강화 ── */}
            <div className="grid grid-cols-7 px-3 pt-2.5 pb-1">
              {WEEKDAYS.map((wd, i) => (
                <div
                  key={wd}
                  className={cn(
                    "text-center text-2xs font-bold pb-1 uppercase tracking-wider",
                    i === 0 ? "text-rose-500"   : "",
                    i === 6 ? "text-sky-500"    : "",
                    i !== 0 && i !== 6 ? "text-muted-foreground/70" : ""
                  )}
                >
                  {wd}
                </div>
              ))}
            </div>

            {/* ── 날짜 그리드 ── */}
            <div className="grid grid-cols-7 gap-y-0.5 px-3 pb-2">
              {days.map((day, i) => {
                if (!day) return <div key={`e-${i}`} className="h-8" />;

                const thisDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
                thisDate.setHours(0, 0, 0, 0);
                const isToday    = thisDate.getTime() === today.getTime();
                const isSelected = !!selectedDate && thisDate.getTime() === selectedDate.getTime();
                const dow        = i % 7; // 0=일, 6=토

                /* hintDate 기반 흐림 — 선택 불가가 아닌 시각 힌트 */
                const isHinted = parsedHint && !isSelected && !isToday && (
                  (hintMode === "before" && thisDate < parsedHint) ||
                  (hintMode === "after"  && thisDate > parsedHint)
                );

                /* 주말 배경 tint — 시각 구분 강화 */
                const weekendBg = !isSelected && !isToday
                  ? (dow === 0 ? "bg-rose-500/[0.06]" : dow === 6 ? "bg-sky-500/[0.06]" : "")
                  : "";

                return (
                  <button
                    key={`d-${i}`}
                    onClick={() => selectDay(day)}
                    className={cn(
                      "h-9 w-full rounded-xl text-sm transition-all duration-100 flex items-center justify-center font-medium",
                      isSelected
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/40 scale-105 ring-1 ring-primary/30"
                        : isToday
                          ? "ring-2 ring-primary text-primary bg-primary/10"
                          : isHinted
                            ? "text-muted-foreground/40 hover:bg-white/8 hover:text-muted-foreground"
                            : "hover:bg-primary/10 hover:text-primary",
                      /* 일요일 */
                      !isSelected && !isToday && dow === 0 && !isHinted ? "text-rose-500" : "",
                      /* 토요일 */
                      !isSelected && !isToday && dow === 6 && !isHinted ? "text-sky-500" : "",
                      /* 주말 배경 tint */
                      weekendBg,
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            {/* ── 하단 액션 ── */}
            <div
              className="flex items-center justify-between px-3 pb-3 pt-1 gap-2"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              {/* 오늘로 이동 */}
              <button
                onClick={() => {
                  const y = String(today.getFullYear());
                  const m = String(today.getMonth() + 1).padStart(2, "0");
                  const d = String(today.getDate()).padStart(2, "0");
                  onChange(`${y}-${m}-${d}`);
                  setOpen(false);
                }}
                className="text-xs text-primary/70 hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-primary/10 font-medium"
              >
                {t("datePicker.today")}
              </button>

              {/* 지우기 */}
              {value && (
                <button
                  onClick={() => { onChange(null); setOpen(false); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-destructive transition-colors px-2 py-1 rounded-lg hover:bg-destructive/10"
                >
                  <X className="h-3 w-3" />
                  {t("datePicker.clear")}
                </button>
              )}
            </div>

          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
