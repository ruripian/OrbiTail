/**
 * Calendar 뷰 — Google Calendar 스타일 (프로젝트 전용 컨테이너)
 *
 * 책임:
 *   - 데이터 fetch (issues/events/states/members)
 *   - 사용자 필터 (All / Me / 특정 멤버)
 *   - 백로그 drawer (미스케줄 이슈 → 셀 drop)
 *   - settings 패널 (chip ↔ bar / 주말 / 이벤트 / 완료 토글)
 *   - mutation + undo
 *   - 다이얼로그 (이슈/이벤트 생성·편집)
 *
 * 시각/주행/bar overlay/chip/드래그 시스템은 <CalendarMonth /> 가 담당.
 * 마이 페이지(다중 워크스페이스 통합)와 같은 컴포넌트 재사용.
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useIssueRefresh } from "@/hooks/useIssueMutations";
import { useUndoStore } from "@/stores/undoStore";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Settings2, Inbox, GripVertical, X as XIcon, ChevronDown, User as UserIcon, Users } from "lucide-react";
import { useProjectPerms } from "@/hooks/useProjectPerms";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { cn } from "@/lib/utils";
import { Z_SETTINGS_OVERLAY, Z_SETTINGS_PANEL } from "@/constants/z-index";
import type { CalendarSettings } from "@/hooks/useViewSettings";
import type { Issue, ProjectEvent } from "@/types";
import { EventDialog } from "@/components/events/EventDialog";
import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { useAuthStore } from "@/stores/authStore";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CalendarMonth } from "./CalendarMonth";

const MONTH_KEYS = ["calendar.jan","calendar.feb","calendar.mar","calendar.apr","calendar.may","calendar.jun","calendar.jul","calendar.aug","calendar.sep","calendar.oct","calendar.nov","calendar.dec"] as const;

interface SettingsPanelProps {
  settings:  CalendarSettings;
  onChange:  (s: Partial<CalendarSettings>) => void;
  onClose:   () => void;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

export function CalendarSettingsPanel({ settings, onChange, onClose, triggerRef }: SettingsPanelProps) {
  const { t } = useTranslation();
  /* trigger 버튼 좌표 기반 fixed 위치 — containing block 탈출 */
  const rect = triggerRef.current?.getBoundingClientRect();
  const panelW = 240;
  const top = rect ? rect.bottom + 4 : 0;
  const left = rect ? Math.min(rect.right - panelW, window.innerWidth - panelW - 8) : 0;

  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: Z_SETTINGS_OVERLAY }} onClick={onClose} />

      <div
        className="glass fixed w-60 rounded-2xl border border-border shadow-2xl p-4 space-y-3.5 text-sm"
        style={{ top, left, zIndex: Z_SETTINGS_PANEL }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-2xs font-bold uppercase tracking-widest text-muted-foreground/60">
          {t("calendar.settings.title")}
        </p>

        {([
          { key: "showCompleted" as const, label: t("calendar.settings.showCompleted") },
          { key: "hideWeekends"  as const, label: t("calendar.settings.hideWeekends") },
          { key: "showEvents"    as const, label: t("calendar.settings.showEvents") },
          { key: "alwaysExpand"  as const, label: t("calendar.settings.alwaysExpand") },
        ] as const).map(({ key, label }) => (
          <label key={key} className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => onChange({ [key]: !settings[key] })}
              className={cn(
                "h-5 w-9 rounded-full border transition-all duration-base flex items-center px-0.5 shrink-0",
                settings[key]
                  ? "bg-primary border-primary"
                  : "bg-muted/40 border-border group-hover:border-border"
              )}
            >
              <div className={cn(
                "h-4 w-4 rounded-full shadow-sm transition-all duration-base",
                settings[key]
                  ? "translate-x-4 bg-primary-foreground"
                  : "translate-x-0 bg-muted-foreground/60"
              )} />
            </div>
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors leading-tight">
              {label}
            </span>
          </label>
        ))}
      </div>
    </>,
    document.body,
  );
}

interface Props {
  workspaceSlug:    string;
  projectId:        string;
  onIssueClick:     (issueId: string) => void;
  /** 이슈 쿼리 필터 (sprint/category URL 기반 필터) */
  issueFilter?:     Record<string, string>;
  settings:         CalendarSettings;
  onSettingsChange: (s: Partial<CalendarSettings>) => void;
}

export function CalendarView({ workspaceSlug, projectId, onIssueClick, issueFilter, settings, onSettingsChange }: Props) {
  const { t } = useTranslation();
  const today  = new Date();

  const [year,         setYear]         = useState(today.getFullYear());
  const [month,        setMonth]        = useState(today.getMonth());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();
  const { perms } = useProjectPerms();
  const canSchedule = !!perms.can_schedule;

  /* drawer 설정 — projectId 별 localStorage 영속 */
  const DRAWER_KEY = `orbitail_cal_drawer_${projectId}`;
  const loadDrawerPrefs = (): { stateIds: string[] | null; meOnly: boolean; open: boolean } => {
    try {
      const raw = localStorage.getItem(DRAWER_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { stateIds: null, meOnly: false, open: false };
  };
  const initialDrawer = useMemo(() => loadDrawerPrefs(), [projectId]);
  const [drawerOpen, setDrawerOpen] = useState(initialDrawer.open);
  const [drawerStateIds, setDrawerStateIds] = useState<Set<string> | null>(
    initialDrawer.stateIds ? new Set(initialDrawer.stateIds) : null,
  );
  const [drawerMeOnly, setDrawerMeOnly] = useState(initialDrawer.meOnly);
  const [drawerStateOpen, setDrawerStateOpen] = useState(false);
  const drawerDragIdRef = useRef<string | null>(null);
  const [drawerDraggingId, setDrawerDraggingId] = useState<string | null>(null);
  const [drawerDropDayKey, setDrawerDropDayKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(DRAWER_KEY, JSON.stringify({
        stateIds: drawerStateIds ? Array.from(drawerStateIds) : null,
        meOnly: drawerMeOnly,
        open: drawerOpen,
      }));
    } catch {}
  }, [DRAWER_KEY, drawerStateIds, drawerMeOnly, drawerOpen]);


  const pushUndo = useUndoStore((s) => s.push);
  const { refresh, refreshIssue } = useIssueRefresh(workspaceSlug, projectId);

  /* 확장된 이슈 id 집합 — chip ↔ bar 토글 (세션 동안만) */
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

  /* 셀에서 이슈 생성 다이얼로그 */
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDefaultDueDate, setCreateDefaultDueDate] = useState<string | undefined>(undefined);
  const openCreateDialog = (dayKey: string) => {
    setCreateDefaultDueDate(dayKey);
    setCreateDialogOpen(true);
  };
  const toggleExpand = (id: string) => {
    setExpandedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* 하위 이슈까지 포함하여 fetch */
  const { data: issues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId, issueFilter, "with-sub"],
    queryFn:  () => issuesApi.list(workspaceSlug, projectId, { ...issueFilter, include_sub_issues: "true" }),
  });

  const { data: events = [] } = useQuery({
    queryKey: ["events", workspaceSlug, projectId],
    queryFn: () => projectsApi.events.list(workspaceSlug, projectId),
    enabled: !!settings.showEvents,
  });

  /* 이벤트 다이얼로그 */
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ProjectEvent | null>(null);
  const [eventDefaultDate, setEventDefaultDate] = useState<string | undefined>(undefined);
  const openEventCreate = (dayKey: string) => {
    setEditingEvent(null);
    setEventDefaultDate(dayKey);
    setEventDialogOpen(true);
  };
  const openEventEdit = (evt: ProjectEvent) => {
    setEditingEvent(evt);
    setEventDefaultDate(undefined);
    setEventDialogOpen(true);
  };

  const { data: states = [] } = useQuery({
    queryKey: ["states", projectId],
    queryFn:  () => projectsApi.states.list(workspaceSlug, projectId),
  });

  /* drawerStateIds 가 null(첫 진입)이면 backlog/unstarted/started 자동 선택 */
  useEffect(() => {
    if (drawerStateIds === null && states.length > 0) {
      const defaults = new Set(
        states.filter((s) => ["backlog", "unstarted", "started"].includes(s.group)).map((s) => s.id),
      );
      setDrawerStateIds(defaults);
    }
  }, [states, drawerStateIds]);

  /* 사용자 필터 — null=전체, "me"=본인, userId=특정 멤버 */
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", workspaceSlug, projectId],
    queryFn:  () => projectsApi.members.list(workspaceSlug, projectId),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Issue> }) =>
      issuesApi.update(workspaceSlug, projectId, id, data),
    onMutate: ({ id, data }) => {
      const issue = issues.find((i) => i.id === id);
      if (!issue) return;
      const prev: Partial<Issue> = {};
      for (const key of Object.keys(data) as (keyof Issue)[]) {
        (prev as any)[key] = (issue as any)[key];
      }
      return { id, prev };
    },
    onSuccess: (_, variables, context) => {
      refresh();
      refreshIssue(variables.id);
      if (context?.prev) {
        pushUndo({
          label: `Calendar: ${Object.keys(variables.data).join(", ")}`,
          undo: async () => {
            await issuesApi.update(workspaceSlug, projectId, context.id, context.prev);
            refresh();
            refreshIssue(context.id);
          },
        });
      }
    },
  });

  const eventUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProjectEvent> }) =>
      projectsApi.events.update(workspaceSlug, projectId, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events", workspaceSlug, projectId] });
    },
  });

  /* 완료/취소 상태 ID 집합 + drawer 표시 대상(일정 없는 이슈) */
  const completedStateIds = useMemo(
    () => new Set(states.filter((s) => s.group === "completed" || s.group === "cancelled").map((s) => s.id)),
    [states]
  );

  const drawerItems = useMemo(() => {
    return issues
      .filter((i) => !i.is_field)
      .filter((i) => !i.due_date)
      .filter((i) => (drawerStateIds && drawerStateIds.size > 0 ? drawerStateIds.has(i.state) : true))
      .filter((i) => (drawerMeOnly && currentUserId ? (i.assignees ?? []).includes(currentUserId) : true))
      .sort((a, b) => a.sequence_id - b.sequence_id);
  }, [issues, drawerStateIds, drawerMeOnly, currentUserId]);

  /* drawer 카드 drop — 셀로 끌어 놓으면 start_date/due_date 동일 날짜로 설정 */
  const handleDrawerDrop = (dayKey: string) => {
    if (!canSchedule) return;
    const dragId = drawerDragIdRef.current;
    drawerDragIdRef.current = null;
    if (!dragId) return;
    updateMutation.mutate({ id: dragId, data: { start_date: dayKey, due_date: dayKey } });
  };

  /* "me" 필터일 때 currentUserId 로 변환 */
  const filterUserId = userFilter === "me" ? currentUserId : userFilter;

  /* CalendarMonth 에 넘길 issues — settings/필터 적용 (드래그는 컴포넌트 내부 처리) */
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (issue.is_field) return false;
      if (!settings.showCompleted && completedStateIds.has(issue.state)) return false;
      if (!issue.start_date && !issue.due_date) return false;
      if (filterUserId && !(issue.assignees ?? []).includes(filterUserId)) return false;
      return true;
    });
  }, [issues, settings.showCompleted, completedStateIds, filterUserId]);

  /* 이벤트 — "내 일정"/특정 사용자 필터 시 글로벌 OR 본인 참여만 */
  const filteredEvents = useMemo(() => {
    if (!settings.showEvents) return [];
    if (!filterUserId) return events;
    return events.filter((e) => e.is_global || (e.participants ?? []).includes(filterUserId));
  }, [events, settings.showEvents, filterUserId]);

  /* 상태 ID → 색상 맵 — CalendarMonth 가 chip/bar 색 결정에 사용 */
  const stateColorMap = useMemo(
    () => Object.fromEntries(states.map((s) => [s.id, s.color])),
    [states]
  );

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  return (
    <div className="p-3 h-full flex gap-3 overflow-hidden">
      <div className="flex-1 flex flex-col glass rounded-xl border overflow-hidden select-none shadow-sm min-w-0">

        {/* ── 헤더: 월 네비 + 사용자 필터 + drawer 토글 + settings ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-0.5">
            <button
              onClick={prevMonth}
              className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <h2 className="text-lg font-semibold w-36 text-center tabular-nums text-foreground">
              {t(MONTH_KEYS[month])} {year}
            </h2>

            <button
              onClick={nextMonth}
              className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <button
              onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
              className="ml-2 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1 rounded-md border border-border hover:bg-muted/40 transition-colors"
            >
              {t("calendar.today")}
            </button>
          </div>

          {/* 사용자 필터 */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setUserFilter(null)}
              className={cn(
                "text-xs font-medium px-3 py-1 rounded-md border transition-colors flex items-center gap-1.5",
                userFilter === null
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
              title={t("calendar.filter.all")}
            >
              <Users className="h-3.5 w-3.5" />
              {t("calendar.filter.all")}
            </button>
            <button
              onClick={() => setUserFilter("me")}
              className={cn(
                "text-xs font-medium px-3 py-1 rounded-md border transition-colors flex items-center gap-1.5",
                userFilter === "me"
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
              title={t("calendar.filter.me")}
            >
              <UserIcon className="h-3.5 w-3.5" />
              {t("calendar.filter.me")}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "text-xs font-medium px-3 py-1 rounded-md border transition-colors flex items-center gap-1.5",
                    userFilter && userFilter !== "me"
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  )}
                >
                  {userFilter && userFilter !== "me" ? (
                    (() => {
                      const m = members.find((x) => x.member.id === userFilter);
                      return m ? <><AvatarInitials name={m.member.display_name} avatar={m.member.avatar} size="xs" />{m.member.display_name}</> : t("calendar.filter.user");
                    })()
                  ) : (
                    t("calendar.filter.user")
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                {members.map((m) => (
                  <DropdownMenuItem
                    key={m.member.id}
                    onClick={() => setUserFilter(m.member.id)}
                    className="text-xs gap-2"
                  >
                    <AvatarInitials name={m.member.display_name} avatar={m.member.avatar} size="xs" />
                    {m.member.display_name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* 백로그 Drawer 토글 */}
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            className={cn(
              "h-8 px-2.5 rounded-full flex items-center gap-1.5 text-xs font-medium transition-colors",
              drawerOpen
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            title={t("calendar.drawer.toggle", "이슈 패널")}
          >
            <Inbox className="h-4 w-4" />
            {drawerItems.length > 0 && (
              <span className="text-2xs font-semibold">{drawerItems.length}</span>
            )}
          </button>

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
            >
              <Settings2 className="h-4 w-4" />
            </button>
            {settingsOpen && (
              <CalendarSettingsPanel
                settings={settings}
                onChange={onSettingsChange}
                onClose={() => setSettingsOpen(false)}
                triggerRef={settingsBtnRef}
              />
            )}
          </div>
        </div>

        {/* ── CalendarMonth — 시각/주행/bar/chip/드래그 ── */}
        <CalendarMonth
          year={year}
          month={month}
          issues={filteredIssues}
          events={filteredEvents}
          stateColorMap={stateColorMap}
          settings={settings}
          expandedIds={expandedIssues}
          onToggleExpand={toggleExpand}
          canSchedule={canSchedule}
          onIssueClick={onIssueClick}
          onIssueUpdate={(id, data) => updateMutation.mutate({ id, data })}
          onEventUpdate={(id, data) => eventUpdateMutation.mutate({ id, data })}
          onIssueCreate={openCreateDialog}
          onEventCreate={openEventCreate}
          onEventEdit={openEventEdit}
          drawerDragIdRef={drawerDragIdRef}
          drawerDraggingId={drawerDraggingId}
          drawerDropDayKey={drawerDropDayKey}
          onDrawerDropDayKeyChange={setDrawerDropDayKey}
          onDrawerDrop={handleDrawerDrop}
        />
      </div>

      {drawerOpen && (
        <BacklogDrawer
          items={drawerItems}
          states={states}
          drawerStateIds={drawerStateIds}
          setDrawerStateIds={setDrawerStateIds}
          drawerStateOpen={drawerStateOpen}
          setDrawerStateOpen={setDrawerStateOpen}
          meOnly={drawerMeOnly}
          setMeOnly={setDrawerMeOnly}
          onClose={() => setDrawerOpen(false)}
          onDragStart={(id) => { drawerDragIdRef.current = id; setDrawerDraggingId(id); }}
          onDragEnd={() => { drawerDragIdRef.current = null; setDrawerDraggingId(null); setDrawerDropDayKey(null); }}
          draggingId={drawerDraggingId}
          onIssueClick={onIssueClick}
          canSchedule={canSchedule}
        />
      )}

      <IssueCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        states={states}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        defaultDueDate={createDefaultDueDate}
      />
      <EventDialog
        open={eventDialogOpen}
        onOpenChange={setEventDialogOpen}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        event={editingEvent}
        defaultDate={eventDefaultDate}
      />
    </div>
  );
}

/* ── 백로그 Drawer ── */
interface BacklogDrawerProps {
  items: Issue[];
  states: { id: string; name: string; color: string; group: string }[];
  drawerStateIds: Set<string> | null;
  setDrawerStateIds: (s: Set<string> | null) => void;
  drawerStateOpen: boolean;
  setDrawerStateOpen: (v: boolean) => void;
  meOnly: boolean;
  setMeOnly: (v: boolean) => void;
  onClose: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  draggingId: string | null;
  onIssueClick: (id: string) => void;
  canSchedule: boolean;
}

function BacklogDrawer({
  items, states, drawerStateIds, setDrawerStateIds, drawerStateOpen, setDrawerStateOpen,
  meOnly, setMeOnly, onClose, onDragStart, onDragEnd, draggingId, onIssueClick, canSchedule,
}: BacklogDrawerProps) {
  const { t } = useTranslation();
  const stateById = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const s of states) m.set(s.id, { name: s.name, color: s.color });
    return m;
  }, [states]);

  const toggleStateFilter = (sid: string) => {
    setDrawerStateIds((() => {
      const cur = drawerStateIds ?? new Set<string>();
      const next = new Set(cur);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    })());
  };

  return (
    <div className="w-72 shrink-0 flex flex-col rounded-xl border bg-background shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">{t("calendar.drawer.title", "이슈")}</span>
          <span className="text-2xs text-muted-foreground">{items.length}</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/50"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-border space-y-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMeOnly(!meOnly)}
            className={cn(
              "text-2xs px-2 py-1 rounded-md border transition-colors flex items-center gap-1",
              meOnly
                ? "bg-primary/10 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <UserIcon className="h-3 w-3" />
            {t("calendar.drawer.meOnly", "내 이슈만")}
          </button>

          <div className="relative flex-1">
            <button
              onClick={() => setDrawerStateOpen(!drawerStateOpen)}
              className="w-full text-2xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-between"
            >
              <span>{t("calendar.drawer.statesFilter", "상태")} · {(drawerStateIds?.size ?? 0)}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {drawerStateOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 w-44 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md p-1">
                {states.map((s) => {
                  const checked = drawerStateIds?.has(s.id) ?? false;
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleStateFilter(s.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1 rounded text-2xs hover:bg-muted/60",
                        checked && "bg-muted/40",
                      )}
                    >
                      <input type="checkbox" checked={checked} readOnly className="h-3 w-3" />
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className="truncate">{s.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {items.length === 0 ? (
          <p className="text-2xs text-muted-foreground text-center py-6">
            {t("calendar.drawer.empty", "표시할 이슈가 없습니다")}
          </p>
        ) : items.map((issue) => {
          const st = stateById.get(issue.state);
          const isDragging = draggingId === issue.id;
          return (
            <div
              key={issue.id}
              draggable={canSchedule}
              onDragStart={(e) => {
                if (!canSchedule) { e.preventDefault(); return; }
                onDragStart(issue.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", issue.id);
              }}
              onDragEnd={onDragEnd}
              onClick={() => onIssueClick(issue.id)}
              className={cn(
                "group flex items-start gap-1.5 px-2 py-1.5 rounded-md border text-xs transition-all duration-fast cursor-pointer",
                "border-transparent hover:bg-muted/40 hover:border-border",
                !canSchedule && "cursor-not-allowed opacity-70",
                isDragging && "opacity-30 scale-[0.97]",
              )}
              title={canSchedule ? t("calendar.drawer.dragHint", "드래그해서 캘린더에 놓기") : t("calendar.drawer.noPerm", "일정 수정 권한이 없습니다")}
            >
              {canSchedule && (
                <GripVertical className="h-3 w-3 mt-0.5 text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
              <div className="flex-1 min-w-0">
                <p className="truncate text-foreground/90">{issue.title}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {st && (
                    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
                      {st.name}
                    </span>
                  )}
                  <span className="text-2xs text-muted-foreground/70 font-mono">#{issue.sequence_id}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
