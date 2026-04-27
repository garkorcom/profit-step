import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import MainLayout from '../components/layout/MainLayout';
import { CircularProgress, Box } from '@mui/material';

// ============================================
// Lazy-loaded components for code splitting
// ============================================

// Auth pages (small, keep direct import for fast login)
import LoginPage from '../pages/auth/LoginPage';
import SignupPage from '../pages/auth/SignupPage';
import ForgotPasswordPage from '../pages/auth/ForgotPasswordPage';

// Heavy pages - lazy load
const DashboardPage = React.lazy(() => import('../pages/DashboardPage'));
const ProfilePage = React.lazy(() => import('../pages/ProfilePage'));
const SettingsPage = React.lazy(() => import('../pages/SettingsPage'));
const TeamAdminPage = React.lazy(() => import('../pages/admin/TeamAdminPage'));
const UserDetailPage = React.lazy(() => import('../pages/admin/UserDetailPage'));
const EstimatesPage = React.lazy(() => import('../pages/estimates/EstimatesPage'));
const EstimateBuilderPage = React.lazy(() => import('../pages/estimates/EstimateBuilderPage'));
const ElectricalEstimatorPage = React.lazy(() => import('../pages/estimates/ElectricalEstimatorPage'));
const SavedEstimatesPage = React.lazy(() => import('../pages/estimates/SavedEstimatesPage'));
const ProjectWorkspacePage = React.lazy(() => import('../pages/estimates/ProjectWorkspacePage'));
const EstimateDetailPage = React.lazy(() => import('../pages/estimates/EstimateDetailPage'));
const SettingsCalculatorPage = React.lazy(() => import('../pages/estimates/SettingsCalculatorPage'));
const SuperAdminDashboard = React.lazy(() => import('../pages/superadmin/SuperAdminDashboard'));
const CompanyDashboard = React.lazy(() => import('../pages/admin/CompanyDashboard'));
const CompaniesPage = React.lazy(() => import('../pages/admin/CompaniesPage'));
const ClientsPage = React.lazy(() => import('../pages/crm/ClientsPage'));
const ClientDetailsPage = React.lazy(() => import('../pages/crm/ClientDetailsPage'));
const ClientBuilderPage = React.lazy(() => import('../pages/crm/ClientBuilderPage'));
const DevIndexPage = React.lazy(() => import('../pages/DevIndexPage'));
const SystemHealthCheck = React.lazy(() => import('../pages/debug/SystemHealthCheck'));

const DealsPage = React.lazy(() => import('../pages/crm/DealsPage'));
const LeadDetailsPage = React.lazy(() => import('../pages/crm/LeadDetailsPage'));
const TimeTrackingPage = React.lazy(() => import('../pages/crm/TimeTrackingPage'));
const FinancePage = React.lazy(() => import('../pages/crm/FinancePage'));
const GTDCreatePage = React.lazy(() => import('../pages/crm/GTDCreatePage'));
const UnifiedTasksPage = React.lazy(() => import('../pages/crm/UnifiedTasksPage'));
const UnifiedCockpitPage = React.lazy(() => import('../pages/crm/UnifiedCockpitPage'));
const ShoppingPage = React.lazy(() => import('../pages/crm/ShoppingPage'));
const PayrollPeriodsPage = React.lazy(() => import('../pages/crm/PayrollPeriodsPage'));
const CostsReportPage = React.lazy(() => import('../pages/crm/CostsReportPage'));
const RolesPage = React.lazy(() => import('../pages/admin/RolesPage'));
const AIReportsPage = React.lazy(() => import('../pages/AIReportsPage'));
const BankStatementsPage = React.lazy(() => import('../pages/crm/BankStatementsPage'));
const ReconciliationPage = React.lazy(() => import('../pages/crm/ReconciliationPage'));
const ExpensesBoardPage = React.lazy(() => import('../pages/crm/ExpensesBoardPage'));
const TasksMasonryPage = React.lazy(() => import('../pages/crm/TasksMasonryPage'));
const InventoryPage = React.lazy(() => import('../pages/crm/InventoryPage'));
const InventoryStandalonePage = React.lazy(() => import('../pages/inventory/InventoryPage'));
const AboutProjectPage = React.lazy(() => import('../pages/AboutProjectPage'));
const CodeDocumentationPage = React.lazy(() => import('../pages/CodeDocumentationPage'));
const DevLogCreatePage = React.lazy(() => import('../pages/admin/DevLogCreatePage'));
const DevLogBlogPage = React.lazy(() => import('../pages/DevLogBlogPage'));
const ContactsPage = React.lazy(() => import('../pages/crm/ContactsPage'));
const SiteDashboardPage = React.lazy(() => import('../pages/sites/SiteDashboardPage'));
const InfraMapPage = React.lazy(() => import('../pages/InfraMapPage'));
const ClientPortalPage = React.lazy(() => import('../pages/portal/ClientPortalPage'));
const ClientDashboardPage = React.lazy(() => import('../pages/dashboard/client/[id]'));
const LandingsPage = React.lazy(() => import('../pages/crm/LandingsPage'));
const LandingLoader = React.lazy(() => import('../pages/landings/LandingLoader'));
const MyTimePage = React.lazy(() => import('../modules/worker').then(m => ({ default: m.MyTimePage })));
const AdminWorkersListPage = React.lazy(() => import('../modules/worker').then(m => ({ default: m.AdminWorkersListPage })));
const AdminWorkerDetailPage = React.lazy(() => import('../modules/worker').then(m => ({ default: m.AdminWorkerDetailPage })));

// Tasktotime — Phase 4.0 frontend foundation.
// One bundle per view-shell + view. The Layout owns the sidebar; child routes
// render through its <Outlet />. ComingSoonView is the placeholder for views
// that ship in follow-up PRs (board, gantt, wiki editor, etc.).
const TasktotimeLayout = React.lazy(() => import('../pages/crm/tasktotime').then(m => ({ default: m.TasktotimeLayout })));
const TaskListPage = React.lazy(() => import('../pages/crm/tasktotime').then(m => ({ default: m.TaskListPage })));
const TasktotimeComingSoon = React.lazy(() => import('../pages/crm/tasktotime').then(m => ({ default: m.ComingSoonView })));

// Loading fallback component
const PageLoader = () => (
  <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
    <CircularProgress />
  </Box>
);

/**
 * Компонент для защиты маршрутов
 * Перенаправляет на /login если пользователь не авторизован
 */
const ProtectedLayout: React.FC = () => {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return null; // Или можно показать loader
  }

  return currentUser ? <MainLayout /> : <Navigate to="/login" replace />;
};

/**
 * Публичный роут (перенаправляет на главную если уже залогинен)
 */
const PublicRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return null; // Или можно показать loader
  }

  return currentUser ? <Navigate to="/admin/dashboard" replace /> : children;
};

const AppRouter: React.FC = () => {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* ============================================ */}
        {/* ПУБЛИЧНЫЕ МАРШРУТЫ (БЕЗ HEADER И FOOTER)    */}
        {/* ============================================ */}

        {/* Client Portal - Public Access */}
        <Route path="/portal/:slug" element={<ClientPortalPage />} />

        {/* Landings Idea Hub - Public Access */}
        <Route path="/l/:ideaName" element={<LandingLoader />} />

        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />

        <Route
          path="/signup"
          element={
            <PublicRoute>
              <SignupPage />
            </PublicRoute>
          }
        />

        <Route
          path="/forgot-password"
          element={
            <PublicRoute>
              <ForgotPasswordPage />
            </PublicRoute>
          }
        />

        {/* ============================================ */}
        {/* ЗАЩИЩЕННЫЕ МАРШРУТЫ (С HEADER И FOOTER)      */}
        {/* ============================================ */}

        {/* Родительский маршрут с MainLayout */}
        <Route element={<ProtectedLayout />}>
          {/* Главная страница - редирект на дашборд */}
          <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />

          {/* Дашборд компании */}
          <Route path="/admin/dashboard" element={<CompanyDashboard />} />

          {/* Управление командой */}
          <Route path="/admin/team" element={<TeamAdminPage />} />
          <Route path="/admin/team/:userId" element={<UserDetailPage />} />

          {/* Роли и права доступа */}
          <Route path="/admin/roles" element={<RolesPage />} />

          {/* Компании (Клиенты) */}
          <Route path="/admin/companies" element={<CompaniesPage />} />

          {/* Клиенты (старый route - redirect) */}
          <Route path="/admin/clients" element={<Navigate to="/admin/companies" replace />} />

          {/* Worker self-service — own time / payments / history */}
          <Route path="/my-time" element={<MyTimePage />} />

          {/* Admin — workers overview + per-worker drill-down */}
          <Route path="/admin/workers" element={<AdminWorkersListPage />} />
          <Route path="/admin/workers/:userId" element={<AdminWorkerDetailPage />} />

          {/* Профиль пользователя */}
          <Route path="/profile" element={<ProfilePage />} />

          {/* Настройки */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/calculator" element={<SettingsCalculatorPage />} />

          {/* Главный дашборд (старая страница) */}
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* О проекте */}
          <Route path="/about" element={<AboutProjectPage />} />
          <Route path="/docs" element={<CodeDocumentationPage />} />

          {/* DevLog & Blog */}
          <Route path="/admin/devlog/new" element={<DevLogCreatePage />} />
          <Route path="/blog" element={<DevLogBlogPage />} />

          {/* Super Admin */}
          <Route path="/superadmin" element={<SuperAdminDashboard />} />

          {/* Другие модули (placeholder) */}
          {/* Estimates Routes */}
          <Route path="/estimates" element={<EstimatesPage />} />
          <Route path="/estimates/new" element={<EstimateBuilderPage />} />
          <Route path="/estimates/:id" element={<EstimateBuilderPage />} />
          <Route path="/estimates/electrical" element={<ElectricalEstimatorPage />} />
          <Route path="/estimates/projects" element={<SavedEstimatesPage />} />
          <Route path="/estimates/projects/:id" element={<ProjectWorkspacePage />} />
          <Route path="/estimates/projects/:projectId/versions/:id" element={<EstimateDetailPage />} />

          {/* CRM Routes */}
          <Route path="/crm/clients" element={<ClientsPage />} />
          <Route path="/crm/clients/new" element={<ClientBuilderPage />} />
          <Route path="/crm/clients/:id" element={<ClientDetailsPage />} />
          <Route path="/crm/clients/:id/edit" element={<ClientBuilderPage />} />
          <Route path="/crm/landings" element={<LandingsPage />} />

          {/* Internal Client Dashboard */}
          <Route path="/dashboard/client/:id" element={<ClientDashboardPage />} />

          {/* V3/V4 Unified CRM Tasks Routes */}
          <Route path="/crm/tasks" element={<UnifiedTasksPage />} />
          <Route path="/crm/deals" element={<DealsPage />} />
          <Route path="/crm/leads/:id" element={<LeadDetailsPage />} />
          <Route path="/crm/gtd/new" element={<GTDCreatePage />} />
          <Route path="/crm/gtd/:taskId" element={<UnifiedCockpitPage />} />
          <Route path="/crm/cockpit/:taskId" element={<UnifiedCockpitPage />} />

          {/* Legacy Redirects to Unified View */}
          <Route path="/crm/gtd" element={<Navigate to="/crm/tasks?view=board" replace />} />
          <Route path="/crm/tasks-masonry" element={<Navigate to="/crm/tasks?view=timeline" replace />} />
          <Route path="/crm/calendar" element={<Navigate to="/crm/tasks?view=calendar" replace />} />
          <Route path="/crm/inbox" element={<Navigate to="/crm/tasks?view=board" replace />} />
          <Route path="/crm/shopping" element={<ShoppingPage />} />
          <Route path="/crm/time-tracking" element={<TimeTrackingPage />} />
          <Route path="/crm/finance" element={<FinancePage />} />
          <Route path="/crm/bank-statements" element={<BankStatementsPage />} />
          <Route path="/crm/reconciliation" element={<ReconciliationPage />} />
          <Route path="/crm/expenses-board" element={<ExpensesBoardPage />} />
          <Route path="/crm/tasks-masonry" element={<TasksMasonryPage />} />
          <Route path="/crm/costs" element={<CostsReportPage />} />
          <Route path="/crm/inventory" element={<InventoryPage />} />
          <Route path="/inventory" element={<InventoryStandalonePage />} />
          <Route path="/crm/payroll-periods" element={<PayrollPeriodsPage />} />
          <Route path="/crm/contacts" element={<ContactsPage />} />

          {/* Tasktotime — Phase 4.0 frontend foundation. */}
          {/* Index → list. Other view slugs route to ComingSoonView (URLs */}
          {/* are reserved so future PRs can flip them to real views without */}
          {/* breaking shared bookmarks). `/tasks/:id` is reserved for the   */}
          {/* detail page — it shows ComingSoonView until that PR lands.     */}
          <Route path="/crm/tasktotime" element={<TasktotimeLayout />}>
            <Route index element={<TaskListPage />} />
            <Route path="list" element={<TaskListPage />} />
            <Route path="inbox" element={<TasktotimeComingSoon label="Inbox" />} />
            <Route path="board" element={<TasktotimeComingSoon label="Board" />} />
            <Route path="timeline" element={<TasktotimeComingSoon label="Timeline" />} />
            <Route path="calendar" element={<TasktotimeComingSoon label="Calendar" />} />
            <Route path="gantt" element={<TasktotimeComingSoon label="Gantt" />} />
            <Route path="graph" element={<TasktotimeComingSoon label="Graph" />} />
            <Route path="hierarchy" element={<TasktotimeComingSoon label="Hierarchy" />} />
            <Route path="wiki" element={<TasktotimeComingSoon label="Wiki" />} />
            <Route path="reports" element={<TasktotimeComingSoon label="Reports" />} />
            <Route path="tasks/:id" element={<TasktotimeComingSoon label="Task Detail" />} />
          </Route>

          {/* Sites Dashboard */}
          <Route path="/sites/:siteId" element={<SiteDashboardPage />} />
          <Route path="/reports" element={<Navigate to="/ai-reports" replace />} />
          <Route path="/ai-reports" element={<AIReportsPage />} />
          <Route path="/admin/infra-map" element={<InfraMapPage />} />

          {/* Legacy Redirects */}
          <Route path="/clients" element={<Navigate to="/crm/clients" replace />} />
          <Route path="/projects" element={<Navigate to="/estimates" replace />} />
          <Route path="/tasks" element={<Navigate to="/crm/tasks" replace />} />
          <Route path="/documents" element={<Navigate to="/admin/dashboard" replace />} />
        </Route>

        {/* Dev Map - Public for Dev */}
        <Route path="/dev-map" element={<DevIndexPage />} />
        <Route path="/dev-health" element={<SystemHealthCheck />} />

        {/* Fallback для неизвестных маршрутов */}
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
};

export default AppRouter;

