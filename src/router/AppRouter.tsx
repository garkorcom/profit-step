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
const EstimatesPage = React.lazy(() => import('../pages/estimates/EstimatesPage'));
const EstimateBuilderPage = React.lazy(() => import('../pages/estimates/EstimateBuilderPage'));
const ElectricalEstimatorPage = React.lazy(() => import('../pages/estimates/ElectricalEstimatorPage'));
const SuperAdminDashboard = React.lazy(() => import('../pages/superadmin/SuperAdminDashboard'));
const CompanyDashboard = React.lazy(() => import('../pages/admin/CompanyDashboard'));
const CompaniesPage = React.lazy(() => import('../pages/admin/CompaniesPage'));
const ClientsPage = React.lazy(() => import('../pages/crm/ClientsPage'));
const ClientDetailsPage = React.lazy(() => import('../pages/crm/ClientDetailsPage'));
const ClientBuilderPage = React.lazy(() => import('../pages/crm/ClientBuilderPage'));
const DevIndexPage = React.lazy(() => import('../pages/DevIndexPage'));
const SystemHealthCheck = React.lazy(() => import('../pages/debug/SystemHealthCheck'));
const TasksPage = React.lazy(() => import('../pages/crm/TasksPage'));
const DealsPage = React.lazy(() => import('../pages/crm/DealsPage'));
const CalendarPage = React.lazy(() => import('../pages/crm/CalendarPage'));
const LeadDetailsPage = React.lazy(() => import('../pages/crm/LeadDetailsPage'));
const TimeTrackingPage = React.lazy(() => import('../pages/crm/TimeTrackingPage'));
const FinancePage = React.lazy(() => import('../pages/crm/FinancePage'));
const GTDPage = React.lazy(() => import('../pages/crm/GTDPage'));
const GTDTaskDetailsPage = React.lazy(() => import('../pages/crm/GTDTaskDetailsPage'));
const ShoppingPage = React.lazy(() => import('../pages/crm/ShoppingPage'));
const PayrollPeriodsPage = React.lazy(() => import('../pages/crm/PayrollPeriodsPage'));
const RolesPage = React.lazy(() => import('../pages/admin/RolesPage'));

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

          {/* Роли и права доступа */}
          <Route path="/admin/roles" element={<RolesPage />} />

          {/* Компании (Клиенты) */}
          <Route path="/admin/companies" element={<CompaniesPage />} />

          {/* Клиенты (старый route - redirect) */}
          <Route path="/admin/clients" element={<Navigate to="/admin/companies" replace />} />

          {/* Профиль пользователя */}
          <Route path="/profile" element={<ProfilePage />} />

          {/* Настройки */}
          <Route path="/settings" element={<SettingsPage />} />

          {/* Главный дашборд (старая страница) */}
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* Super Admin */}
          <Route path="/superadmin" element={<SuperAdminDashboard />} />

          {/* Другие модули (placeholder) */}
          {/* Estimates Routes */}
          <Route path="/estimates" element={<EstimatesPage />} />
          <Route path="/estimates/new" element={<EstimateBuilderPage />} />
          <Route path="/estimates/:id" element={<EstimateBuilderPage />} />
          <Route path="/estimates/electrical" element={<ElectricalEstimatorPage />} />

          {/* CRM Routes */}
          <Route path="/crm/clients" element={<ClientsPage />} />
          <Route path="/crm/clients/new" element={<ClientBuilderPage />} />
          <Route path="/crm/clients/:id" element={<ClientDetailsPage />} />
          <Route path="/crm/clients/:id/edit" element={<ClientBuilderPage />} />

          {/* Placeholders for V2.1 & V3.1 & V4 */}
          <Route path="/crm/deals" element={<DealsPage />} />
          <Route path="/crm/calendar" element={<CalendarPage />} />
          <Route path="/crm/leads/:id" element={<LeadDetailsPage />} />
          <Route path="/crm/tasks" element={<TasksPage />} />
          <Route path="/crm/gtd" element={<GTDPage />} />
          <Route path="/crm/gtd/:taskId" element={<GTDTaskDetailsPage />} />
          <Route path="/crm/shopping" element={<ShoppingPage />} />
          <Route path="/crm/scheduler" element={<div>Scheduler (Coming Soon)</div>} />
          <Route path="/crm/time-tracking" element={<TimeTrackingPage />} />
          <Route path="/crm/finance" element={<FinancePage />} />
          <Route path="/crm/payroll-periods" element={<PayrollPeriodsPage />} />
          <Route path="/reports" element={<div>Reports Hub (Coming Soon)</div>} />

          {/* Legacy Redirects */}
          <Route path="/clients" element={<Navigate to="/crm/clients" replace />} />
          <Route path="/projects" element={<div>Модуль "Проекты" в разработке</div>} />
          <Route path="/tasks" element={<div>Модуль "Задачи" в разработке</div>} />
          <Route path="/documents" element={<div>Модуль "Документы" в разработке</div>} />
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

