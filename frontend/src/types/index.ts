export interface User {
  id: string;
  email: string;
  display_name: string;
  first_name: string;
  last_name: string;
  avatar: string | null;
  is_staff: boolean;
  timezone: string;
  language: string;
  first_day_of_week: number;
  theme: "light" | "dark" | "system";
  created_at: string;
}

export type PriorityColors = Partial<Record<"urgent" | "high" | "medium" | "low" | "none", string>>;

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  owner: User;
  member_count: number;
  priority_colors: PriorityColors;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  member: User;
  role: 10 | 15 | 20 | 25;
  created_at: string;
}

export interface State {
  id: string;
  name: string;
  color: string;
  group: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  sequence: number;
  default: boolean;
}

export interface Project {
  id: string;
  name: string;
  identifier: string;
  description: string;
  workspace: string;
  network: 0 | 2;
  icon_prop: Record<string, unknown> | null;
  created_by: User;
  lead: string | null;
  lead_detail: User | null;
  state_count: number;
  is_member: boolean;
  user_role: 10 | 15 | 20 | null;
  archived_at: string | null;
  auto_archive_days: number | null;
  created_at: string;
}

export interface ProjectMember {
  id: string;
  member: User;
  role: 10 | 15 | 20;
  created_at: string;
}

export type CategoryStatus = "backlog" | "active" | "paused" | "completed" | "cancelled";
export type SprintStatus = "draft" | "active" | "completed" | "cancelled";

export interface Category {
  id: string;
  name: string;
  description: string;
  icon_prop: Record<string, unknown> | null;
  status: CategoryStatus;
  lead: string | null;
  lead_detail: User | null;
  start_date: string | null;
  target_date: string | null;
  issue_count: number;
  created_at: string;
  updated_at: string;
}

export interface Sprint {
  id: string;
  name: string;
  description: string;
  status: SprintStatus;
  start_date: string;
  end_date: string;
  created_by: string;
  created_by_detail: User;
  issue_count: number;
  created_at: string;
  updated_at: string;
}

/** 프로젝트 캘린더 이벤트 (이슈와 별개의 1회성/기간 일정) */
export interface ProjectEvent {
  id: string;
  project: string;
  title: string;
  date: string;               // YYYY-MM-DD — 시작일
  end_date: string | null;    // YYYY-MM-DD | null — 기간 이벤트
  event_type: "meeting" | "trip" | "deadline" | "presentation" | "milestone" | "other";
  color: string;              // hex
  description: string;
  created_by: string | null;
  created_by_detail: User | null;
  created_at: string;
  updated_at: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export type Priority = "none" | "urgent" | "high" | "medium" | "low";

export interface Issue {
  id: string;
  title: string;
  description: unknown;
  description_html: string;
  priority: Priority;
  state: string;
  state_detail: State;
  project: string;
  project_identifier?: string;
  project_name?: string;
  workspace: string;
  assignees: string[];
  assignee_details: User[];
  label: string[];
  label_details: Label[];
  category: string | null;
  sprint: string | null;
  parent: string | null;
  sub_issues_count: number;
  link_count: number;
  attachment_count: number;
  sequence_id: number;
  created_by: string;
  created_by_detail: User;
  due_date: string | null;
  start_date: string | null;
  estimate_point: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface IssueLink {
  id: string;
  title: string;
  url: string;
  created_by: string;
  created_at: string;
}

export interface IssueComment {
  id: string;
  comment_html: string;
  comment_json: unknown;
  actor: string;
  actor_detail: User;
  created_at: string;
  updated_at: string;
}

export interface IssueActivity {
  id: string;
  verb: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_detail: User;
  created_at: string;
}

export interface WorkspaceInvitation {
  id: string;
  workspace: string;
  workspace_name: string;
  email: string;
  token: string;
  role: 10 | 15 | 20 | 25;
  invited_by: User;
  status: "pending" | "accepted" | "revoked";
  message: string;
  expires_at: string;
  created_at: string;
}

/** 토큰으로 조회한 초대 정보 (비인증 접근 가능) */
export interface InvitationInfo {
  id: string;
  workspace_name: string;
  workspace_slug: string;
  email: string;
  role: 10 | 15 | 20 | 25;
  invited_by_name: string;
  message: string;
  expires_at: string;
}

/** 전역 검색 결과 — 경량 이슈 정보 + 프로젝트 식별자 */
export interface IssueSearchResult {
  id: string;
  title: string;
  priority: Priority;
  state: string;
  state_detail: State;
  project: string;
  project_identifier: string;
  project_name: string;
  sequence_id: number;
  updated_at: string;
}

export interface IssueAttachment {
  id: string;
  file: string;
  filename: string;
  size: number;
  mime_type: string;
  uploaded_by: string;
  uploaded_by_detail: User;
  created_at: string;
}

/* ── 이슈 통계 (대시보드 차트용) ── */
export interface IssueStats {
  by_state: { state_id: string; state_name: string; group: string; color: string; count: number }[];
  by_priority: { priority: string; count: number }[];
  over_time: { date: string; created: number; completed: number }[];
  by_assignee: { user_id: string; display_name: string; avatar: string; count: number }[];
}

/* ── 이슈 템플릿 ── */
export interface IssueTemplate {
  id: string;
  name: string;
  title_template: string;
  description_html: string;
  priority: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* ── 내 할 일 (워크스페이스 홈용) ── */
export interface MyIssues {
  todo: Issue[];
  in_progress: Issue[];
  overdue: Issue[];
  upcoming: Issue[];
}

export type NotificationType = "issue_assigned" | "issue_updated" | "comment_added" | "mentioned";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  read: boolean;
  actor: string;
  actor_detail: User;
  issue: string | null;
  issue_title: string | null;
  issue_sequence_id: number | null;
  project_id: string | null;
  project_identifier: string | null;
  workspace: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface AuthTokens {
  access: string;
  refresh: string;
  user: User;
}
