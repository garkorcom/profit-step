/**
 * Admin drill-down for a single worker — same visual layout as the
 * self-service `/my-time` page but scoped to an arbitrary employee
 * selected from `/admin/workers`. Balance + tables use the same
 * canonical hooks (`useWorkerLedger`, `calculatePayrollBuckets`)
 * so the numbers match FinancePage and the worker's own view
 * byte-for-byte.
 *
 * What admin can do here (vs the worker's `/my-time`):
 *  - Pick ANY worker via URL param `userId`.
 *  - See that worker's active session + history + balance.
 *  - Add a payment on their behalf (delegates to the existing
 *    addDoc flow in FinancePage — this page just surfaces the
 *    action where an admin naturally looks for it).
 */

import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Alert,
    Avatar,
    Box,
    Button,
    Chip,
    CircularProgress,
    Container,
    Dialog,
    DialogActions,
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
    TextField,
    Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HistoryIcon from '@mui/icons-material/History';
import PaymentIcon from '@mui/icons-material/Payment';
import PersonIcon from '@mui/icons-material/Person';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

import { db } from '../../../firebase/firebase';
import { useAuth } from '../../../auth/AuthContext';
import {
    calculatePayrollBuckets,
    defaultFinanceStartDate,
    useEmployeesWithRates,
} from '../../finance';
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

function fmtDate(ts: { toDate?: () => Date } | undefined): string {
    if (!ts?.toDate) return '—';
    try {
        return format(ts.toDate(), 'dd.MM.yy HH:mm');
    } catch {
        return '—';
    }
}

const AdminWorkerDetailPage: React.FC = () => {
    const { userId = '' } = useParams<{ userId: string }>();
    const navigate = useNavigate();
    const { userProfile } = useAuth();
    // PR #95 companion: tightened work_sessions rules require companyId on
    // every write. Threaded into the payment dialog below.
    const companyId = userProfile?.companyId;
    const [startDate] = useState(defaultFinanceStartDate());
    const [endDate] = useState(new Date());

    const employeesDir = useEmployeesWithRates();
    const employee = useMemo(
        () => employeesDir.employees.find(e => e.id === userId),
        [employeesDir.employees, userId]
    );

    const ledger = useWorkerLedger({
        userId,
        telegramId: employee?.telegramId as string | number | undefined,
        startDate,
        endDate,
        companyId,
    });

    const { payments, completedSessions } = useMemo(() => {
        const ps: typeof ledger.entries = [];
        const cs: typeof ledger.entries = [];
        for (const e of ledger.entries) {
            if (e.type === 'payment') ps.push(e);
            else cs.push(e);
        }
        return { payments: ps, completedSessions: cs };
    }, [ledger.entries]);

    const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

    if (!userId) {
        return (
            <Container sx={{ mt: 4 }}>
                <Alert severity="error">Укажи ID работника в URL.</Alert>
            </Container>
        );
    }

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} mb={2}>
                <IconButton onClick={() => navigate('/admin/workers')}>
                    <ArrowBackIcon />
                </IconButton>
                <Avatar sx={{ bgcolor: 'primary.main' }}>
                    <PersonIcon />
                </Avatar>
                <Box flex={1}>
                    <Typography variant="h5" fontWeight={700}>
                        {employee?.name || 'Работник'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {employee?.hourlyRate
                            ? `Ставка $${employee.hourlyRate}/ч`
                            : 'Ставка не установлена'}
                        {' · '}
                        {format(startDate, 'dd.MM.yyyy')} — {format(endDate, 'dd.MM.yyyy')}
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    color="primary"
                    startIcon={<AddCircleIcon />}
                    onClick={() => setPaymentDialogOpen(true)}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                    Записать выплату
                </Button>
            </Stack>

            {employeesDir.error && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Не удалось загрузить профиль. Использую кэш.
                </Alert>
            )}
            {ledger.error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {ledger.error}
                </Alert>
            )}

            {/* Balance strip — identical palette to MyTimePage + FinancePage. */}
            <BalanceStrip buckets={ledger.buckets} loading={ledger.loading} />

            {/* Payments */}
            <Paper variant="outlined" sx={{ mt: 3, p: 2, borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
                    <PaymentIcon color="primary" fontSize="small" />
                    <Typography variant="subtitle1" fontWeight={700}>
                        Выплаты
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

            {/* Sessions */}
            <Paper variant="outlined" sx={{ mt: 3, p: 2, borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
                    <HistoryIcon color="primary" fontSize="small" />
                    <Typography variant="subtitle1" fontWeight={700}>
                        Смены
                    </Typography>
                    <Chip label={completedSessions.length} size="small" />
                </Stack>
                {ledger.loading ? (
                    <CircularProgress size={20} />
                ) : completedSessions.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                        Завершённых смен за период нет.
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

            <RecordPaymentDialog
                open={paymentDialogOpen}
                onClose={() => setPaymentDialogOpen(false)}
                employeeId={userId}
                employeeName={employee?.name || ''}
                companyId={companyId}
                onSaved={async () => {
                    await ledger.refresh();
                    setPaymentDialogOpen(false);
                }}
            />
        </Container>
    );
};

// ─────────────────────────────────────────────────────────────────────
// Balance strip — same palette as MyTimePage (keep visually aligned).
// ─────────────────────────────────────────────────────────────────────

const BalanceStrip: React.FC<{
    buckets: ReturnType<typeof useWorkerLedger>['buckets'];
    loading: boolean;
}> = ({ buckets, loading }) => {
    const balancePositive = buckets.balance > 0;
    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
                gap: 1.5,
            }}
        >
            <KPI label="Начислено" value={fmtUsd(buckets.salary, true)} loading={loading} />
            <KPI label="Выплачено" value={fmtUsd(buckets.payments, true)} loading={loading} />
            <KPI
                label="Баланс"
                value={fmtUsd(buckets.balance, true)}
                subtitle={balancePositive ? 'к выплате' : 'в расчёте'}
                color={balancePositive ? 'warning' : 'success'}
                loading={loading}
            />
            <KPI label="Часов" value={buckets.totalHours.toFixed(1) + 'ч'} loading={loading} />
        </Box>
    );
};

const KPI: React.FC<{
    label: string;
    value: string;
    color?: 'warning' | 'success';
    subtitle?: string;
    loading: boolean;
}> = ({ label, value, color, subtitle, loading }) => {
    const tint =
        color === 'warning'
            ? 'warning.main'
            : color === 'success'
                ? 'success.main'
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
// Record payment dialog — creates a `type=payment` work_session entry
// with negative earnings, exactly like FinancePage does. Unified write
// path keeps balance formula consistent.
// ─────────────────────────────────────────────────────────────────────

interface DialogProps {
    open: boolean;
    onClose: () => void;
    employeeId: string;
    employeeName: string;
    companyId: string | undefined;
    onSaved: () => Promise<void>;
}

const RecordPaymentDialog: React.FC<DialogProps> = ({
    open,
    onClose,
    employeeId,
    employeeName,
    companyId,
    onSaved,
}) => {
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        const n = parseFloat(amount);
        if (!n || n <= 0) {
            toast.error('Сумма должна быть положительной');
            return;
        }
        // PR #95 companion: tightened work_sessions rules require companyId.
        if (!companyId) {
            toast.error('Не получилось: нет companyId. Перелогиньтесь.');
            return;
        }
        setSaving(true);
        try {
            const now = Timestamp.now();
            // Payment rows are work_sessions with type='payment' and
            // negative sessionEarnings — same shape as FinancePage writes.
            // calculatePayrollBuckets takes abs() so bucket math is right.
            await addDoc(collection(db, 'work_sessions'), {
                employeeId,
                employeeName,
                companyId, // PR #95 companion: required by tightened rules
                clientId: '',
                clientName: 'Payment',
                startTime: now,
                endTime: now,
                status: 'completed',
                type: 'payment',
                sessionEarnings: -Math.abs(n),
                description: note || `Payment to ${employeeName}`,
                durationMinutes: 0,
                createdBy: 'admin-workers-page',
                createdAt: now,
            });
            toast.success(`Записана выплата $${n.toFixed(2)}`);
            setAmount('');
            setNote('');
            await onSaved();
        } catch (e) {
            console.error('Record payment failed:', e);
            toast.error('Не получилось записать. Попробуй ещё раз.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Записать выплату · {employeeName}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} pt={1}>
                    <TextField
                        autoFocus
                        label="Сумма (USD)"
                        type="number"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        InputProps={{ startAdornment: <Typography mr={0.5}>$</Typography> }}
                        fullWidth
                    />
                    <TextField
                        label="Примечание (опционально)"
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        multiline
                        minRows={2}
                        fullWidth
                        placeholder="напр. зарплата за март / выдал наличными / Zelle"
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Отмена</Button>
                <Button variant="contained" onClick={submit} disabled={saving || !amount}>
                    {saving ? 'Сохраняю...' : 'Записать'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AdminWorkerDetailPage;
