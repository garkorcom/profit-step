import React from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Button,
} from '@mui/material';
import {
  People as PeopleIcon,
  Work as WorkIcon,
  Task as TaskIcon,
  Folder as FolderIcon,
  MonitorHeart as MonitorIcon,
  Campaign as CampaignIcon,
} from '@mui/icons-material';
import { useAuth } from '../auth/AuthContext';
import { useNavigate } from 'react-router-dom';
import Footer from '../components/layout/Footer';
import AIReportsSection from '../components/dashboard/AIReportsSection';

const DashboardPage: React.FC = () => {
  const { currentUser, userProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Ошибка выхода:', error);
    }
  };

  const modules = [
    {
      title: 'Клиенты',
      description: 'Управление клиентами и контрагентами',
      icon: <PeopleIcon sx={{ fontSize: 60 }} />,
      color: '#1976d2',
      path: '/clients',
    },
    {
      title: 'Проекты',
      description: 'Проекты и сделки',
      icon: <WorkIcon sx={{ fontSize: 60 }} />,
      color: '#2e7d32',
      path: '/projects',
    },
    {
      title: 'Задачи',
      description: 'Task management и календарь',
      icon: <TaskIcon sx={{ fontSize: 60 }} />,
      color: '#ed6c02',
      path: '/tasks',
    },
    {
      title: 'Документы',
      description: 'Хранение и управление файлами',
      icon: <FolderIcon sx={{ fontSize: 60 }} />,
      color: '#9c27b0',
      path: '/documents',
    },
    {
      title: 'Лендинги',
      description: 'Управление промо-сайтами',
      icon: <CampaignIcon sx={{ fontSize: 60 }} />,
      color: '#d81b60',
      path: '/crm/landings',
    },
    {
      title: 'Мониторинг',
      description: 'Серверы, агенты, каналы связи',
      icon: <MonitorIcon sx={{ fontSize: 60 }} />,
      color: '#00897b',
      path: '__external__http://206.81.8.2:8000',
    },
  ];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <Box sx={{ bgcolor: 'primary.main', color: 'white', py: 3 }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h4">Profit Step</Typography>
            <Box>
              <Typography variant="body1" sx={{ mb: 0.5 }}>
                {userProfile?.displayName || currentUser?.displayName || 'User'}
              </Typography>
              <Typography variant="body2" sx={{ mb: 1, opacity: 0.8 }}>
                {currentUser?.email}
              </Typography>
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                onClick={handleSignOut}
              >
                Выйти
              </Button>
            </Box>
          </Box>
        </Container>
      </Box>

      {/* Main Content */}
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Typography variant="h5" gutterBottom>
          Панель управления
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Выберите модуль для работы
        </Typography>

        {/* AI Reports Section */}
        <AIReportsSection />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              md: 'repeat(4, 1fr)',
            },
            gap: 3,
          }}
        >
          {modules.map((module) => (
            <Paper
              key={module.title}
              elevation={2}
              sx={{
                p: 3,
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.3s',
                '&:hover': {
                  elevation: 6,
                  transform: 'translateY(-4px)',
                },
              }}
              onClick={() => module.path.startsWith('__external__') ? window.open(module.path.replace('__external__', ''), '_blank') : navigate(module.path)}
            >
              <Box sx={{ color: module.color, mb: 2 }}>
                {module.icon}
              </Box>
              <Typography variant="h6" gutterBottom>
                {module.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {module.description}
              </Typography>
            </Paper>
          ))}
        </Box>

        {/* Placeholder for modules */}
        <Box sx={{ mt: 6 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Статус разработки
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Базовая структура приложения создана. Модули находятся в разработке.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Планируемые модули:
            </Typography>
            <ul>
              <li>Клиенты/Контрагенты - управление клиентами</li>
              <li>Проекты/Сделки - управление проектами</li>
              <li>Задачи/Календарь - task management</li>
              <li>Документы/Файлы - хранение документов</li>
            </ul>
          </Paper>
        </Box>
      </Container>

      {/* Footer */}
      <Footer />
    </Box>
  );
};

export default DashboardPage;
