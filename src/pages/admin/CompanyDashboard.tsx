import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Tabs,
  Tab,
  Alert,
  CircularProgress,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  People as PeopleIcon,
  PersonAdd as PersonAddIcon,
  TrendingUp as TrendingIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';
import { Link } from 'react-router-dom';
import { KPICard } from '../../components/dashboard/KPICard';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`company-tabpanel-${index}`}
      aria-labelledby={`company-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

interface TeamStats {
  totalMembers: number;
  pendingInvites: number;
  activeToday: number;
  newThisMonth: number;
}

/**
 * Company Admin Dashboard
 * Дашборд для управления командой компании
 */
const CompanyDashboard: React.FC = () => {
  const { userProfile } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [stats, setStats] = useState<TeamStats>({
    totalMembers: 0,
    pendingInvites: 0,
    activeToday: 0,
    newThisMonth: 0,
  });
  const [loading, setLoading] = useState(true);

  // Проверка прав доступа
  const isAdmin = userProfile?.role === 'admin';

  // Загрузка статистики команды
  useEffect(() => {
    const loadTeamStats = async () => {
      if (!userProfile?.companyId) return;

      try {
        setLoading(true);
        const usersRef = collection(db, 'users');
        const companyQuery = query(usersRef, where('companyId', '==', userProfile.companyId));
        const snapshot = await getDocs(companyQuery);

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        let totalMembers = 0;
        let pendingInvites = 0;
        let activeToday = 0;
        let newThisMonth = 0;

        snapshot.forEach((doc) => {
          const userData = doc.data();

          // Подсчет активных участников
          if (userData.status === 'active') {
            totalMembers++;
          }

          // Подсчет ожидающих приглашений
          if (userData.status === 'pending') {
            pendingInvites++;
          }

          // Подсчет активных сегодня
          if (userData.lastSeen) {
            const lastSeenDate = new Date(userData.lastSeen);
            if (lastSeenDate >= today) {
              activeToday++;
            }
          }

          // Подсчет новых за месяц
          if (userData.createdAt) {
            const createdDate = userData.createdAt.toDate ? userData.createdAt.toDate() : new Date(userData.createdAt);
            if (createdDate >= firstDayOfMonth) {
              newThisMonth++;
            }
          }
        });

        setStats({
          totalMembers,
          pendingInvites,
          activeToday,
          newThisMonth,
        });
      } catch (error) {
        console.error('Error loading team stats:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTeamStats();
  }, [userProfile?.companyId]);

  if (!isAdmin) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Alert severity="error">
          У вас нет прав доступа к этой странице. Только администраторы компании могут просматривать
          эту панель.
        </Alert>
      </Container>
    );
  }

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3 } }}>
      {/* Заголовок */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
          Dashboard Команды
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Обзор и управление вашей командой
        </Typography>
      </Box>

      {/* Team Overview KPIs */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={{ xs: 2, sm: 3 }} sx={{ mb: 4 }}>
          {/* Карточка "Всего Участников" */}
          <Grid size={{ xs: 12, md: 6, lg: 3 }}>
            <Link to="/admin/team?status=active" style={{ textDecoration: 'none' }}>
              <KPICard
                title="Участники"
                value={stats.totalMembers}
                subtitle="Активных членов команды"
                icon={<PeopleIcon />}
                color="primary"
              />
            </Link>
          </Grid>

          {/* Карточка "Ожидающие Приглашения" */}
          <Grid size={{ xs: 12, md: 6, lg: 3 }}>
            <Link to="/admin/team?status=pending" style={{ textDecoration: 'none' }}>
              <KPICard
                title="Приглашения"
                value={stats.pendingInvites}
                subtitle="Ожидают подтверждения"
                icon={<PersonAddIcon />}
                color="warning"
              />
            </Link>
          </Grid>

          {/* Карточка "Активные Сегодня" */}
          <Grid size={{ xs: 12, md: 6, lg: 3 }}>
            <Link to="/admin/team?status=active_today" style={{ textDecoration: 'none' }}>
              <KPICard
                title="Активность"
                value={stats.activeToday}
                subtitle="Активных сегодня"
                icon={<TrendingIcon />}
                color="success"
              />
            </Link>
          </Grid>

          {/* Карточка "Новые за месяц" */}
          <Grid size={{ xs: 12, md: 6, lg: 3 }}>
            <Link to="/admin/team?status=new_month" style={{ textDecoration: 'none' }}>
              <KPICard
                title="Рост"
                value={`+${stats.newThisMonth}`}
                subtitle="Новых за месяц"
                icon={<TimelineIcon />}
                color="info"
              />
            </Link>
          </Grid>
        </Grid>
      )}

      {/* Вкладки */}
      <Paper sx={{ mb: 2 }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab icon={<PeopleIcon />} label="Команда" />
          <Tab icon={<PersonAddIcon />} label="Приглашения" />
          <Tab icon={<TimelineIcon />} label="Активность" />
        </Tabs>
      </Paper>

      {/* Контент вкладок */}
      <TabPanel value={activeTab} index={0}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" gutterBottom sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
            Участники команды
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Полный список пользователей доступен на странице "Управление командой"
          </Typography>
          <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">
              👥 Таблица участников в разработке
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Используйте страницу /admin/team для полного управления командой
            </Typography>
          </Box>
        </Paper>
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" gutterBottom sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
            История приглашений
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Отслеживание статуса отправленных приглашений
          </Typography>
          <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">
              📧 Таблица приглашений с статусами Brevo в разработке
            </Typography>
          </Box>
        </Paper>
      </TabPanel>

      <TabPanel value={activeTab} index={2}>
        <Grid container spacing={{ xs: 2, sm: 3 }}>
          {/* Activity Feed */}
          <Grid size={{ xs: 12, md: 8 }}>
            <Paper sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="h6" gutterBottom sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
                Лента активности
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Последние действия в команде
              </Typography>
              <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary">
                  📋 Activity timeline в разработке
                </Typography>
              </Box>
            </Paper>
          </Grid>

          {/* Top Contributors */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="h6" gutterBottom sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
                Топ активных
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                За этот месяц
              </Typography>
              <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary">
                  🏆 Leaderboard в разработке
                </Typography>
              </Box>
            </Paper>
          </Grid>

          {/* Activity Heatmap */}
          <Grid size={{ xs: 12 }}>
            <Paper sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="h6" gutterBottom sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
                Активность команды по дням и часам
              </Typography>
              <Box sx={{ mt: 2, textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary">
                  🔥 Activity heatmap в разработке
                </Typography>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </TabPanel>
    </Container>
  );
};

export default CompanyDashboard;
