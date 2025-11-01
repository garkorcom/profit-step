import React from 'react';
import { Box, Container, Typography, Link as MuiLink } from '@mui/material';
import { Link } from 'react-router-dom';
import {
  Home as HomeIcon,
  People as PeopleIcon,
  Work as WorkIcon,
  Task as TaskIcon,
  Folder as FolderIcon,
  AdminPanelSettings as AdminIcon,
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';

/**
 * Футер с картой сайта
 */
const Footer: React.FC = () => {
  const { userProfile } = useAuth();
  const isAdmin = userProfile?.role === 'admin';

  const mainLinks = [
    { title: 'Главная', path: '/', icon: <HomeIcon sx={{ fontSize: 18 }} /> },
  ];

  const moduleLinks = [
    { title: 'Клиенты', path: '/clients', icon: <PeopleIcon sx={{ fontSize: 18 }} /> },
    { title: 'Проекты', path: '/projects', icon: <WorkIcon sx={{ fontSize: 18 }} /> },
    { title: 'Задачи', path: '/tasks', icon: <TaskIcon sx={{ fontSize: 18 }} /> },
    { title: 'Документы', path: '/documents', icon: <FolderIcon sx={{ fontSize: 18 }} /> },
  ];

  const adminLinks = [
    { title: 'Управление командой', path: '/admin/team', icon: <AdminIcon sx={{ fontSize: 18 }} /> },
  ];

  return (
    <Box
      component="footer"
      sx={{
        bgcolor: 'grey.900',
        color: 'white',
        py: 6,
        mt: 8,
      }}
    >
      <Container maxWidth="lg">
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              md: isAdmin ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)',
            },
            gap: 4,
          }}
        >
          {/* Основные разделы */}
          <Box>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
              Навигация
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {mainLinks.map((link) => (
                <MuiLink
                  key={link.path}
                  component={Link}
                  to={link.path}
                  sx={{
                    color: 'grey.400',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    '&:hover': {
                      color: 'white',
                    },
                  }}
                >
                  {link.icon}
                  {link.title}
                </MuiLink>
              ))}
            </Box>
          </Box>

          {/* Модули */}
          <Box>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
              Модули
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {moduleLinks.map((link) => (
                <MuiLink
                  key={link.path}
                  component={Link}
                  to={link.path}
                  sx={{
                    color: 'grey.400',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    '&:hover': {
                      color: 'white',
                    },
                  }}
                >
                  {link.icon}
                  {link.title}
                </MuiLink>
              ))}
            </Box>
          </Box>

          {/* Административные разделы */}
          {isAdmin && (
            <Box>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
                Администрирование
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {adminLinks.map((link) => (
                  <MuiLink
                    key={link.path}
                    component={Link}
                    to={link.path}
                    sx={{
                      color: 'grey.400',
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      '&:hover': {
                        color: 'white',
                      },
                    }}
                  >
                    {link.icon}
                    {link.title}
                  </MuiLink>
                ))}
              </Box>
            </Box>
          )}

          {/* О приложении */}
          <Box>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
              Profit Step
            </Typography>
            <Typography variant="body2" sx={{ color: 'grey.400', mb: 1 }}>
              Система управления проектами и сметами
            </Typography>
            <Typography variant="body2" sx={{ color: 'grey.400' }}>
              Версия: 1.0.0
            </Typography>
          </Box>
        </Box>

        {/* Copyright */}
        <Box
          sx={{
            borderTop: 1,
            borderColor: 'grey.800',
            mt: 4,
            pt: 3,
            textAlign: 'center',
          }}
        >
          <Typography variant="body2" sx={{ color: 'grey.500' }}>
            © {new Date().getFullYear()} Profit Step. Все права защищены.
          </Typography>
        </Box>
      </Container>
    </Box>
  );
};

export default Footer;
