/**
 * 팀 캘린더 — TeamDetailPage 안에서 사용.
 *
 * MyCalendarTab 와 유사하나 차이점:
 *   - 데이터: teamsApi.calendar.* (요청자별 비공개 프로젝트 필터)
 *   - 추가 필터: 팀 멤버 칩 토글 row (멤버별 표시/숨김)
 *   - 멤버 색 dot/border: 후속 phase (이번엔 기본 시각 유지)
 *
 * 정책 메모:
 *   - issues: 팀원이 담당자인 이슈 — 공개 프로젝트는 전체 팀원, 비공개는 팀장/본인만
 *   - personalEvents: 팀원이 shared_with_team=True 로 공유한 PE (편집/이동은 본인 것만)
 *   - projectEvents: 팀원이 멤버인 프로젝트 — 공개는 전체, 비공개는 팀장/본인만
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Settings2, FolderOpen, Check } from "lucide-react";
import { teamsApi } from "@/api/teams";
import { meApi } from "@/api/me";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/stores/authStore";
import { useIssueDialogStore } from "@/stores/issueDialogStore";
import { EventDialog } from "@/components/events/EventDialog";
import { CalendarMonth } from "@/pages/project/views/CalendarMonth";
import { CalendarSettingsPanel } from "@/pages/project/views/CalendarView";
import { ProjectIcon } from "@/components/ui/project-icon-picker";
import { cn } from "@/lib/utils";
import type { CalendarSettings } from "@/hooks/useViewSettings";
import type { Issue, ProjectEvent, PersonalEvent, TeamMember } from "@/types";

const MONTH_KEYS = [
  "calendar.jan", "calendar.feb", "calendar.mar", "calendar.apr",
  "calendar.may", "calendar.jun", "calendar.jul", "calendar.aug",
  "calendar.sep", "calendar.oct", "calendar.nov", "calendar.dec",
] as const;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** PE → ProjectEvent shape 정규화 (MyCalendarTab 와 동일) */
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
    /* 소유자 id 를 실어 팀 캘린더 멤버 필터가 PE 도 필터할 수 있게 함 */
    created_by: pe.user ?? null,
    created_by_detail: null,
    created_at: pe.created_at,
    updated_at: pe.updated_at,
  };
}

const DEFAULT_SETTINGS: CalendarSettings = {
  showCompleted: false,
  hideWeekends: false,
  showEvents: true,
  alwaysExpand: true,
  showFields: false,
};

export function TeamCalendarSection({
  workspaceSlug, teamId, teamMembers,
}: {
  workspaceSlug: string;
  teamId: string;
  /** 팀 멤버 — 필터 바 + 색 결정에 사용 */
  teamMembers: TeamMember[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const openIssueDialog = useIssueDialogStore((s) => s.openIssue);
  const today = new Date();

  const PROJECT_FILTER_KEY = `orbitail_team_cal_projects_${teamId}`;
  const MEMBER_FILTER_KEY  = `orbitail_team_cal_members_${teamId}`;
  const SETTINGS_KEY       = `orbitail_team_cal_settings_${teamId}`;

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
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
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }, [settings, SETTINGS_KEY]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  /* 프로젝트 필터 — null=전체 */
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
  }, [selectedProjects, PROJECT_FILTER_KEY]);

  /* 멤버 필터 — null=전체. 팀 멤버 user.id 집합 */
  const [selectedMembers, setSelectedMembers] = useState<Set<string> | null>(() => {
    try {
      const raw = localStorage.getItem(MEMBER_FILTER_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch {}
    return null;
  });
  useEffect(() => {
    try {
      if (selectedMembers === null) localStorage.removeItem(MEMBER_FILTER_KEY);
      else localStorage.setItem(MEMBER_FILTER_KEY, JSON.stringify(Array.from(selectedMembers)));
    } catch {}
  }, [selectedMembers, MEMBER_FILTER_KEY]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  const [eventDialog, setEventDialog] = useState<{
    open: boolean;
    mode: "project" | "me";
    workspaceSlug?: string;
    projectId?: string;
    event: ProjectEvent | PersonalEvent | null;
    defaultDate?: string;
  }>({ open: false, mode: "me", event: null });

  /* 표시 월 ± 한 주 범위 — CalendarMonth 가 6주 그리드 */
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

  const { data: issues = [], isLoading: loadingIssues } = useQuery({
    queryKey: ["team", teamId, "issues"],
    queryFn: () => teamsApi.calendar.issues(workspaceSlug, teamId, { include_completed: "true" }),
    refetchOnMount: "always",
  });
  const { data: projectEvents = [], isLoading: loadingProj } = useQuery({
    queryKey: ["team", teamId, "project-events", monthFromKey, monthToKey],
    queryFn: () => teamsApi.calendar.projectEvents(workspaceSlug, teamId, { from: monthFromKey, to: monthToKey }),
    refetchOnMount: "always",
  });
  const { data: personalEvents = [], isLoading: loadingPersonal } = useQuery({
    queryKey: ["team", teamId, "personal-events", monthFromKey, monthToKey],
    queryFn: () => teamsApi.calendar.personalEvents(workspaceSlug, teamId, { from: monthFromKey, to: monthToKey }),
    refetchOnMount: "always",
  });

  const personalIds = useMemo(() => new Set(personalEvents.map((pe) => pe.id)), [personalEvents]);
  /* 본인 소유 PE — 편집/이동은 본인 것만 허용(타인 PE 는 읽기 전용) */
  const ownPersonalIds = useMemo(
    () => new Set(personalEvents.filter((pe) => pe.user === currentUser?.id).map((pe) => pe.id)),
    [personalEvents, currentUser],
  );

  const normalizedEvents = useMemo<ProjectEvent[]>(() => {
    return [...projectEvents, ...personalEvents.map(normalizePersonalEvent)];
  }, [projectEvents, personalEvents]);

  /* ── mutations ─────────────────────────────────────────── */
  const issueMutation = useMutation({
    mutationFn: ({ workspaceSlug, projectId, id, data }: { workspaceSlug: string; projectId: string; id: string; data: Partial<Issue> }) =>
      issuesApi.update(workspaceSlug, projectId, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", teamId, "issues"] }),
    onError: () => toast.error(t("me.calendar.toast.updateFailed", "일정 수정에 실패했습니다")),
  });
  const projectEventMutation = useMutation({
    mutationFn: ({ workspaceSlug, projectId, id, data }: { workspaceSlug: string; projectId: string; id: string; data: Partial<ProjectEvent> }) =>
      projectsApi.events.update(workspaceSlug, projectId, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", teamId, "project-events"] }),
    onError: () => toast.error(t("me.calendar.toast.eventUpdateFailed", "이벤트 수정 권한이 없습니다")),
  });
  const personalMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PersonalEvent> }) =>
      meApi.personalEvents.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", teamId, "personal-events"] }),
    onError: () => toast.error(t("me.calendar.toast.updateFailed", "일정 수정에 실패했습니다")),
  });

  /* ── 콜백 ──────────────────────────────────────────────── */
  const handleIssueClick = (id: string) => {
    const issue = issues.find((i) => i.id === id);
    if (issue && issue.workspace_slug) {
      openIssueDialog(issue.workspace_slug, issue.project, id);
    }
  };
  const handleIssueUpdate = (id: string, data: Partial<Issue>) => {
    const issue = issues.find((i) => i.id === id);
    if (!issue || !issue.workspace_slug) return;
    issueMutation.mutate({ workspaceSlug: issue.workspace_slug, projectId: issue.project, id, data });
  };
  const handleEventUpdate = (id: string, data: Partial<ProjectEvent>) => {
    if (personalIds.has(id)) {
      if (!ownPersonalIds.has(id)) return; // 타인 PE 는 이동 불가
      personalMutation.mutate({ id, data: { date: data.date, end_date: data.end_date } });
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
      if (!ownPersonalIds.has(event.id)) return; // 타인 PE 는 편집 불가
      const pe = personalEvents.find((e) => e.id === event.id);
      if (pe) setEventDialog({ open: true, mode: "me", workspaceSlug, event: pe });
    } else {
      const pe = projectEvents.find((e) => e.id === event.id);
      if (pe && pe.project_workspace_slug) {
        setEventDialog({
          open: true, mode: "project",
          workspaceSlug: pe.project_workspace_slug,
          projectId: pe.project, event: pe,
        });
      }
    }
  };
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* 프로젝트 색 — 등장한 프로젝트만 */
  const uniqueProjects = useMemo(() => {
    const m = new Map<string, { id: string; name: string; icon_prop: Record<string, unknown> | null | undefined; count: number }>();
    for (const issue of issues) {
      if (!issue.project) continue;
      const cur = m.get(issue.project);
      if (cur) cur.count++;
      else m.set(issue.project, {
        id: issue.project,
        name: issue.project_name ?? "",
        icon_prop: issue.project_icon_prop ?? null,
        count: 1,
      });
    }
    for (const ev of projectEvents) {
      if (!ev.project) continue;
      const cur = m.get(ev.project);
      if (cur) cur.count++;
      else m.set(ev.project, {
        id: ev.project,
        name: ev.project_name ?? "",
        icon_prop: ev.project_icon_prop ?? null,
        count: 1,
      });
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [issues, projectEvents]);
  /* 프로젝트 ID → icon_prop / name — CalendarMonth 좌측 배지 렌더용 (색 대신 아이콘). */
  const projectIconMap = useMemo<Record<string, { icon_prop: Record<string, unknown> | null | undefined; name?: string }>>(() => {
    const m: Record<string, { icon_prop: Record<string, unknown> | null | undefined; name?: string }> = {};
    for (const p of uniqueProjects) {
      m[p.id] = { icon_prop: p.icon_prop, name: p.name };
    }
    return m;
  }, [uniqueProjects]);

  /* 필터 헬퍼 */
  /* 아래 useMemo 들의 deps 로 쓰이므로 선택값이 바뀔 때만 새로 만든다 */
  const isProjectVisible = useCallback((projectId: string) =>
    selectedProjects === null || selectedProjects.has(projectId), [selectedProjects]);
  const isMemberVisible = useCallback((userId: string) =>
    selectedMembers === null || selectedMembers.has(userId), [selectedMembers]);

  const toggleProject = (id: string) => {
    setSelectedProjects((cur) => {
      const base = cur ?? new Set(uniqueProjects.map((p) => p.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (next.size === uniqueProjects.length) return null;
      return next;
    });
  };
  const toggleMember = (id: string) => {
    setSelectedMembers((cur) => {
      const base = cur ?? new Set(teamMembers.map((m) => m.member.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (next.size === teamMembers.length) return null;
      return next;
    });
  };

  /* 필터 적용 — 이슈는 멤버 + 프로젝트 둘 다. 이벤트는 프로젝트(PE 는 소유자 멤버 필터). */
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (!issue.start_date && !issue.due_date) return false;
      if (issue.is_field && !settings.showFields) return false;
      if (!settings.showCompleted) {
        const grp = issue.state_detail?.group;
        if (grp === "completed" || grp === "cancelled") return false;
      }
      if (!isProjectVisible(issue.project)) return false;
      // 담당자 중 하나라도 visible 멤버면 표시
      const visibleAssignee = issue.assignees.some((aid) => isMemberVisible(aid));
      if (!visibleAssignee) return false;
      return true;
    });
  }, [issues, settings.showCompleted, settings.showFields, isProjectVisible, isMemberVisible]);

  const filteredEvents = useMemo(() => {
    if (!settings.showEvents) return [];
    return normalizedEvents.filter((ev) => {
      // PE(프로젝트 없음) 는 소유자 멤버 필터로 판별 — 팀원 공유 PE 포함
      if (!ev.project) return ev.created_by ? isMemberVisible(ev.created_by) : true;
      return isProjectVisible(ev.project);
    });
  }, [normalizedEvents, settings.showEvents, isProjectVisible, isMemberVisible]);

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
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  const updateSettings = (patch: Partial<CalendarSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  };

  const isLoading = loadingIssues || loadingProj || loadingPersonal;

  return (
    <div className="glass rounded-xl border overflow-hidden flex flex-col select-none shadow-sm h-[85vh] min-h-[720px]">
      {/* ── 멤버 칩 바 (팀 캘린더 고유) ──────────────────── */}
      {teamMembers.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap px-4 py-2.5 border-b border-border shrink-0">
          <span className="text-2xs text-muted-foreground mr-1">멤버:</span>
          {teamMembers.map((tm) => {
            const visible = isMemberVisible(tm.member.id);
            const isSelf = tm.member.id === currentUser?.id;
            return (
              <button
                key={tm.id}
                onClick={() => toggleMember(tm.member.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2 py-0.5 transition-all",
                  visible
                    ? "bg-primary/5 border-primary/40 text-foreground"
                    : "bg-transparent border-border text-muted-foreground/60 opacity-50",
                )}
                title={visible ? "캘린더에서 숨기기" : "캘린더에 표시"}
              >
                <AvatarInitials name={tm.member.display_name} avatar={tm.member.avatar} size="xs" />
                <span className="text-2xs">{tm.member.display_name}</span>
                {isSelf && <span className="text-2xs text-primary/70 ml-0.5">·나</span>}
              </button>
            );
          })}
          {selectedMembers !== null && (
            <button
              onClick={() => setSelectedMembers(null)}
              className="text-2xs text-muted-foreground hover:text-primary ml-1"
            >
              전체 보기
            </button>
          )}
        </div>
      )}

      {/* ── 헤더 ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border shrink-0">
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
          {uniqueProjects.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "h-8 px-2.5 rounded-md text-xs font-medium border flex items-center gap-1.5 transition-colors",
                    selectedProjects === null
                      ? "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      : "bg-primary/10 border-primary/40 text-primary",
                  )}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {selectedProjects === null
                    ? t("me.calendar.projects", "프로젝트")
                    : `${t("me.calendar.projects", "프로젝트")} ${selectedProjects.size}/${uniqueProjects.length}`}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto w-56">
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSelectedProjects(null); }} className="text-xs">
                  {t("me.calendar.selectAll", "전체 선택")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSelectedProjects(new Set()); }} className="text-xs">
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
                      <span className="shrink-0">
                        <ProjectIcon value={p.icon_prop} size={10} className="!rounded" />
                      </span>
                      <span className="truncate flex-1">{p.name || p.id.slice(0, 6)}</span>
                      {checked && <Check className="h-3 w-3 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="relative">
            <button
              ref={settingsBtnRef}
              onClick={() => setSettingsOpen((v) => !v)}
              className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center transition-colors",
                settingsOpen
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
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

      {/* ── 캘린더 본체 — 카드 내 남은 공간 flex-1 채움 ─── */}
      {isLoading ? (
        <Skeleton className="flex-1 rounded-none" />
      ) : (
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
          onEventEdit={handleEventEdit}
          projectIconMap={projectIconMap}
          showAssignees
        />
      )}

      <EventDialog
        open={eventDialog.open}
        onOpenChange={(open) => {
          setEventDialog((s) => ({ ...s, open }));
          if (!open) {
            qc.invalidateQueries({ queryKey: ["team", teamId, "project-events"] });
            qc.invalidateQueries({ queryKey: ["team", teamId, "personal-events"] });
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
