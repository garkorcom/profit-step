/**
 * Worker self-service time + payroll dashboard.
 *
 * What the worker sees:
 *  - Active session state — live timer + Stop button, or task picker to
 *    start a new shift (mirrors what Telegram bot does, uses the same
 *    `useSessionManager` hook).
 *  - YTD balance strip — earned / paid / adjustments / balance / hours,
 *    computed with the canonical `calculatePayrollBuckets` that the
 *    bot and the admin FinancePage both use. Numbers match.
 *  - Payment history — every payment recorded against this worker.
 *  - Work history — every completed session in the period.
 *
 * The entire page is read-mostly; the only write path is
 * `startSession` / `stopSession` via `useSessionManager`. This keeps
 * the page safe for any authenticated user (no admin-only actions).
 */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert,
    Avatar,
    Box,
    Button,
    Chip,
    CircularProgress,
    Container,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import HistoryIcon from '@mui/icons-material/History';
import PaymentIcon from '@mui/icons-material/Payment';
import PersonIcon from '@mui/icons-material/Person';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { format } from 'date-fns';

import { useAuth } from '../../../auth/AuthContext';
import { useActiveSession } from '../../../hooks/useActiveSession';
import { useSessionManager } from '../../../hooks/useSessionManager';
import { useGTDTasks } from '../../../hooks/useGTDTasks';
import { GTDTask } from '../../../types/gtd.types';
import { defaultFinanceStartDate } from '../../finance';
import { useWorkerLedger } from '../hooks/useWorkerLedger';

function fmtUsd(n: number | null | undefined, short = false): string {
    if (n === null || n === undefined) return '—';
    if (short && Math.abs(n) >= 1000) {
        return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    }
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function fmtDuration(minutes: number | undefined): string {
    if (!minutes) return '—';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) return `${m}мин`;
    return `${h}ч ${m}мин`;
}

const MyTimePage: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser, userProfile } = useAuth();
    const uid = currentUser?.uid;
    const telegramId = userProfile?.telegramId;

    const { activeSession, loading: activeLoading } = useActiveSession(uid);
    const sessionManager = useSessionManager(
        uid,
        userProfile?.displayName || currentUser?.displayName || undefined,
        telegramId ? String(telegramId) : undefined,
        userProfile?.companyId
    );

    // Worker's own ledger — YTD by default, same as Finance page.
    const [startDate] = useState(defaultFinanceStartDate());
    const [endDate] = useState(new Date());
    const ledger = useWorkerLedger({
        userId: uid,
        telegramId,
        startDate,
        endDate,
        companyId: userProfile?.companyId,
    });

    // Available GTD tasks for the start-shift picker. Memoise the user
    // object — passing a fresh `{uid, displayName}` literal every render
    // triggered "Maximum update depth exceeded" inside useGTDTasks.
    const taskUser = useMemo(
        () =>
            currentUser
                ? { uid: currentUser.uid, displayName: currentUser.displayName || null }
                : null,
        [currentUser]
    );
    const { rawTasks: allTasks, loading: tasksLoading } = useGTDTasks(taskUser, false);
    const myOpenTasks = useMemo<GTDTask[]>(
        () =>
            (allTasks || [])
                .filter((t: GTDTask) => t.status !== 'done')
                .slice(0, 20),
        [allTasks]
    );

    const [pickerOpen, setPickerOpen] = useState(false);
    const [starting, setStarting] = useState(false);
    const [stopping, setStopping] = useState(false);

    const onStart = async (task: GTDTask) => {
        setStarting(true);
        try {
            await sessionManager.startSession(task);
            setPickerOpen(false);
            await ledger.refresh();
        } catch (e) {
            console.error('Start failed:', e);
        } finally {
            setStarting(false);
        }
    };

    const onStop = async () => {
        setStopping(true);
        try {
            await sessionManager.stopSession();
            await ledger.refresh();
        } catch (e) {
            console.error('Stop failed:', e);
        } finally {
            setStopping(false);
        }
    };

    // Split reportable entries for two tables (completed work vs money paid).
    const { payments, completedSessions } = useMemo(() => {
        const ps: typeof ledger.entries = [];
        const cs: typeof ledger.entries = [];
        for (const e of ledger.entries) {
            if (e.type === 'payment') ps.push(e);
            else cs.push(e);
        }
        return { payments: ps, completedSessions: cs };
    }, [ledger.entries]);

    if (!currentUser) {
        return (
            <Container sx={{ mt: 4 }}>
                <Alert severity="warning">Войди в систему, чтобы увидеть своё время и выплаты.</Alert>
            </Container>
        );
    }

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            <Stack direction="row" spacing={2} alignItems="center" mb={3}>
                <Avatar sx={{ bgcolor: 'primary.main' }}>
                    <PersonIcon />
                </Avatar>
                <Box>
                    <Typography variant="h5" fontWeight={700}>
                        Моё время
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {userProfile?.displayName || currentUser.displayName || currentUser.email}
                        {' · '}
                        {format(startDate, 'dd.MM.yyyy')} — {format(endDate, 'dd.MM.yyyy')}
                    </Typography>
                </Box>
            </Stack>

            {/* ─── ACTIVE SESSION ──────────────────────────────────────── */}
            <ActiveSessionCard
                loading={activeLoading}
                session={activeSession}
                onStart={() => setPickerOpen(true)}
                onStop={onStop}
                stopping={stopping}
            />

            {/* ─── BALANCE STRIP ───────────────────────────────────────── */}
            <BalanceStrip buckets={ledger.buckets} loading={ledger.loading} />

            {/* ─── PAYMENTS ────────────────────────────────────────────── */}
            <Paper variant="outlined" sx={{ mt: 3, p: 2, borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
                    <PaymentIcon color="primary" fontSize="small" />
                    <Typography variant="subtitle1" fontWeight={700}>
                        История выплат
                    </Typography>
                    <Chip label={payments.length} size="small" />
                </Stack>
                {ledger.loading ? (
                    <CircularProgress size={20} />
                ) : payments.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                        Выплат за период нет.
                    </Typography>
                ) : (
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Дата</TableCell>
                                <TableCell>Примечание</TableCell>
                                <TableCell align="right">Сумма</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {payments.map(p => (
                                <TableRow key={p.id}>
                                    <TableCell>{fmtDate(p.startTime)}</TableCell>
                                    <TableCell>{p.description || '—'}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                                        {fmtUsd(Math.abs(p.sessionEarnings || 0))}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </Paper>

            {/* ─── SESSION HISTORY ─────────────────────────────────────── */}
            <Paper variant="outlined" sx={{ mt: 3, p: 2, borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
                    <HistoryIcon color="primary" fontSize="small" />
                    <Typography variant="subtitle1" fontWeight={700}>
                        История смен
                    </Typography>
                    <Chip label={completedSessions.length} size="small" />
                </Stack>
                {ledger.loading ? (
                    <CircularProgress size={20} />
                ) : completedSessions.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                        За период завершённых смен нет.
                    </Typography>
                ) : (
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Дата</TableCell>
                                <TableCell>Клиент / задача</TableCell>
                                <TableCell align="right">Длительность</TableCell>
                                <TableCell align="right">Ставка</TableCell>
                                <TableCell align="right">Заработок</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {completedSessions.map(s => (
                                <TableRow key={s.id}>
                                    <TableCell>{fmtDate(s.startTime)}</TableCell>
                                    <TableCell>
                                        <Stack spacing={0}>
                                            <Typography variant="body2">
                                                {s.clientName || '—'}
                                            </Typography>
                                            {s.description && (
                                                <Typography variant="caption" color="text.secondary" noWrap>
                                                    {s.description}
                                                </Typography>
                                            )}
                                        </Stack>
                                    </TableCell>
                                    <TableCell align="right">{fmtDuration(s.durationMinutes)}</TableCell>
                                    <TableCell align="right">
                                        {s.hourlyRate ? `$${s.hourlyRate}/ч` : '—'}
                                    </TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                                        {fmtUsd(s.sessionEarnings)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </Paper>

            {/* ─── START SHIFT PICKER ──────────────────────────────────── */}
            <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Начать смену — выбери задачу</DialogTitle>
                <DialogContent>
                    {tasksLoading ? (
                        <CircularProgress size={24} />
                    ) : myOpenTasks.length === 0 ? (
                        <Box py={2}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                У тебя нет открытых задач. Создай задачу в разделе «Tasks».
                            </Typography>
                            <Button size="small" onClick={() => navigate('/crm/gtd/new')} sx={{ mt: 1 }}>
                                Создать задачу
                            </Button>
                        </Box>
                    ) : (
                        <Stack spacing={1} pt={1}>
                            {myOpenTasks.map((task: GTDTask) => (
                                <Paper
                                    key={task.id}
                                    variant="outlined"
                                    sx={{
                                        p: 1.25,
                                        borderRadius: 1.5,
                                        cursor: starting ? 'wait' : 'pointer',
                                        '&:hover': { borderColor: 'primary.main' },
                                    }}
                                    onClick={() => !starting && onStart(task)}
                                >
                                    <Stack direction="row" alignItems="center" spacing={1.5}>
                                        <TaskAltIcon
                                            fontSize="small"
                                            color={task.priority === 'high' ? 'error' : 'action'}
                                        />
                                        <Box flex={1} minWidth={0}>
                                            <Typography variant="body2" fontWeight={600} noWrap>
                                                {task.title}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" noWrap>
                                                {task.clientName || 'без клиента'}
                                                {task.hourlyRate ? ` · $${task.hourlyRate}/ч` : ''}
                                            </Typography>
                                        </Box>
                                        <IconButton size="small" disabled={starting}>
                                            <PlayArrowIcon fontSize="small" />
                                        </IconButton>
                                    </Stack>
                                </Paper>
                            ))}
                        </Stack>
                    )}
                </DialogContent>
            </Dialog>
        </Container>
    );
};

// ─────────────────────────────────────────────────────────────────────
// ACTIVE SESSION CARD
// ─────────────────────────────────────────────────────────────────────

interface ActiveSessionCardProps {
    loading: boolean;
    session: ReturnType<typeof useActiveSession>['activeSession'];
    onStart: () => void;
    onStop: () => Promise<void>;
    stopping: boolean;
}

const ActiveSessionCard: React.FC<ActiveSessionCardProps> = ({
    loading,
    session,
    onStart,
    onStop,
    stopping,
}) => {
    if (loading) {
        return (
            <Paper variant="outlined" sx={{ p: 3, mb: 2, borderRadius: 2 }}>
                <CircularProgress size={20} />
            </Paper>
        );
    }

    if (!session) {
        return (
            <Paper
                variant="outlined"
                sx={{ p: 3, mb: 2, borderRadius: 2, textAlign: 'center' }}
            >
                <Typography variant="body2" color="text.secondary" mb={1.5}>
                    Сейчас ты не на смене.
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<PlayArrowIcon />}
                    onClick={onStart}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                    Начать смену
                </Button>
            </Paper>
        );
    }

    const rate = session.hourlyRate || 0;
    const elapsedMin = session.startTime
        ? Math.max(0, (Date.now() - session.startTime.toMillis()) / 60000)
        : 0;
    const earningsSoFar = (elapsedMin / 60) * rate;

    return (
        <Paper
            elevation={2}
            sx={{
                p: 3,
                mb: 2,
                borderRadius: 2,
                bgcolor: 'success.light',
                color: 'success.contrastText',
            }}
        >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                <AccessTimeIcon sx={{ fontSize: 40 }} />
                <Box flex={1}>
                    <Typography variant="overline" sx={{ opacity: 0.85 }}>
                        На смене
                    </Typography>
                    <Typography variant="h6" fontWeight={700}>
                        {session.description || session.clientName || 'Смена'}
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.9 }}>
                        {fmtDuration(Math.round(elapsedMin))}
                        {rate ? ` · $${rate}/ч · заработано ${fmtUsd(earningsSoFar)}` : ''}
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    color="error"
                    startIcon={<StopIcon />}
                    onClick={onStop}
                    disabled={stopping}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                    {stopping ? 'Останавливаю...' : 'Закончить смену'}
                </Button>
            </Stack>
        </Paper>
    );
};

// ─────────────────────────────────────────────────────────────────────
// BALANCE STRIP
// ─────────────────────────────────────────────────────────────────────

interface BalanceStripProps {
    buckets: ReturnType<typeof useWorkerLedger>['buckets'];
    loading: boolean;
}

const BalanceStrip: React.FC<BalanceStripProps> = ({ buckets, loading }) => {
    const balancePositive = buckets.balance > 0;
    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
                gap: 1.5,
            }}
        >
            <KPICard
                label="Начислено"
                value={fmtUsd(buckets.salary, true)}
                color="primary"
                loading={loading}
            />
            <KPICard
                label="Выплачено"
                value={fmtUsd(buckets.payments, true)}
                color="default"
                loading={loading}
            />
            <KPICard
                label="Баланс"
                value={fmtUsd(buckets.balance, true)}
                color={balancePositive ? 'warning' : 'success'}
                subtitle={balancePositive ? 'компания должна' : 'в расчёте'}
                loading={loading}
            />
            <KPICard
                label="Часов"
                value={buckets.totalHours.toFixed(1) + 'ч'}
                color="default"
                loading={loading}
            />
        </Box>
    );
};

const KPICard: React.FC<{
    label: string;
    value: string;
    color: 'primary' | 'success' | 'warning' | 'default';
    subtitle?: string;
    loading: boolean;
}> = ({ label, value, color, subtitle, loading }) => {
    const tint =
        color === 'primary'
            ? 'primary.main'
            : color === 'success'
                ? 'success.main'
                : color === 'warning'
                    ? 'warning.main'
                    : 'text.primary';
    return (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
            <Typography variant="h5" fontWeight={700} sx={{ color: tint, mt: 0.5 }}>
                {loading ? '…' : value}
            </Typography>
            {subtitle && (
                <Typography variant="caption" color="text.secondary">
                    {subtitle}
                </Typography>
            )}
        </Paper>
    );
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function fmtDate(ts: { toDate?: () => Date } | undefined): string {
    if (!ts?.toDate) return '—';
    try {
        return format(ts.toDate(), 'dd.MM.yy HH:mm');
    } catch {
        return '—';
    }
}

export default MyTimePage;
