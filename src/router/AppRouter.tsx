import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import MainLayout from '../components/layout/MainLayout';
import LoginPage from '../pages/auth/LoginPage';
import SignupPage from '../pages/auth/SignupPage';
import ForgotPasswordPage from '../pages/auth/ForgotPasswordPage';
import DashboardPage from '../pages/DashboardPage';
import ProfilePage from '../pages/ProfilePage';
import SettingsPage from '../pages/SettingsPage';
import TeamAdminPage from '../pages/admin/TeamAdminPage';
import EstimatesPage from '../pages/estimates/EstimatesPage';
import EstimateBuilderPage from '../pages/estimates/EstimateBuilderPage';
import ElectricalEstimatorPage from '../pages/estimates/ElectricalEstimatorPage';
import SuperAdminDashboard from '../pages/superadmin/SuperAdminDashboard';
import CompanyDashboard from '../pages/admin/CompanyDashboard';
import CompaniesPage from '../pages/admin/CompaniesPage';
import ClientsPage from '../pages/crm/ClientsPage';
import ClientDetailsPage from '../pages/crm/ClientDetailsPage';
import ClientBuilderPage from '../pages/crm/ClientBuilderPage';
import DevIndexPage from '../pages/DevIndexPage';
import SystemHealthCheck from '../pages/debug/SystemHealthCheck';
import TasksPage from '../pages/crm/TasksPage';
import DealsPage from '../pages/crm/DealsPage';
import CalendarPage from '../pages/crm/CalendarPage';
import LeadDetailsPage from '../pages/crm/LeadDetailsPage';
import TimeTrackingPage from '../pages/crm/TimeTrackingPage';
import FinancePage from '../pages/crm/FinancePage';
import GTDPage from '../pages/crm/GTDPage';
import GTDTaskDetailsPage from '../pages/crm/GTDTaskDetailsPage';
import PayrollPeriodsPage from '../pages/crm/PayrollPeriodsPage';

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
  );
};

export default AppRouter;
