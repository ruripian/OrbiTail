/**
 * 뷰 별 사용자 설정을 localStorage에 저장/로드하는 훅
 * Calendar / Timeline 뷰의 표시 옵션을 관리한다
 */

import { useState, useCallback } from "react";

export interface CalendarSettings {
  showCompleted:  boolean; // 완료 이슈 표시
  hideWeekends:   boolean; // 토/일 컬럼 숨기기
  showEvents:     boolean; // 프로젝트 캘린더 이벤트 표시
  alwaysExpand:   boolean; // 기간이 있는 이슈를 항상 bar로 확장 표시
  showFields:     boolean; // 필드(Field) 이슈 표시 — 기본 꺼짐
}

export interface TimelineSettings {
  scale:         "day" | "week" | "month"; // 타임라인 열 단위
  showCompleted: boolean;
  showNoDate:    boolean;
  hideWeekends:  boolean; // day scale에서 주말 컬럼 건너뛰기
  /** 이벤트 자체는 항상 표시. 지난 이벤트만 숨길지 여부. 기본 false (전부 표시). */
  hidePastEvents: boolean;
  groupBy:       "none" | "state" | "priority" | "category" | "sprint"; // 그룹화 기준
}

interface AllSettings {
  calendar: CalendarSettings;
  timeline: TimelineSettings;
}

const DEFAULTS: AllSettings = {
  calendar: { showCompleted: true, hideWeekends: false, showEvents: true, alwaysExpand: false, showFields: false },
  timeline: { scale: "day", showCompleted: false, showNoDate: false, hideWeekends: false, hidePastEvents: false, groupBy: "none" },
};

const KEY = "orbitail_view_settings";

function loadSettings(): AllSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULTS;
}

function saveSettings(s: AllSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function useViewSettings() {
  const [settings, setSettings] = useState<AllSettings>(loadSettings);

  const updateCalendar = useCallback((partial: Partial<CalendarSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, calendar: { ...prev.calendar, ...partial } };
      saveSettings(next);
      return next;
    });
  }, []);

  const updateTimeline = useCallback((partial: Partial<TimelineSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, timeline: { ...prev.timeline, ...partial } };
      saveSettings(next);
      return next;
    });
  }, []);

  return { settings, updateCalendar, updateTimeline };
}
