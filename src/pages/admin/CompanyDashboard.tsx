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
  Button,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Avatar,
  SelectChangeEvent
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
  Edit as EditIcon,
  SmartToy as SmartToyIcon,
  Warning as WarningIcon,
  FiberManualRecord as FiberManualRecordIcon
} from '@mui/icons-material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../../auth/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { KPICard } from '../../components/dashboard/KPICard';
import { collection, query, where, getDocs, Timestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

import { useDashboardFinance } from '../../hooks/dashboard/useDashboardFinance';
import { useDashboardTime } from '../../hooks/dashboard/useDashboardTime';
import { useDashboardTasks, type UrgentTask } from '../../hooks/dashboard/useDashboardTasks';
import { useDashboardActivity } from '../../hooks/dashboard/useDashboardActivity';

import { FinanceWidget } from '../../components/dashboard/widgets/FinanceWidget';
import { TimeTrackingWidget } from '../../components/dashboard/widgets/TimeTrackingWidget';
import { TasksWidget } from '../../components/dashboard/widgets/TasksWidget';
import { ActivityFeedWidget } from '../../components/dashboard/widgets/ActivityFeedWidget';

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

interface MonthlyPnL {
  month: string;
  income: number;
  expenses: number;
  profit: number;
  client?: string;
}

interface ActiveEmployee {
  id: string;
  employeeName: string;
  startedAt: Date;
  projectName?: string;
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
  const [loading, setLoading] = useState(true);

  // --- New V2+ State ---
  const [monthlyPnL, setMonthlyPnL] = useState<MonthlyPnL[]>([]);
  const [pnlLoading, setPnlLoading] = useState(true);
  const [activeEmployees, setActiveEmployees] = useState<ActiveEmployee[]>([]);
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [availableClients, setAvailableClients] = useState<string[]>([]);

  // --- V2 Dashboard Hooks ---
  const financeData = useDashboardFinance(userProfile?.companyId);
  const timeData = useDashboardTime(userProfile?.companyId);
  const tasksData = useDashboardTasks(userProfile?.companyId);
  const [activityFilter, setActivityFilter] = useState('all');
  const activityData = useDashboardActivity(activityFilter);

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
            const _lastSeenDate = new Date(userData.lastSeen); // or .toDate() if Timestamp
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

        // (We no longer display pie charts for sources in v2)
      } catch (error) {
        console.error('Error loading team stats:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTeamStats();
  }, [userProfile?.companyId]);

  // --- P&L Monthly Data from costs + work_sessions ---
  useEffect(() => {
    const loadMonthlyPnL = async () => {
      if (!userProfile?.companyId) return;
      try {
        setPnlLoading(true);
        const now = new Date();
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

        const [costsSnap, sessionsSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'costs'),
            where('createdAt', '>=', Timestamp.fromDate(sixMonthsAgo))
          )),
          getDocs(query(
            collection(db, 'work_sessions'),
            where('companyId', '==', userProfile.companyId),
            where('status', '==', 'closed'),
            where('startTime', '>=', Timestamp.fromDate(sixMonthsAgo))
          )),
        ]);

        const monthMap: Record<string, { income: number; expenses: number; labor: number; clients: Set<string> }> = {};
        const clientSet = new Set<string>();

        // Initialize last 6 months
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          monthMap[key] = { income: 0, expenses: 0, labor: 0, clients: new Set() };
        }

        // Income & Expenses from costs
        costsSnap.forEach((doc) => {
          const data = doc.data();
          const costDate = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
          const key = costDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          const client = data.clientName || 'Unknown';

          if (client !== 'Unknown') clientSet.add(client);

          if (monthMap[key]) {
            monthMap[key].clients.add(client);
            const amount = Math.abs(data.amount || 0);
            if (data.type === 'income') {
              if (clientFilter === 'all' || client === clientFilter) {
                monthMap[key].income += amount;
              }
            } else if (data.type === 'expense') {
              if (clientFilter === 'all' || client === clientFilter) {
                monthMap[key].expenses += amount;
              }
            }
          }
        });

        // Labor from work_sessions (closed, minutes * hourlyRate / 60)
        sessionsSnap.forEach((doc) => {
          const data = doc.data();
          const sessDate = data.startTime?.toDate ? data.startTime.toDate() : new Date(data.startTime);
          const key = sessDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          const client = data.clientName || 'Unknown';

          if (client !== 'Unknown') clientSet.add(client);

          if (monthMap[key]) {
            const minutes = data.durationMinutes || 0;
            const rate = data.hourlyRate || 0;
            const earnings = (minutes * rate) / 60;
            if (clientFilter === 'all' || client === clientFilter) {
              monthMap[key].labor += earnings;
            }
          }
        });

        const pnlData: MonthlyPnL[] = Object.entries(monthMap).map(([month, values]) => ({
          month,
          income: Math.round(values.income),
          expenses: Math.round(values.expenses + values.labor),
          profit: Math.round(values.income - values.expenses - values.labor),
        }));

        setMonthlyPnL(pnlData);
        setAvailableClients(Array.from(clientSet).sort());
      } catch (error) {
        // QA 2026-04-27 P1-4: tightened RLS — silent on permission-denied.
        if ((error as { code?: string })?.code !== 'permission-denied') {
          console.error('Error loading P&L data:', error);
        }
      } finally {
        setPnlLoading(false);
      }
    };

    loadMonthlyPnL();
  }, [userProfile?.companyId, clientFilter]);

  // --- Active Employees Real-Time (onSnapshot) ---
  useEffect(() => {
    if (!userProfile?.companyId) return;

    const sessionsRef = collection(db, 'work_sessions');
    const activeQuery = query(
      sessionsRef,
      where('companyId', '==', userProfile.companyId),
      where('status', '==', 'active'),
    );

    const unsubscribe = onSnapshot(activeQuery, (snapshot) => {
      const employees: ActiveEmployee[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          employeeName: data.employeeName || data.userName || 'Unknown',
          startedAt: data.startedAt?.toDate ? data.startedAt.toDate() : new Date(data.startedAt),
          projectName: data.projectName || data.project || undefined,
        };
      });
      setActiveEmployees(employees);
    }, (error) => {
      // QA 2026-04-27 P1-4: tightened RLS — silent on permission-denied.
      if ((error as { code?: string })?.code !== 'permission-denied') {
        console.error('Error listening to active sessions:', error);
      }
    });

    return () => unsubscribe();
  }, [userProfile?.companyId]);

  // Helper: format elapsed time
  const formatElapsed = (startDate: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - startDate.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

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
            variant="contained"
            startIcon={<SmartToyIcon />}
            component={Link}
            to="/admin/infra-map"
            sx={{ bgcolor: '#0288d1', '&:hover': { bgcolor: '#0277bd' } }}
          >
            AI Инфраструктура
          </Button>
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

      {/* --- DASHBOARD V2 WIDGETS --- */}
      <Grid container spacing={{ xs: 2, sm: 3 }} sx={{ mb: 4, alignItems: 'stretch' }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <FinanceWidget data={financeData} />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <TimeTrackingWidget data={timeData} />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <TasksWidget data={tasksData} onAddTask={() => navigate('/crm/tasks?action=new')} />
        </Grid>
      </Grid>

      <Box sx={{ mb: 4 }}>
        <ActivityFeedWidget data={activityData} filterType={activityFilter} onFilterChange={setActivityFilter} />
      </Box>

      {/* --- P&L CHART SECTION --- */}
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Typography variant="h6" sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
            P&L - Income vs Expenses (Last 6 Months)
          </Typography>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="client-filter-label">Filter by Client</InputLabel>
            <Select
              labelId="client-filter-label"
              value={clientFilter}
              label="Filter by Client"
              onChange={(e: SelectChangeEvent) => setClientFilter(e.target.value)}
            >
              <MenuItem value="all">All Clients</MenuItem>
              {availableClients.map((client) => (
                <MenuItem key={client} value={client}>{client}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        {pnlLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={monthlyPnL} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip
                formatter={(value: number) => `$${value.toLocaleString()}`}
              />
              <Legend />
              <Bar dataKey="income" name="Income" fill="#4caf50" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#f44336" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        {!pnlLoading && monthlyPnL.length > 0 && (
          <Box sx={{ display: 'flex', gap: 3, mt: 2, flexWrap: 'wrap' }}>
            {(() => {
              const totalIncome = monthlyPnL.reduce((s, m) => s + m.income, 0);
              const totalExpenses = monthlyPnL.reduce((s, m) => s + m.expenses, 0);
              const totalProfit = totalIncome - totalExpenses;
              return (
                <>
                  <Chip label={`Total Income: $${totalIncome.toLocaleString()}`} color="success" variant="outlined" />
                  <Chip label={`Total Expenses: $${totalExpenses.toLocaleString()}`} color="error" variant="outlined" />
                  <Chip
                    label={`Net Profit: $${totalProfit.toLocaleString()}`}
                    color={totalProfit >= 0 ? 'success' : 'error'}
                  />
                </>
              );
            })()}
          </Box>
        )}
      </Paper>

      {/* --- ACTIVE EMPLOYEES REAL-TIME --- */}
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <FiberManualRecordIcon sx={{ color: '#4caf50', fontSize: 14, animation: 'pulse 2s infinite' }} />
          <Typography variant="h6" sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
            Active Employees ({activeEmployees.length})
          </Typography>
        </Box>
        {activeEmployees.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No employees currently working
          </Typography>
        ) : (
          <Grid container spacing={2}>
            {activeEmployees.map((emp) => (
              <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={emp.id}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: 'action.hover',
                }}>
                  <Avatar sx={{ width: 36, height: 36, bgcolor: '#4caf50', fontSize: '0.875rem' }}>
                    {emp.employeeName.charAt(0).toUpperCase()}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {emp.employeeName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatElapsed(emp.startedAt)} {emp.projectName ? `| ${emp.projectName}` : ''}
                    </Typography>
                  </Box>
                  <AccessTimeIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                </Box>
              </Grid>
            ))}
          </Grid>
        )}
      </Paper>

      {/* --- CRITICAL / URGENT TASKS --- */}
      {tasksData.urgentTasks && tasksData.urgentTasks.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 4, border: '1px solid', borderColor: 'warning.main' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <WarningIcon sx={{ color: 'warning.main' }} />
            <Typography variant="h6" sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' }, color: 'warning.main' }}>
              Critical / Overdue Tasks ({tasksData.urgentTasks.length})
            </Typography>
          </Box>
          <List disablePadding>
            {tasksData.urgentTasks.map((task: UrgentTask, index: number) => (
              <ListItem
                key={task.id || index}
                divider={index < tasksData.urgentTasks.length - 1}
                sx={{ px: 0 }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {task.title}
                      </Typography>
                      {task.priority && task.priority !== 'none' && (
                        <Chip
                          label={task.priority}
                          size="small"
                          color={task.priority === 'high' ? 'error' : 'warning'}
                          variant="outlined"
                        />
                      )}
                    </Box>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary">
                      {task.assignee ? `Assigned to: ${task.assignee}` : 'Unassigned'}
                      {task.deadline ? ` | Due: ${task.deadline.toLocaleDateString()}` : ''}
                    </Typography>
                  }
                />
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  onClick={() => navigate(`/crm/tasks${task.id ? `?taskId=${task.id}` : ''}`)}
                >
                  View
                </Button>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

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
              <Box sx={{ mt: 2, height: 400 }}>
                <ActivityFeedWidget data={activityData} filterType={activityFilter} onFilterChange={setActivityFilter} />
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
