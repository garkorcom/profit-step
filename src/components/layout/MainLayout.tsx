import React from 'react';
import { Box } from '@mui/material';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';

/**
 * MainLayout - основной layout приложения
 * Включает Header, основной контент (через Outlet) и Footer
 *
 * Используется для всех защищенных страниц приложения.
 * Страницы Login, Register и т.д. НЕ используют этот layout.
 *
 * Footer скрыт на GTD страницах для максимизации рабочей области (Pixel Fold opt).
 */
const MainLayout: React.FC = () => {
  const location = useLocation();
  const hideFooter = location.pathname.startsWith('/crm/gtd');

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
      }}
    >
      <Header />

      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <Outlet />
      </Box>

      {!hideFooter && <Footer />}
    </Box>
  );
};

export default MainLayout;
