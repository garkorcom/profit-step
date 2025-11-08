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
import SuperAdminDashboard from '../pages/superadmin/SuperAdminDashboard';
import CompanyDashboard from '../pages/admin/CompanyDashboard';
import CompaniesPage from '../pages/admin/CompaniesPage';

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
        <Route path="/clients" element={<div>Модуль "Клиенты" в разработке</div>} />
        <Route path="/projects" element={<div>Модуль "Проекты" в разработке</div>} />
        <Route path="/tasks" element={<div>Модуль "Задачи" в разработке</div>} />
        <Route path="/documents" element={<div>Модуль "Документы" в разработке</div>} />
      </Route>

      {/* Fallback для неизвестных маршрутов */}
      <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
    </Routes>
  );
};

export default AppRouter;
