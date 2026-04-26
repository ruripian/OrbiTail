import { createBrowserRouter, Navigate, Outlet, useMatches } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoginPage } from "@/pages/auth/LoginPage";
import { RegisterPage } from "@/pages/auth/RegisterPage";
import { VerifyEmailPage } from "@/pages/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "@/pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/auth/ResetPasswordPage";
import { WorkspaceSelectPage } from "@/pages/WorkspaceSelectPage";
import { CreateWorkspacePage } from "@/pages/workspace/CreateWorkspacePage";
import { WorkspaceDashboard } from "@/pages/workspace/WorkspaceDashboard";
import { CreateProjectPage } from "@/pages/project/CreateProjectPage";
import { ProjectIssuePage } from "@/pages/project/ProjectIssuePage";
import { SettingsLayout } from "@/pages/settings/SettingsLayout";
import { WorkspaceSettingsLayout } from "@/pages/settings/WorkspaceSettingsLayout";
import { ProfilePage } from "@/pages/settings/ProfilePage";
import { PreferencesPage } from "@/pages/settings/PreferencesPage";
import { SecurityPage } from "@/pages/settings/SecurityPage";
import { WorkspaceMembersPage } from "@/pages/settings/WorkspaceMembersPage";
import { AdminLayout } from "@/pages/admin/AdminLayout";
import { AdminUsersPage } from "@/pages/admin/AdminUsersPage";
import { AdminWorkspacesPage } from "@/pages/admin/AdminWorkspacesPage";
import { AdminOrphanSpacesPage } from "@/pages/admin/AdminOrphanSpacesPage";
import { AdminAttachmentsPage } from "@/pages/admin/AdminAttachmentsPage";
import { AdminSuperusersPage } from "@/pages/admin/AdminSuperusersPage";
import { AdminAuditLogPage } from "@/pages/admin/AdminAuditLogPage";
import { ProjectSettingsLayout } from "@/pages/project/settings/ProjectSettingsLayout";
import { GeneralPage } from "@/pages/project/settings/GeneralPage";
import { MembersPage } from "@/pages/project/settings/MembersPage";
import { WorkflowPage } from "@/pages/project/settings/WorkflowPage";
import { AutomationPage } from "@/pages/project/settings/AutomationPage";
import { CategoriesPage } from "@/pages/project/CategoriesPage";
import { SprintsPage } from "@/pages/project/SprintsPage";
import { ProjectArchivePage } from "@/pages/project/ProjectArchivePage";
import { ProjectTrashPage } from "@/pages/project/ProjectTrashPage";
import { DiscoverProjectsPage } from "@/pages/project/DiscoverProjectsPage";
import { ArchivedProjectsPage } from "@/pages/project/ArchivedProjectsPage";
import { InviteAcceptPage } from "@/pages/invite/InviteAcceptPage";
import { AnnouncementsPage } from "@/pages/AnnouncementsPage";
import { DocumentLayout } from "@/components/layout/DocumentLayout";
import { RequestSubmitPage } from "@/pages/request/RequestSubmitPage";
import { lazy, Suspense } from "react";

const DocumentsHomePage = lazy(() => import("@/pages/documents/DocumentsHomePage"));
const DocumentSpacePage = lazy(() => import("@/pages/documents/DocumentSpacePage"));
const DocumentExplorerPage = lazy(() => import("@/pages/documents/DocumentExplorerPage"));
const DocumentSpaceSettingsPage = lazy(() => import("@/pages/documents/DocumentSpaceSettingsPage"));
const PublicDocumentPage = lazy(() => import("@/pages/public/PublicDocumentPage"));

/**
 * Phase 2.4 — chrome 메타 (라우트 핸들)
 *   "branded"  → Orbit/점 격자 풀 표현 (Login, Dashboard, empty state 류)
 *   "minimal"  → 점 격자 숨김, 카드/테이블에 시각 부담 적게 (Issue/Board/Settings)
 *   "document" → 점 격자 흐리게(opacity 0.3) (Document 류)
 *
 * AppLayout/DocumentLayout이 useMatches()로 가장 깊은 chrome 값을 읽어
 * <body>에 data-chrome 속성을 부여하고, index.css의 body[data-chrome="..."]
 * 셀렉터로 표시 강도를 제어한다.
 */
export type ChromeKind = "branded" | "minimal" | "document";

export interface RouteHandle {
  chrome?: ChromeKind;
}

function LazyPage({ Component }: { Component: React.LazyExoticComponent<() => JSX.Element> }) {
  return <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}><Component /></Suspense>;
}

/** 가장 깊은 chrome 메타를 body[data-chrome]에 부여. index.css가 이 속성으로 점격자 표시 제어 */
function ChromeAttributeWrapper() {
  const matches = useMatches();
  useEffect(() => {
    const chrome = [...matches]
      .reverse()
      .map((m) => (m.handle as RouteHandle | undefined)?.chrome)
      .find(Boolean);
    document.body.setAttribute("data-chrome", chrome ?? "branded");
  }, [matches]);
  return <Outlet />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  // accessToken 존재 여부로 인증 체크 (getter 대신 selector 사용)
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/auth/login" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    element: <ChromeAttributeWrapper />,
    children: [
  {
    path: "/auth/login",
    element: <LoginPage />,
    handle: { chrome: "branded" } satisfies RouteHandle,
  },
  {
    path: "/auth/register",
    element: <RegisterPage />,
    handle: { chrome: "branded" } satisfies RouteHandle,
  },
  {
    path: "/auth/verify-email",
    element: <VerifyEmailPage />,
    handle: { chrome: "branded" } satisfies RouteHandle,
  },
  {
    path: "/auth/forgot-password",
    element: <ForgotPasswordPage />,
    handle: { chrome: "branded" } satisfies RouteHandle,
  },
  {
    path: "/auth/reset-password",
    element: <ResetPasswordPage />,
    handle: { chrome: "branded" } satisfies RouteHandle,
  },
  {
    // 워크스페이스 초대 수락 — 로그인 여부와 무관하게 접근 가능
    path: "/invite/:token",
    element: <InviteAcceptPage />,
    handle: { chrome: "branded" } satisfies RouteHandle,
  },
  {
    // 공개 공유 문서 — 인증 불필요
    path: "/s/:token",
    element: <LazyPage Component={PublicDocumentPage} />,
    handle: { chrome: "document" } satisfies RouteHandle,
  },
  {
    path: "/create-workspace",
    element: (
      <RequireAuth>
        <CreateWorkspacePage />
      </RequireAuth>
    ),
    handle: { chrome: "branded" } satisfies RouteHandle,
  },
  {
    path: "/",
    element: (
      <RequireAuth>
        <WorkspaceSelectPage />
      </RequireAuth>
    ),
    handle: { chrome: "branded" } satisfies RouteHandle,
  },
  {
    path: "/:workspaceSlug",
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    handle: { chrome: "minimal" } satisfies RouteHandle,
    children: [
      { index: true, element: <WorkspaceDashboard />, handle: { chrome: "branded" } satisfies RouteHandle },
      { path: "announcements", element: <AnnouncementsPage /> },
      { path: "projects/create", element: <CreateProjectPage /> },
      { path: "projects/discover", element: <DiscoverProjectsPage /> },
      { path: "projects/archived", element: <ArchivedProjectsPage /> },
      /* 이슈 페이지 — ?view=table|board|calendar|timeline, ?issue=uuid */
      { path: "projects/:projectId/issues", element: <ProjectIssuePage /> },
      /* 기존 /board 경로 호환 — 같은 컴포넌트, view=board로 진입 */
      { path: "projects/:projectId/board", element: <ProjectIssuePage /> },
      { path: "projects/:projectId/categories", element: <CategoriesPage /> },
      /* 카테고리별 이슈 뷰 — ProjectIssuePage가 categoryId URL 파라미터로 필터 */
      { path: "projects/:projectId/categories/:categoryId/issues", element: <ProjectIssuePage /> },
      /* 프로젝트별 요청(버그/기능) 제출 페이지 */
      { path: "projects/:projectId/request", element: <RequestSubmitPage /> },
      { path: "projects/:projectId/sprints", element: <SprintsPage /> },
      /* 스프린트별 이슈 뷰 — ProjectIssuePage가 sprintId URL 파라미터로 필터 */
      { path: "projects/:projectId/sprints/:sprintId/issues", element: <ProjectIssuePage /> },
      /* PASS4-4 — Archive/Trash 사이드바 진입점 (standalone 페이지) */
      { path: "projects/:projectId/archive", element: <ProjectArchivePage /> },
      { path: "projects/:projectId/trash",   element: <ProjectTrashPage /> },

      // 계정 설정 — 워크스페이스 설정과 분리된 패널
      {
        path: "settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="profile" replace /> },
          { path: "profile",     element: <ProfilePage /> },
          { path: "preferences", element: <PreferencesPage /> },
          { path: "security",    element: <SecurityPage /> },
          /* legacy redirect — 옛 링크/북마크 보존 */
          { path: "workspace-members", element: <Navigate to="../../workspace-settings/members" replace /> },
        ],
      },

      // 워크스페이스 설정 — 계정 설정과 분리. 멤버 관리, 추후 brand color/integrations 등.
      {
        path: "workspace-settings",
        element: <WorkspaceSettingsLayout />,
        children: [
          { index: true, element: <Navigate to="members" replace /> },
          { path: "members", element: <WorkspaceMembersPage /> },
        ],
      },

      // 관리자 페이지 — 워크스페이스 관리자 이상 접근, 일부 탭은 슈퍼유저 전용
      {
        path: "admin",
        element: <AdminLayout />,
        children: [
          { index: true, element: <Navigate to="users" replace /> },
          { path: "users",          element: <AdminUsersPage /> },
          { path: "orphan-spaces",  element: <AdminOrphanSpacesPage /> },
          { path: "attachments",    element: <AdminAttachmentsPage /> },
          { path: "workspaces",     element: <AdminWorkspacesPage /> },
          { path: "superusers",     element: <AdminSuperusersPage /> },
          { path: "audit",          element: <AdminAuditLogPage /> },
        ],
      },

      // 프로젝트 설정 — PASS4-3: 7→4 탭 + legacy redirects
      {
        path: "projects/:projectId/settings",
        element: <ProjectSettingsLayout />,
        children: [
          { index: true, element: <Navigate to="general" replace /> },
          { path: "general",    element: <GeneralPage /> },
          { path: "members",    element: <MembersPage /> },
          { path: "workflow",   element: <WorkflowPage /> },
          { path: "automation", element: <AutomationPage /> },
          /* legacy redirects — 외부 링크/북마크 보존 (6개월 후 PASS5 에서 제거) */
          { path: "states",        element: <Navigate to="../workflow#states" replace /> },
          { path: "labels",        element: <Navigate to="../workflow#labels" replace /> },
          { path: "templates",     element: <Navigate to="../workflow" replace /> },
          { path: "auto-archive",  element: <Navigate to="../automation#auto-archive" replace /> },
          { path: "notifications", element: <Navigate to="../automation#integrations" replace /> },
        ],
      },
    ],
  },
  {
    path: "/:workspaceSlug/documents",
    element: (
      <RequireAuth>
        <DocumentLayout />
      </RequireAuth>
    ),
    handle: { chrome: "document" } satisfies RouteHandle,
    children: [
      { index: true, element: <LazyPage Component={DocumentsHomePage} /> },
      { path: "space/:spaceId", element: <LazyPage Component={DocumentSpacePage} /> },
      { path: "space/:spaceId/explorer", element: <LazyPage Component={DocumentExplorerPage} /> },
      { path: "space/:spaceId/settings", element: <LazyPage Component={DocumentSpaceSettingsPage} /> },
      { path: "space/:spaceId/:docId", element: <LazyPage Component={DocumentSpacePage} /> },
    ],
  },
    ],
  },
]);
