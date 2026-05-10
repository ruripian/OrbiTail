/** 마이 캘린더 탭 — 본인 이슈(start/due) + 본인 참여 ProjectEvent + 개인 PersonalEvent 통합.
 *
 * 시각/주행/bar/chip/드래그 시스템: 프로젝트 CalendarView 와 같은 <CalendarMonth /> 재사용.
 * 설정 토글: 같은 <CalendarSettingsPanel /> 재사용 (chip ↔ bar / 주말 / 이벤트 / 완료).
 *
 * 어댑테이션:
 *   - me API 사용 (다중 워크스페이스 통합)
 *   - PersonalEvent 를 ProjectEvent shape 로 normalize 해서 events 레이어에 통합
 *   - mutation 분기 — 항목 ID 로 personal/project_event/issue 구분 후 적절한 endpoint 호출
 *   - 권한은 항상 true (백엔드 검증 + 403 시 toast)
 *   - drawer/멤버 필터 없음 (마이 페이지엔 의미 없음)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Settings2, FolderOpen, Check } from "lucide-react";
import { meApi } from "@/api/me";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIssueDialogStore } from "@/stores/issueDialogStore";
import { EventDialog } from "@/components/events/EventDialog";
import { CalendarMonth } from "@/pages/project/views/CalendarMonth";
import { CalendarSettingsPanel } from "@/pages/project/views/CalendarView";
import { buildProjectColorMap } from "@/lib/projectColors";
import { cn } from "@/lib/utils";
import type { CalendarSettings } from "@/hooks/useViewSettings";
import type { Issue, ProjectEvent, PersonalEvent } from "@/types";

const PROJECT_FILTER_KEY = "orbitail_me_cal_projects";
const SETTINGS_KEY = "orbitail_me_cal_settings";

const MONTH_KEYS = ["calendar.jan","calendar.feb","calendar.mar","calendar.apr","calendar.may","calendar.jun","calendar.jul","calendar.aug","calendar.sep","calendar.oct","calendar.nov","calendar.dec"] as const;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** PersonalEvent 를 ProjectEvent shape 로 변환 — events 레이어 통합용.
 *  마이 페이지는 워크스페이스/프로젝트 무관 항목이라 빈 값으로 채움. */
function normalizePersonalEvent(pe: PersonalEvent): ProjectEvent {
  return {
    id: pe.id,
    project: "",
    project_workspace_slug: "",
    project_name: "",
    title: pe.title,
    date: pe.date,
    end_date: pe.end_date,
    event_type: pe.event_type,
    color: pe.color,
    description: pe.description,
    is_global: false,
    participants: [],
    participant_details: [],
    created_by: null,
    created_by_detail: null,
    created_at: pe.created_at,
    updated_at: pe.updated_at,
  };
}

/** 마이 페이지 디폴트 settings — alwaysExpand=true (본인 일정은 한눈에 bar 로). */
const DEFAULT_SETTINGS: CalendarSettings = {
  showCompleted: false,
  hideWeekends: false,
  showEvents: true,
  alwaysExpand: true,
  showFields: false,
};

export function MyCalendarTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const today = new Date();
  const todayKey = dateKey(today);
  const openIssueDialog = useIssueDialogStore((s) => s.openIssue);
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  /* settings — localStorage 영속. 일부 필드만 저장된 구버전과의 호환을 위해 DEFAULT 와 spread merge. */
  const [settings, setSettings] = useState<CalendarSettings>(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {}
    return DEFAULT_SETTINGS;
  });
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  /* 프로젝트 필터 — null=전체, Set=명시적 선택. localStorage 영속 */
  const [selectedProjects, setSelectedProjects] = useState<Set<string> | null>(() => {
    try {
      const raw = localStorage.getItem(PROJECT_FILTER_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch {}
    return null;
  });
  useEffect(() => {
    try {
      if (selectedProjects === null) localStorage.removeItem(PROJECT_FILTER_KEY);
      else localStorage.setItem(PROJECT_FILTER_KEY, JSON.stringify(Array.from(selectedProjects)));
    } catch {}
  }, [selectedProjects]);

  /* settings 패널 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  /* 이벤트 다이얼로그 — mode/ws/proj/event 동적 (ProjectEvent vs PersonalEvent) */
  const [eventDialog, setEventDialog] = useState<{
    open: boolean;
    mode: "project" | "me";
    workspaceSlug?: string;
    projectId?: string;
    event: ProjectEvent | PersonalEvent | null;
    defaultDate?: string;
  }>({ open: false, mode: "me", event: null });

  /* 데이터 fetch — me API (현재 ws 한정).
     refetchOnMount:"always" — 글로벌 staleTime(60s) 안에 다른 페이지 갔다와도 항상 최신화.
     다른 곳에서 본인 이슈/이벤트 변경 시 me cache 자동 invalidate 가 어려워 마운트 강제 refetch 가 안전. */
  const { data: issues = [], isLoading: loadingIssues } = useQuery({
    queryKey: ["me", "issues", "calendar", workspaceSlug],
    queryFn: () => meApi.issues(workspaceSlug, { include_completed: true }),
    enabled: !!workspaceSlug,
    refetchOnMount: "always",
  });

  /* 이벤트는 표시 월 ± 한 주 정도 범위로 fetch (CalendarMonth 가 6주 그리드를 그리므로) */
  const monthFromKey = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay() - 7);
    return dateKey(start);
  }, [year, month]);
  const monthToKey = useMemo(() => {
    const last = new Date(year, month + 1, 0);
    const end = new Date(last);
    end.setDate(end.getDate() + (6 - end.getDay()) + 7);
    return dateKey(end);
  }, [year, month]);

  const { data: projectEvents = [], isLoading: loadingProj } = useQuery({
    queryKey: ["me", "events", "calendar", workspaceSlug, monthFromKey, monthToKey],
    queryFn: () => meApi.projectEvents(workspaceSlug, { from: monthFromKey, to: monthToKey }),
    enabled: !!workspaceSlug,
    refetchOnMount: "always",
  });
  const { data: personalEvents = [], isLoading: loadingPersonal } = useQuery({
    queryKey: ["me", "personal-events", workspaceSlug, monthFromKey, monthToKey],
    queryFn: () => meApi.personalEvents.list(workspaceSlug, { from: monthFromKey, to: monthToKey }),
    enabled: !!workspaceSlug,
    refetchOnMount: "always",
  });

  /* PersonalEvent IDs — 항목 종류 구분용 */
  const personalIds = useMemo(() => new Set(personalEvents.map((pe) => pe.id)), [personalEvents]);

  /* 통합 events — CalendarMonth 의 events prop 으로 전달 */
  const normalizedEvents = useMemo<ProjectEvent[]>(() => {
    return [...projectEvents, ...personalEvents.map(normalizePersonalEvent)];
  }, [projectEvents, personalEvents]);

  /* ── mutations — 항목 종류별 ────────────────────────────── */
  const issueMutation = useMutation({
    mutationFn: ({ workspaceSlug, projectId, id, data }: { workspaceSlug: string; projectId: string; id: string; data: Partial<Issue> }) =>
      issuesApi.update(workspaceSlug, projectId, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "issues"] });
    },
    onError: () => {
      toast.error(t("me.calendar.toast.updateFailed", "일정 수정에 실패했습니다"));
    },
  });

  const projectEventMutation = useMutation({
    mutationFn: ({ workspaceSlug, projectId, id, data }: { workspaceSlug: string; projectId: string; id: string; data: Partial<ProjectEvent> }) =>
      projectsApi.events.update(workspaceSlug, projectId, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "events"] });
    },
    onError: () => {
      toast.error(t("me.calendar.toast.eventUpdateFailed", "이벤트 수정 권한이 없습니다"));
    },
  });

  const personalMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PersonalEvent> }) =>
      meApi.personalEvents.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "personal-events"] });
    },
    onError: () => {
      toast.error(t("me.calendar.toast.updateFailed", "일정 수정에 실패했습니다"));
    },
  });

  /* ── CalendarMonth 콜백들 ───────────────────────────────── */
  const handleIssueClick = (id: string) => {
    const issue = issues.find((i) => i.id === id);
    if (issue && issue.workspace_slug) {
      openIssueDialog(issue.workspace_slug, issue.project, id);
    }
  };

  const handleIssueUpdate = (id: string, data: Partial<Issue>) => {
    const issue = issues.find((i) => i.id === id);
    if (!issue || !issue.workspace_slug) return;
    issueMutation.mutate({
      workspaceSlug: issue.workspace_slug,
      projectId: issue.project,
      id,
      data,
    });
  };

  const handleEventUpdate = (id: string, data: Partial<ProjectEvent>) => {
    if (personalIds.has(id)) {
      /* PersonalEvent — date/end_date 만 추출 (다른 ProjectEvent 전용 필드는 무시) */
      personalMutation.mutate({
        id,
        data: { date: data.date, end_date: data.end_date },
      });
    } else {
      const pe = projectEvents.find((e) => e.id === id);
      if (!pe || !pe.project_workspace_slug) return;
      projectEventMutation.mutate({
        workspaceSlug: pe.project_workspace_slug,
        projectId: pe.project,
        id,
        data,
      });
    }
  };

  const handleEventEdit = (event: ProjectEvent) => {
    if (personalIds.has(event.id)) {
      const pe = personalEvents.find((e) => e.id === event.id);
      if (pe) {
        setEventDialog({ open: true, mode: "me", workspaceSlug, event: pe });
      }
    } else {
      const pe = projectEvents.find((e) => e.id === event.id);
      if (pe && pe.project_workspace_slug) {
        setEventDialog({
          open: true,
          mode: "project",
          workspaceSlug: pe.project_workspace_slug,
          projectId: pe.project,
          event: pe,
        });
      }
    }
  };

  const handleEventCreate = (dayKey: string) => {
    /* 마이 페이지 셀 호버 → 현재 ws 의 PersonalEvent 만 새로 만듬 */
    setEventDialog({ open: true, mode: "me", workspaceSlug, event: null, defaultDate: dayKey });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* 본인 항목에 등장하는 unique 프로젝트 — 색 결정 + 필터 드롭다운 양쪽에 사용 */
  const uniqueProjects = useMemo(() => {
    const m = new Map<string, { id: string; name: string; icon_prop: Record<string, unknown> | null | undefined; count: number }>();
    for (const issue of issues) {
      if (!issue.project) continue;
      const cur = m.get(issue.project);
      if (cur) {
        cur.count++;
      } else {
        m.set(issue.project, {
          id: issue.project,
          name: issue.project_name ?? "",
          icon_prop: issue.project_icon_prop ?? null,
          count: 1,
        });
      }
    }
    for (const ev of projectEvents) {
      if (!ev.project) continue;
      const cur = m.get(ev.project);
      if (cur) {
        cur.count++;
      } else {
        m.set(ev.project, {
          id: ev.project,
          name: ev.project_name ?? "",
          icon_prop: ev.project_icon_prop ?? null,
          count: 1,
        });
      }
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [issues, projectEvents]);

  /* 프로젝트 ID → 색 — icon_prop.color 우선 + 충돌 시 hash fallback */
  const projectColorMap = useMemo(() => buildProjectColorMap(uniqueProjects), [uniqueProjects]);

  /* 필터 헬퍼 */
  const isProjectVisible = (projectId: string): boolean => {
    return selectedProjects === null || selectedProjects.has(projectId);
  };
  const toggleProject = (id: string) => {
    setSelectedProjects((cur) => {
      /* null(전체)에서 첫 토글 시 — 그 항목만 빼고 나머지 다 선택된 Set 으로 시작 */
      const base = cur ?? new Set(uniqueProjects.map((p) => p.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      /* 모두 선택되면 null(전체) 로 정규화 — localStorage 가벼워짐 */
      if (next.size === uniqueProjects.length) return null;
      return next;
    });
  };
  const selectAllProjects = () => setSelectedProjects(null);
  const clearAllProjects = () => setSelectedProjects(new Set());

  /* ── 필터링 — settings + 프로젝트 필터 적용 (드래그 미리보기는 CalendarMonth 내부) ── */
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (!issue.start_date && !issue.due_date) return false;
      if (!settings.showCompleted) {
        const grp = issue.state_detail?.group;
        if (grp === "completed" || grp === "cancelled") return false;
      }
      if (!isProjectVisible(issue.project)) return false;
      return true;
    });
  }, [issues, settings.showCompleted, selectedProjects]);

  const filteredEvents = useMemo(() => {
    if (!settings.showEvents) return [];
    /* PersonalEvent 는 project 가 빈 문자열 — 항상 표시. ProjectEvent 는 필터 적용 */
    return normalizedEvents.filter((ev) => {
      if (!ev.project) return true;
      return isProjectVisible(ev.project);
    });
  }, [normalizedEvents, settings.showEvents, selectedProjects]);

  /* 상태 ID → 색상 맵 — me API 가 issue.state_detail 채워주므로 거기서 추출 */
  const stateColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const issue of issues) {
      if (issue.state_detail) m[issue.state] = issue.state_detail.color;
    }
    return m;
  }, [issues]);

  /* 월 네비 */
  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  };

  /* settings 변경 헬퍼 */
  const updateSettings = (patch: Partial<CalendarSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  };

  const isLoading = loadingIssues || loadingProj || loadingPersonal;

  return (
    <div className="flex flex-col h-full">
      {/* ── 헤더 ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <button
          onClick={prevMonth}
          className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-base font-semibold tabular-nums px-1 min-w-[8rem] text-center">
          {t(MONTH_KEYS[month])} {year}
        </h2>
        <button
          onClick={nextMonth}
          className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <Button variant="ghost" size="sm" onClick={goToday}>
          {t("calendar.today", "오늘")}
        </Button>

        <div className="ml-auto flex items-center gap-1">
          {/* 프로젝트 필터 — 본인 항목이 등장한 프로젝트만 노출. 외곽선 색 + 체크박스 */}
          {uniqueProjects.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "h-8 px-2.5 rounded-md text-xs font-medium border flex items-center gap-1.5 transition-colors",
                    selectedProjects === null
                      ? "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      : "bg-primary/10 border-primary/40 text-primary"
                  )}
                  title={t("me.calendar.projectFilter", "프로젝트 필터")}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {selectedProjects === null
                    ? t("me.calendar.projects", "프로젝트")
                    : `${t("me.calendar.projects", "프로젝트")} ${selectedProjects.size}/${uniqueProjects.length}`}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto w-56">
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); selectAllProjects(); }} className="text-xs">
                  {t("me.calendar.selectAll", "전체 선택")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); clearAllProjects(); }} className="text-xs">
                  {t("me.calendar.clearAll", "전체 해제")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {uniqueProjects.map((p) => {
                  const checked = isProjectVisible(p.id);
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onSelect={(e) => { e.preventDefault(); toggleProject(p.id); }}
                      className="text-xs gap-2 cursor-pointer"
                    >
                      <span
                        className="h-3 w-3 rounded-sm shrink-0 border"
                        style={{ backgroundColor: projectColorMap[p.id], borderColor: projectColorMap[p.id] }}
                      />
                      <span className="truncate flex-1">{p.name || p.id.slice(0, 6)}</span>
                      {checked && <Check className="h-3 w-3 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="sm" onClick={() => handleEventCreate(todayKey)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("me.calendar.newEvent", "새 이벤트")}
          </Button>
          <div className="relative">
            <button
              ref={settingsBtnRef}
              onClick={() => setSettingsOpen((v) => !v)}
              className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center transition-colors",
                settingsOpen
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              title={t("calendar.settings.title", "설정")}
            >
              <Settings2 className="h-4 w-4" />
            </button>
            {settingsOpen && (
              <CalendarSettingsPanel
                settings={settings}
                onChange={updateSettings}
                onClose={() => setSettingsOpen(false)}
                triggerRef={settingsBtnRef}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── 캘린더 본체 ──────────────────────────────────── */}
      {isLoading ? (
        <Skeleton className="flex-1 rounded-md" />
      ) : (
        <div className="flex-1 rounded-md border border-border bg-card overflow-hidden flex flex-col">
          <CalendarMonth
            year={year}
            month={month}
            issues={filteredIssues}
            events={filteredEvents}
            stateColorMap={stateColorMap}
            settings={settings}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
            canSchedule={true}
            onIssueClick={handleIssueClick}
            onIssueUpdate={handleIssueUpdate}
            onEventUpdate={handleEventUpdate}
            onEventCreate={handleEventCreate}
            onEventEdit={handleEventEdit}
            projectColorMap={projectColorMap}
          />
        </div>
      )}

      <EventDialog
        open={eventDialog.open}
        onOpenChange={(open) => {
          setEventDialog((s) => ({ ...s, open }));
          /* 다이얼로그 close 시 me 캐시 강제 갱신 — EventDialog 는 me 캐시 존재를 모름 */
          if (!open) {
            qc.invalidateQueries({ queryKey: ["me", "events"] });
            qc.invalidateQueries({ queryKey: ["me", "personal-events"] });
          }
        }}
        mode={eventDialog.mode}
        workspaceSlug={eventDialog.workspaceSlug}
        projectId={eventDialog.projectId}
        event={eventDialog.event}
        defaultDate={eventDialog.defaultDate}
      />
    </div>
  );
}
