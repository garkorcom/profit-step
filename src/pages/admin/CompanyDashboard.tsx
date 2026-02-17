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
  Grid,
  List,
  ListItem,
  ListItemText,
  Chip,
  Button
} from '@mui/material';
import {
  People as PeopleIcon,
  PersonAdd as PersonAddIcon,
  TrendingUp as TrendingIcon,
  Timeline as TimelineIcon,
  MonetizationOn as MonetizationOnIcon,
  ArrowForward as ArrowForwardIcon,
  Launch as LaunchIcon,
  AccessTime as AccessTimeIcon,
  MenuBook as MenuBookIcon,
  Edit as EditIcon
} from '@mui/icons-material';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../../auth/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { KPICard } from '../../components/dashboard/KPICard';
import { collection, query, where, getDocs, orderBy, limit, Timestamp } from 'firebase/firestore';
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
  newDealsCount: number;
}

interface Lead {
  id: string;
  name: string;
  phone: string;
  service: string;
  status: string;
  createdAt: Timestamp;
  value?: number;
}

interface MarketingStats {
  visitorsToday: number;
  conversionsToday: number;
  conversionRate: string;
}

/**
 * Company Admin Dashboard
 * Дашборд для управления командой компании
 */
const CompanyDashboard: React.FC = () => {
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);
  const [stats, setStats] = useState<TeamStats>({
    totalMembers: 0,
    pendingInvites: 0,
    activeToday: 0,
    newThisMonth: 0,
    newDealsCount: 0,
  });
  const [marketingStats, setMarketingStats] = useState<MarketingStats>({
    visitorsToday: 0,
    conversionsToday: 0,
    conversionRate: '0'
  });
  const [recentDeals, setRecentDeals] = useState<Lead[]>([]);
  const [sourceData, setSourceData] = useState<{ name: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  // Проверка прав доступа
  const isAdmin = userProfile?.role === 'admin';

  // Загрузка статистики команды
  useEffect(() => {
    const loadTeamStats = async () => {
      if (!userProfile?.companyId) return;

      try {
        setLoading(true);
        const usersRef = collection(db, 'users');
        const leadsRef = collection(db, 'leads');

        // Parallel queries for better performance
        const [allUsersSnap, activeUsersSnap, newDealsSnap] = await Promise.all([
          getDocs(query(usersRef, where('companyId', '==', userProfile.companyId))),
          getDocs(query(usersRef, where('companyId', '==', userProfile.companyId), where('status', '==', 'active'))),
          getDocs(query(leadsRef, where('status', '==', 'new')))
        ]);

        // Fetch recent deals separately to order them
        // Note: We fetch all 'new' leads and sort client-side to avoid creating a composite index for now
        const recentDealsSnap = await getDocs(query(leadsRef, where('status', '==', 'new')));
        const recentDealsData = recentDealsSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as Lead))
          .sort((a, b) => {
            const dateA = a.createdAt?.seconds || 0;
            const dateB = b.createdAt?.seconds || 0;
            return dateB - dateA;
          })
          .sort((a, b) => {
            const dateA = a.createdAt?.seconds || 0;
            const dateB = b.createdAt?.seconds || 0;
            return dateB - dateA;
          });
        setRecentDeals(recentDealsData);

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        let pendingInvites = 0;
        let activeToday = 0;
        let newThisMonth = 0;

        allUsersSnap.forEach((doc) => {
          const userData = doc.data();

          if (userData.status === 'pending') pendingInvites++;

          if (userData.lastSeen) {
            const lastSeenDate = new Date(userData.lastSeen); // or .toDate() if Timestamp
            // Handle Firestore Timestamp conversion safely
            const dateObj = typeof userData.lastSeen.toDate === 'function'
              ? userData.lastSeen.toDate()
              : new Date(userData.lastSeen);

            if (dateObj >= today) activeToday++;
          }

          if (userData.createdAt) {
            const createdDate = typeof userData.createdAt.toDate === 'function'
              ? userData.createdAt.toDate()
              : new Date(userData.createdAt);
            if (createdDate >= firstDayOfMonth) newThisMonth++;
          }
        });

        setStats({
          totalMembers: activeUsersSnap.size, // Use count from specific query
          pendingInvites,
          activeToday,
          newThisMonth,
          newDealsCount: newDealsSnap.size
        });

        // --- Marketing Analytics ---
        const eventsRef = collection(db, 'landing_events');
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const eventsSnap = await getDocs(query(
          eventsRef,
          where('timestamp', '>=', Timestamp.fromDate(startOfDay))
        ));

        const events = eventsSnap.docs.map(doc => doc.data());
        const visitors = new Set(events.filter(e => e.type === 'page_view').map(e => e.visitorId)).size;
        const conversions = events.filter(e => e.type === 'form_submit').length;

        setMarketingStats({
          visitorsToday: visitors,
          conversionsToday: conversions,
          conversionRate: visitors > 0 ? ((conversions / visitors) * 100).toFixed(1) : '0'
        });

        // Fetch Leads for Source Chart
        const leadsQuery = query(collection(db, 'leads'));
        const leadsSnap = await getDocs(leadsQuery);
        const sourceCounts: Record<string, number> = {};
        leadsSnap.forEach(doc => {
          const data = doc.data();
          const source = data.source || 'Unknown';
          // Clean up source names for display
          let label = source;
          if (source === 'landing_page_creative') label = 'Creative LP';
          else if (source === 'landing_page_high_end') label = 'High-End LP';
          else if (source === 'landing_page_garkor') label = 'Garkor LP';
          else if (source === 'landing_page') label = 'Standard LP';

          sourceCounts[label] = (sourceCounts[label] || 0) + 1;
        });

        const chartData = Object.keys(sourceCounts).map(key => ({
          name: key,
          value: sourceCounts[key]
        }));
        setSourceData(chartData);

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
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" gutterBottom sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
            Dashboard Команды
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Обзор и управление вашей командой
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<MenuBookIcon />}
            component={Link}
            to="/docs"
          >
            Документация
          </Button>
          <Button
            variant="outlined"
            startIcon={<EditIcon />}
            component={Link}
            to="/blog"
          >
            DevLog
          </Button>
          <Button
            variant="outlined"
            startIcon={<AccessTimeIcon />}
            component={Link}
            to="/crm/time-tracking"
          >
            Time Reports
          </Button>
          <Button
            variant="outlined"
            startIcon={<LaunchIcon />}
            component="a"
            href="/promo/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Landing Page
          </Button>
        </Box>
      </Box>

      {/* Team Overview KPIs */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={{ xs: 2, sm: 3 }} sx={{ mb: 4 }}>
          {/* Карточка "Новые Сделки" */}
          <Grid size={{ xs: 12, md: 6, lg: 3 }}>
            <KPICard
              title="Новые Сделки"
              value={stats.newDealsCount}
              subtitle="Требуют внимания"
              icon={<MonetizationOnIcon />}
              color="error"
              onClick={() => navigate('/crm/deals')}
            >
              <Box
                sx={{ mt: 1, display: 'flex', alignItems: 'center', fontSize: '0.875rem' }}
                onClick={(e) => e.stopPropagation()}
              >
                <Link
                  to="/promo/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                >
                  <LaunchIcon sx={{ fontSize: 16, mr: 0.5 }} />
                  Landing Page
                </Link>
              </Box>
            </KPICard>
          </Grid>

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
        </Grid>
      )}

      {/* Marketing Analytics Section */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
            Маркетинг (Landing Page)
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="text"
              endIcon={<LaunchIcon />}
              component="a"
              href="/landings.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              All Landings
            </Button>
            <Button
              variant="outlined"
              endIcon={<LaunchIcon />}
              component="a"
              href="/promo/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Standard
            </Button>
            <Button
              variant="contained"
              endIcon={<LaunchIcon />}
              component="a"
              href="/promo-high-end/"
              target="_blank"
              rel="noopener noreferrer"
              color="secondary"
            >
              High-End
            </Button>
            <Button
              variant="contained"
              endIcon={<LaunchIcon />}
              component="a"
              href="/promo-creative/"
              target="_blank"
              rel="noopener noreferrer"
              color="info"
            >
              Creative
            </Button>
            <Button
              variant="contained"
              endIcon={<LaunchIcon />}
              component="a"
              href="/promo-garkor/"
              target="_blank"
              rel="noopener noreferrer"
              sx={{ bgcolor: '#D4AF37', '&:hover': { bgcolor: '#b5952f' } }}
            >
              Garkor
            </Button>
          </Box>
        </Box>
        <Grid container spacing={{ xs: 2, sm: 3 }}>
          {/* Visitors Today */}
          <Grid size={{ xs: 12, md: 4 }}>
            <KPICard
              title="Посетители сегодня"
              value={marketingStats.visitorsToday}
              subtitle="Уникальные визиты"
              icon={<PeopleIcon />}
              color="info"
            />
          </Grid>
          {/* Conversions Today */}
          <Grid size={{ xs: 12, md: 4 }}>
            <KPICard
              title="Заявки сегодня"
              value={marketingStats.conversionsToday}
              subtitle="Отправленные формы"
              icon={<MonetizationOnIcon />}
              color="success"
            />
          </Grid>
          {/* Conversion Rate */}
          <Grid size={{ xs: 12, md: 4 }}>
            <KPICard
              title="Конверсия"
              value={`${marketingStats.conversionRate}%`}
              subtitle="В заявку"
              icon={<TrendingIcon />}
              color="warning"
            />
          </Grid>
        </Grid>
      </Box>

      {/* Вкладки */}
      <Paper sx={{ mb: 2 }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab icon={<MonetizationOnIcon />} label="Новые Сделки" />
          <Tab icon={<PeopleIcon />} label="Команда" />
          <Tab icon={<PersonAddIcon />} label="Приглашения" />
          <Tab icon={<TimelineIcon />} label="Активность" />
        </Tabs>
      </Paper>

      {/* Контент вкладок */}
      <TabPanel value={activeTab} index={0}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6" sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
              Последние новые сделки
            </Typography>
            <Button component={Link} to="/crm/deals" endIcon={<ArrowForwardIcon />}>
              Все сделки
            </Button>
          </Box>

          {recentDeals.length > 0 ? (
            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
              <List>
                {recentDeals.map((deal) => (
                  <ListItem key={deal.id} divider>
                    <ListItemText
                      primary={deal.name}
                      secondary={
                        <React.Fragment>
                          <Typography component="span" variant="body2" color="text.primary">
                            {deal.service}
                          </Typography>
                          {` — ${deal.phone}`}
                        </React.Fragment>
                      }
                    />
                    <Box>
                      {deal.value && (
                        <Chip label={`$${deal.value}`} size="small" color="success" variant="outlined" sx={{ mr: 1 }} />
                      )}
                      <Chip label={new Date(deal.createdAt?.seconds * 1000).toLocaleDateString()} size="small" />
                    </Box>
                  </ListItem>
                ))}
              </List>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
              Нет новых сделок
            </Typography>
          )}
        </Paper>
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
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

      <TabPanel value={activeTab} index={2}>
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

      <TabPanel value={activeTab} index={3}>
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
