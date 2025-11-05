import React from 'react';
import { Box } from '@mui/material';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';

/**
 * MainLayout - основной layout приложения
 * Включает Header, основной контент (через Outlet) и Footer
 *
 * Используется для всех защищенных страниц приложения.
 * Страницы Login, Register и т.д. НЕ используют этот layout.
 */
const MainLayout: React.FC = () => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh', // Минимальная высота = высота viewport
      }}
    >
      {/* Header - фиксированный сверху */}
      <Header />

      {/* Основной контент - растягивается, занимая все доступное пространство */}
      <Box
        component="main"
        sx={{
          flex: 1, // Занимает все доступное пространство
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Outlet - здесь рендерятся дочерние маршруты */}
        <Outlet />
      </Box>

      {/* Footer - прижат к низу благодаря flex: 1 у main */}
      <Footer />
    </Box>
  );
};

export default MainLayout;
