import { createBrowserRouter, Navigate } from "react-router-dom";
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
import { ProfilePage } from "@/pages/settings/ProfilePage";
import { PreferencesPage } from "@/pages/settings/PreferencesPage";
import { SecurityPage } from "@/pages/settings/SecurityPage";
import { WorkspaceMembersPage } from "@/pages/settings/WorkspaceMembersPage";
import { AdminLayout } from "@/pages/admin/AdminLayout";
import { AdminUsersPage } from "@/pages/admin/AdminUsersPage";
import { AdminWorkspacesPage } from "@/pages/admin/AdminWorkspacesPage";
import { AdminSuperusersPage } from "@/pages/admin/AdminSuperusersPage";
import { AdminAuditLogPage } from "@/pages/admin/AdminAuditLogPage";
import { ProjectSettingsLayout } from "@/pages/project/settings/ProjectSettingsLayout";
import { GeneralPage } from "@/pages/project/settings/GeneralPage";
import { MembersPage } from "@/pages/project/settings/MembersPage";
import { StatesPage } from "@/pages/project/settings/StatesPage";
import { LabelsPage } from "@/pages/project/settings/LabelsPage";
import { AutoArchivePage } from "@/pages/project/settings/AutoArchivePage";
import { TemplatesPage } from "@/pages/project/settings/TemplatesPage";
import { NotificationsPage as ProjectNotificationsPage } from "@/pages/project/settings/NotificationsPage";
import { CategoriesPage } from "@/pages/project/CategoriesPage";
import { SprintsPage } from "@/pages/project/SprintsPage";
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

function LazyPage({ Component }: { Component: React.LazyExoticComponent<() => JSX.Element> }) {
  return <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}><Component /></Suspense>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  // accessToken 존재 여부로 인증 체크 (getter 대신 selector 사용)
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/auth/login" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: "/auth/login",
    element: <LoginPage />,
  },
  {
    path: "/auth/register",
    element: <RegisterPage />,
  },
  {
    path: "/auth/verify-email",
    element: <VerifyEmailPage />,
  },
  {
    path: "/auth/forgot-password",
    element: <ForgotPasswordPage />,
  },
  {
    path: "/auth/reset-password",
    element: <ResetPasswordPage />,
  },
  {
    // 워크스페이스 초대 수락 — 로그인 여부와 무관하게 접근 가능
    path: "/invite/:token",
    element: <InviteAcceptPage />,
  },
  {
    path: "/create-workspace",
    element: (
      <RequireAuth>
        <CreateWorkspacePage />
      </RequireAuth>
    ),
  },
  {
    path: "/",
    element: (
      <RequireAuth>
        <WorkspaceSelectPage />
      </RequireAuth>
    ),
  },
  {
    path: "/:workspaceSlug",
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <WorkspaceDashboard /> },
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

      // 개인 / 워크스페이스 설정
      {
        path: "settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="profile" replace /> },
          { path: "profile",     element: <ProfilePage /> },
          { path: "preferences", element: <PreferencesPage /> },
          { path: "security",    element: <SecurityPage /> },
          { path: "workspace-members", element: <WorkspaceMembersPage /> },
        ],
      },

      // 관리자 페이지 — 워크스페이스 관리자 이상 접근, 일부 탭은 슈퍼유저 전용
      {
        path: "admin",
        element: <AdminLayout />,
        children: [
          { index: true, element: <Navigate to="users" replace /> },
          { path: "users",      element: <AdminUsersPage /> },
          { path: "workspaces", element: <AdminWorkspacesPage /> },
          { path: "superusers", element: <AdminSuperusersPage /> },
          { path: "audit",      element: <AdminAuditLogPage /> },
        ],
      },

      // 프로젝트 설정
      {
        path: "projects/:projectId/settings",
        element: <ProjectSettingsLayout />,
        children: [
          { index: true, element: <Navigate to="general" replace /> },
          { path: "general",       element: <GeneralPage /> },
          { path: "members",       element: <MembersPage /> },
          { path: "states",        element: <StatesPage /> },
          { path: "labels",        element: <LabelsPage /> },
          { path: "auto-archive",  element: <AutoArchivePage /> },
          { path: "templates",     element: <TemplatesPage /> },
          { path: "notifications", element: <ProjectNotificationsPage /> },
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
    children: [
      { index: true, element: <LazyPage Component={DocumentsHomePage} /> },
      { path: "space/:spaceId", element: <LazyPage Component={DocumentSpacePage} /> },
      { path: "space/:spaceId/explorer", element: <LazyPage Component={DocumentExplorerPage} /> },
      { path: "space/:spaceId/:docId", element: <LazyPage Component={DocumentSpacePage} /> },
    ],
  },
]);
