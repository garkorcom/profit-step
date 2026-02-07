/**
 * @fileoverview Страница управления пользователем
 * Route: /admin/team/:userId
 *
 * Фичи:
 * - Профиль пользователя
 * - Сброс пароля (генерация, копирование, Telegram, ручная установка)
 * - Смена email / Force Logout
 * - Дашборд активностей (6 табов: обзор, задачи, сессии, сделки, закупки, заметки)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    Container,
    Box,
    Typography,
    Paper,
    Avatar,
    Chip,
    Button,
    TextField,
    IconButton,
    InputAdornment,
    Tabs,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    CircularProgress,
    Alert,
    Divider,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Tooltip,
    LinearProgress,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
    ArrowBack as BackIcon,
    Visibility,
    VisibilityOff,
    ContentCopy as CopyIcon,
    Casino as GenerateIcon,
    Telegram as TelegramIcon,
    Lock as LockIcon,
    Logout as LogoutIcon,
    Email as EmailIcon,
    Dashboard as OverviewIcon,
    Assignment as TaskIcon,
    Timer as SessionIcon,
    TrendingUp as DealIcon,
    ShoppingCart as ShoppingIcon,
    StickyNote2 as NoteIcon,
    CheckCircle as DoneIcon,
    PlayArrow as ActiveIcon,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { UserProfile, DEPARTMENT_LABELS } from '../../types/user.types';
import StatusIndicator from '../../components/common/StatusIndicator';
import StatCard from '../../components/common/StatCard';
import toast from 'react-hot-toast';
import { formatDistanceToNow, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
    adminResetPassword,
    adminForceLogout,
    adminChangeEmail,
    adminSendPasswordViaTelegram,
    getUserWorkSessions,
    getUserTasks,
    getUserDeals,
    getUserShoppingActivity,
    getUserNotes,
    getUserMonthlyStats,
    WorkSessionItem,
    TaskItem,
    DealItem,
    ShoppingItem,
    NoteItem,
    MonthlyStats,
} from '../../api/userDetailApi';

// ============================================
// ACTIVITY HEATMAP COMPONENT
// ============================================
const ActivityHeatmap: React.FC<{ data: Record<string, number> }> = ({ data }) => {
    const now = new Date();
    const days: { date: string; hours: number }[] = [];

    // Last 30 days
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        days.push({ date: key, hours: data[key] || 0 });
    }

    const maxHours = Math.max(...days.map((d) => d.hours), 1);

    return (
        <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                АКТИВНОСТЬ ЗА 30 ДНЕЙ
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {days.map((day) => {
                    const intensity = day.hours / maxHours;
                    const bg =
                        day.hours === 0
                            ? 'grey.100'
                            : intensity < 0.25
                                ? '#c6e48b'
                                : intensity < 0.5
                                    ? '#7bc96f'
                                    : intensity < 0.75
                                        ? '#239a3b'
                                        : '#196127';

                    return (
                        <Tooltip
                            key={day.date}
                            title={`${format(new Date(day.date), 'd MMM', { locale: ru })}: ${day.hours.toFixed(1)}ч`}
                        >
                            <Box
                                sx={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: 0.5,
                                    bgcolor: bg,
                                    cursor: 'pointer',
                                    transition: 'transform 0.1s',
                                    '&:hover': { transform: 'scale(1.3)' },
                                }}
                            />
                        </Tooltip>
                    );
                })}
            </Box>
        </Box>
    );
};

// ============================================
// TAB PANEL COMPONENT
// ============================================
interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => (
    <div role="tabpanel" hidden={value !== index}>
        {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
);

// ============================================
// STATUS CHIP HELPER
// ============================================
const getStatusColor = (status: string): 'success' | 'warning' | 'error' | 'info' | 'default' => {
    switch (status) {
        case 'done':
        case 'completed':
        case 'active':
            return 'success';
        case 'in_progress':
        case 'next':
        case 'started':
            return 'info';
        case 'waiting':
        case 'someday':
        case 'pending':
            return 'warning';
        case 'cancelled':
        case 'blocked':
            return 'error';
        default:
            return 'default';
    }
};

// ============================================
// MAIN COMPONENT
// ============================================
const UserDetailPage: React.FC = () => {
    const { userId } = useParams<{ userId: string }>();
    const navigate = useNavigate();
    const { userProfile: adminProfile } = useAuth();

    // User profile
    const [user, setUser] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    // Password management
    const [newPassword, setNewPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [telegramLoading, setTelegramLoading] = useState(false);

    // Email change
    const [newEmail, setNewEmail] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);

    // Force logout dialog
    const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
    const [logoutLoading, setLogoutLoading] = useState(false);

    // Activity dashboard
    const [activeTab, setActiveTab] = useState(0);
    const [sessions, setSessions] = useState<WorkSessionItem[]>([]);
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [deals, setDeals] = useState<DealItem[]>([]);
    const [shopping, setShopping] = useState<ShoppingItem[]>([]);
    const [notes, setNotes] = useState<NoteItem[]>([]);
    const [monthlyStats, setMonthlyStats] = useState<MonthlyStats | null>(null);
    const [dataLoading, setDataLoading] = useState(true);

    // ============================================
    // LOAD USER PROFILE
    // ============================================
    useEffect(() => {
        const loadUser = async () => {
            if (!userId) return;

            try {
                const userDoc = await getDoc(doc(db, 'users', userId));
                if (userDoc.exists()) {
                    setUser({ id: userDoc.id, ...userDoc.data() } as UserProfile);
                } else {
                    toast.error('Пользователь не найден');
                    navigate('/admin/team');
                }
            } catch (err) {
                console.error('Error loading user:', err);
                toast.error('Ошибка загрузки профиля');
            } finally {
                setLoading(false);
            }
        };

        loadUser();
    }, [userId, navigate]);

    // ============================================
    // LOAD ACTIVITY DATA
    // ============================================
    const loadActivityData = useCallback(async () => {
        if (!userId) return;

        setDataLoading(true);
        try {
            const [sessionsData, tasksData, dealsData, shoppingData, notesData, statsData] =
                await Promise.all([
                    getUserWorkSessions(userId),
                    getUserTasks(userId),
                    getUserDeals(userId),
                    getUserShoppingActivity(userId),
                    getUserNotes(userId),
                    getUserMonthlyStats(userId),
                ]);

            setSessions(sessionsData);
            setTasks(tasksData);
            setDeals(dealsData);
            setShopping(shoppingData);
            setNotes(notesData);
            setMonthlyStats(statsData);
        } catch (err) {
            console.error('Error loading activity data:', err);
        } finally {
            setDataLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (user) loadActivityData();
    }, [user, loadActivityData]);

    // ============================================
    // PASSWORD HANDLERS
    // ============================================
    const generatePassword = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
        let pw = '';
        for (let i = 0; i < 12; i++) {
            pw += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        setNewPassword(pw);
        setShowPassword(true);
    };

    const copyPassword = async () => {
        if (!newPassword) return;
        await navigator.clipboard.writeText(newPassword);
        toast.success('Пароль скопирован');
    };

    const handleResetPassword = async () => {
        if (!userId || newPassword.length < 6) {
            toast.error('Пароль должен быть минимум 6 символов');
            return;
        }

        setPasswordLoading(true);
        try {
            const result = await adminResetPassword(userId, newPassword);
            toast.success(result.message);
        } catch (err: any) {
            toast.error(err.message || 'Ошибка сброса пароля');
        } finally {
            setPasswordLoading(false);
        }
    };

    const handleSendViaTelegram = async () => {
        if (!userId || !newPassword) {
            toast.error('Сначала задайте пароль');
            return;
        }

        setTelegramLoading(true);
        try {
            const result = await adminSendPasswordViaTelegram(userId, newPassword);
            toast.success(result.message);
        } catch (err: any) {
            toast.error(err.message || 'Ошибка отправки в Telegram');
        } finally {
            setTelegramLoading(false);
        }
    };

    // ============================================
    // EMAIL HANDLER
    // ============================================
    const handleChangeEmail = async () => {
        if (!userId || !newEmail) return;

        setEmailLoading(true);
        try {
            const result = await adminChangeEmail(userId, newEmail);
            toast.success(result.message);
            // Update local state
            setUser((prev) => (prev ? { ...prev, email: newEmail.toLowerCase() } : prev));
            setNewEmail('');
        } catch (err: any) {
            toast.error(err.message || 'Ошибка смены email');
        } finally {
            setEmailLoading(false);
        }
    };

    // ============================================
    // FORCE LOGOUT HANDLER
    // ============================================
    const handleForceLogout = async () => {
        if (!userId) return;

        setLogoutLoading(true);
        try {
            const result = await adminForceLogout(userId);
            toast.success(result.message);
            setLogoutDialogOpen(false);
        } catch (err: any) {
            toast.error(err.message || 'Ошибка завершения сессий');
        } finally {
            setLogoutLoading(false);
        }
    };

    // ============================================
    // UTILITY
    // ============================================
    const getLastSeenDate = (): Date | null => {
        if (!user?.lastSeen) return null;
        if (user.lastSeen instanceof Timestamp) return user.lastSeen.toDate();
        return new Date(user.lastSeen);
    };

    // ============================================
    // RENDER: Loading
    // ============================================
    if (loading) {
        return (
            <Container maxWidth="lg" sx={{ mt: 4 }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    if (!user) {
        return (
            <Container maxWidth="lg" sx={{ mt: 4 }}>
                <Alert severity="error">Пользователь не найден</Alert>
            </Container>
        );
    }

    if (adminProfile?.role !== 'admin') {
        return (
            <Container maxWidth="lg" sx={{ mt: 4 }}>
                <Alert severity="error">Доступ запрещён. Только для администраторов.</Alert>
            </Container>
        );
    }

    const lastSeen = getLastSeenDate();
    const isOnline = lastSeen ? new Date().getTime() - lastSeen.getTime() < 5 * 60 * 1000 : false;

    // ============================================
    // RENDER: Main
    // ============================================
    return (
        <Container maxWidth="lg" sx={{ mt: 3, mb: 4 }}>
            {/* Back Button */}
            <Button
                startIcon={<BackIcon />}
                onClick={() => navigate('/admin/team')}
                sx={{ mb: 2 }}
            >
                Команда
            </Button>

            {/* ============================================ */}
            {/* USER PROFILE HEADER */}
            {/* ============================================ */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Avatar
                        src={user.photoURL}
                        sx={{
                            width: 80,
                            height: 80,
                            fontSize: 32,
                            bgcolor: 'primary.main',
                        }}
                    >
                        {user.displayName?.charAt(0).toUpperCase()}
                    </Avatar>

                    <Box sx={{ flex: 1, minWidth: 200 }}>
                        <Typography variant="h5" fontWeight={700}>
                            {user.displayName}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {user.email} {user.title && `• ${user.title}`}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                            <StatusIndicator status={user.status as any} isOnline={isOnline} size="small" />
                            <Chip label={user.role} size="small" color="primary" variant="outlined" />
                            {user.department && (
                                <Chip
                                    label={DEPARTMENT_LABELS[user.department]}
                                    size="small"
                                    variant="outlined"
                                />
                            )}
                            {user.telegramId && (
                                <Chip
                                    icon={<TelegramIcon />}
                                    label={`TG: ${user.telegramId}`}
                                    size="small"
                                    color="info"
                                    variant="outlined"
                                />
                            )}
                            {lastSeen && (
                                <Typography variant="caption" color="text.secondary">
                                    Последний визит:{' '}
                                    {formatDistanceToNow(lastSeen, { addSuffix: true, locale: ru })}
                                </Typography>
                            )}
                        </Box>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Chip
                            label={`Входов: ${user.loginCount || 0}`}
                            size="small"
                            variant="outlined"
                        />
                        <Chip
                            label={`Ставка: $${user.hourlyRate || user.defaultRate || 0}/ч`}
                            size="small"
                            color="success"
                            variant="outlined"
                        />
                    </Box>
                </Box>
            </Paper>

            {/* ============================================ */}
            {/* PASSWORD & SECURITY */}
            {/* ============================================ */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
                {/* Password Reset Card */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Paper sx={{ p: 3, height: '100%' }}>
                        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <LockIcon color="primary" /> Управление паролем
                        </Typography>

                        <TextField
                            fullWidth
                            label="Новый пароль"
                            type={showPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            size="small"
                            sx={{ mb: 1 }}
                            slotProps={{
                                input: {
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" size="small">
                                                {showPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </InputAdornment>
                                    ),
                                },
                            }}
                            helperText={
                                newPassword.length > 0 && newPassword.length < 6
                                    ? '⚠️ Минимум 6 символов'
                                    : newPassword.length >= 6
                                        ? '✅ Пароль достаточной длины'
                                        : ''
                            }
                        />

                        {newPassword.length > 0 && (
                            <LinearProgress
                                variant="determinate"
                                value={Math.min(100, (newPassword.length / 12) * 100)}
                                color={newPassword.length < 6 ? 'error' : newPassword.length < 10 ? 'warning' : 'success'}
                                sx={{ mb: 2, borderRadius: 1 }}
                            />
                        )}

                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<GenerateIcon />}
                                onClick={generatePassword}
                            >
                                Генерировать
                            </Button>
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<CopyIcon />}
                                onClick={copyPassword}
                                disabled={!newPassword}
                            >
                                Копировать
                            </Button>
                            <Tooltip title={user.telegramId ? 'Отправить в Telegram' : 'Telegram не привязан'}>
                                <span>
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        startIcon={<TelegramIcon />}
                                        onClick={handleSendViaTelegram}
                                        disabled={!user.telegramId || !newPassword || telegramLoading}
                                        color="info"
                                    >
                                        {telegramLoading ? <CircularProgress size={16} /> : 'Telegram'}
                                    </Button>
                                </span>
                            </Tooltip>
                            <Button
                                variant="contained"
                                size="small"
                                startIcon={passwordLoading ? <CircularProgress size={16} /> : <LockIcon />}
                                onClick={handleResetPassword}
                                disabled={!newPassword || newPassword.length < 6 || passwordLoading}
                            >
                                Задать пароль
                            </Button>
                        </Box>
                    </Paper>
                </Grid>

                {/* Security Card */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Paper sx={{ p: 3, height: '100%' }}>
                        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <EmailIcon color="primary" /> Безопасность
                        </Typography>

                        {/* Change Email */}
                        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                            <TextField
                                fullWidth
                                label="Новый email"
                                type="email"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                size="small"
                                placeholder={user.email}
                            />
                            <Button
                                variant="outlined"
                                onClick={handleChangeEmail}
                                disabled={!newEmail || emailLoading}
                                sx={{ minWidth: 120 }}
                            >
                                {emailLoading ? <CircularProgress size={16} /> : 'Сменить'}
                            </Button>
                        </Box>

                        <Divider sx={{ my: 2 }} />

                        {/* Force Logout */}
                        <Button
                            variant="outlined"
                            color="error"
                            startIcon={<LogoutIcon />}
                            onClick={() => setLogoutDialogOpen(true)}
                            fullWidth
                        >
                            Завершить все сессии (Force Logout)
                        </Button>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            Отзывает все refresh tokens. Пользователю придётся войти заново.
                        </Typography>
                    </Paper>
                </Grid>
            </Grid>

            {/* ============================================ */}
            {/* ACTIVITY DASHBOARD */}
            {/* ============================================ */}
            <Paper sx={{ p: 0 }}>
                <Tabs
                    value={activeTab}
                    onChange={(_, v) => setActiveTab(v)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{
                        borderBottom: 1,
                        borderColor: 'divider',
                        px: 2,
                    }}
                >
                    <Tab icon={<OverviewIcon />} iconPosition="start" label="Обзор" />
                    <Tab icon={<TaskIcon />} iconPosition="start" label={`Задачи (${tasks.length})`} />
                    <Tab icon={<SessionIcon />} iconPosition="start" label={`Сессии (${sessions.length})`} />
                    <Tab icon={<DealIcon />} iconPosition="start" label={`Сделки (${deals.length})`} />
                    <Tab icon={<ShoppingIcon />} iconPosition="start" label={`Закупки (${shopping.length})`} />
                    <Tab icon={<NoteIcon />} iconPosition="start" label={`Заметки (${notes.length})`} />
                </Tabs>

                <Box sx={{ p: 3 }}>
                    {dataLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        <>
                            {/* ===== TAB 0: OVERVIEW ===== */}
                            <TabPanel value={activeTab} index={0}>
                                <Grid container spacing={2} sx={{ mb: 3 }}>
                                    <Grid size={{ xs: 6, md: 3 }}>
                                        <StatCard
                                            value={monthlyStats?.totalHours || 0}
                                            label="Часов за месяц"
                                            icon={<SessionIcon />}
                                        />
                                    </Grid>
                                    <Grid size={{ xs: 6, md: 3 }}>
                                        <StatCard
                                            value={`$${monthlyStats?.totalEarnings?.toFixed(0) || 0}`}
                                            label="Заработок за месяц"
                                            icon={<DealIcon />}
                                        />
                                    </Grid>
                                    <Grid size={{ xs: 6, md: 3 }}>
                                        <StatCard
                                            value={monthlyStats?.sessionsCount || 0}
                                            label="Сессий за месяц"
                                            icon={<ActiveIcon />}
                                        />
                                    </Grid>
                                    <Grid size={{ xs: 6, md: 3 }}>
                                        <StatCard
                                            value={monthlyStats?.tasksCompleted || 0}
                                            label="Задач завершено"
                                            icon={<DoneIcon />}
                                        />
                                    </Grid>
                                </Grid>

                                {monthlyStats && <ActivityHeatmap data={monthlyStats.activityByDay} />}
                            </TabPanel>

                            {/* ===== TAB 1: TASKS ===== */}
                            <TabPanel value={activeTab} index={1}>
                                {tasks.length === 0 ? (
                                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                                        Нет задач
                                    </Typography>
                                ) : (
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>Задача</TableCell>
                                                    <TableCell>Статус</TableCell>
                                                    <TableCell>Приоритет</TableCell>
                                                    <TableCell>Дедлайн</TableCell>
                                                    <TableCell>Создана</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {tasks.map((task) => (
                                                    <TableRow
                                                        key={task.id}
                                                        hover
                                                        onClick={() => navigate(`/crm/gtd/${task.id}`)}
                                                        sx={{ cursor: 'pointer' }}
                                                    >
                                                        <TableCell>
                                                            <Typography variant="body2" fontWeight={500}>
                                                                {task.title}
                                                            </Typography>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Chip
                                                                label={task.status}
                                                                size="small"
                                                                color={getStatusColor(task.status)}
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            <Chip
                                                                label={task.priority}
                                                                size="small"
                                                                variant="outlined"
                                                                color={
                                                                    task.priority === 'high' || task.priority === 'urgent'
                                                                        ? 'error'
                                                                        : 'default'
                                                                }
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            {task.dueDate
                                                                ? format(task.dueDate, 'd MMM', { locale: ru })
                                                                : '—'}
                                                        </TableCell>
                                                        <TableCell>
                                                            {format(task.createdAt, 'd MMM', { locale: ru })}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                )}
                            </TabPanel>

                            {/* ===== TAB 2: SESSIONS ===== */}
                            <TabPanel value={activeTab} index={2}>
                                {sessions.length === 0 ? (
                                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                                        Нет рабочих сессий
                                    </Typography>
                                ) : (
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>Дата</TableCell>
                                                    <TableCell>Проект</TableCell>
                                                    <TableCell>Длительность</TableCell>
                                                    <TableCell>Ставка</TableCell>
                                                    <TableCell>Сумма</TableCell>
                                                    <TableCell>Статус</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {sessions.map((s) => (
                                                    <TableRow key={s.id}>
                                                        <TableCell>
                                                            {format(s.startTime, 'd MMM HH:mm', { locale: ru })}
                                                        </TableCell>
                                                        <TableCell>{s.projectName}</TableCell>
                                                        <TableCell>
                                                            {s.duration > 0
                                                                ? `${Math.floor(s.duration / 60)}ч ${s.duration % 60}м`
                                                                : '—'}
                                                        </TableCell>
                                                        <TableCell>${s.hourlyRate}/ч</TableCell>
                                                        <TableCell>
                                                            ${((s.duration / 60) * s.hourlyRate).toFixed(2)}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Chip
                                                                label={s.status}
                                                                size="small"
                                                                color={getStatusColor(s.status)}
                                                            />
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                )}
                            </TabPanel>

                            {/* ===== TAB 3: DEALS ===== */}
                            <TabPanel value={activeTab} index={3}>
                                {deals.length === 0 ? (
                                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                                        Нет сделок
                                    </Typography>
                                ) : (
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>Сделка</TableCell>
                                                    <TableCell>Клиент</TableCell>
                                                    <TableCell>Сумма</TableCell>
                                                    <TableCell>Статус</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {deals.map((deal) => (
                                                    <TableRow key={deal.id}>
                                                        <TableCell>{deal.title}</TableCell>
                                                        <TableCell>{deal.clientName || '—'}</TableCell>
                                                        <TableCell>${deal.value.toLocaleString()}</TableCell>
                                                        <TableCell>
                                                            <Chip label={deal.status} size="small" color={getStatusColor(deal.status)} />
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                )}
                            </TabPanel>

                            {/* ===== TAB 4: SHOPPING ===== */}
                            <TabPanel value={activeTab} index={4}>
                                {shopping.length === 0 ? (
                                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                                        Нет закупок
                                    </Typography>
                                ) : (
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>Список</TableCell>
                                                    <TableCell>Позиций</TableCell>
                                                    <TableCell>Создан</TableCell>
                                                    <TableCell>Статус</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {shopping.map((item) => (
                                                    <TableRow key={item.id}>
                                                        <TableCell>{item.title}</TableCell>
                                                        <TableCell>{item.itemCount}</TableCell>
                                                        <TableCell>
                                                            {format(item.createdAt, 'd MMM yyyy', { locale: ru })}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Chip label={item.status} size="small" color={getStatusColor(item.status)} />
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                )}
                            </TabPanel>

                            {/* ===== TAB 5: NOTES ===== */}
                            <TabPanel value={activeTab} index={5}>
                                {notes.length === 0 ? (
                                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                                        Нет заметок
                                    </Typography>
                                ) : (
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>Заметка</TableCell>
                                                    <TableCell>Тип</TableCell>
                                                    <TableCell>Создана</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {notes.map((note) => (
                                                    <TableRow key={note.id}>
                                                        <TableCell>
                                                            <Typography variant="body2" fontWeight={500}>
                                                                {note.title}
                                                            </Typography>
                                                            {note.content && (
                                                                <Typography
                                                                    variant="caption"
                                                                    color="text.secondary"
                                                                    sx={{
                                                                        display: 'block',
                                                                        maxWidth: 400,
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        whiteSpace: 'nowrap',
                                                                    }}
                                                                >
                                                                    {note.content}
                                                                </Typography>
                                                            )}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Chip label={note.type} size="small" variant="outlined" />
                                                        </TableCell>
                                                        <TableCell>
                                                            {format(note.createdAt, 'd MMM HH:mm', { locale: ru })}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                )}
                            </TabPanel>
                        </>
                    )}
                </Box>
            </Paper>

            {/* ============================================ */}
            {/* FORCE LOGOUT DIALOG */}
            {/* ============================================ */}
            <Dialog open={logoutDialogOpen} onClose={() => setLogoutDialogOpen(false)}>
                <DialogTitle>Завершить все сессии?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Все refresh tokens пользователя <strong>{user.displayName}</strong> будут отозваны.
                        Пользователь будет разлогинен на всех устройствах и ему придётся войти заново.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setLogoutDialogOpen(false)}>Отмена</Button>
                    <Button
                        onClick={handleForceLogout}
                        color="error"
                        variant="contained"
                        disabled={logoutLoading}
                    >
                        {logoutLoading ? <CircularProgress size={16} /> : 'Завершить сессии'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default UserDetailPage;
