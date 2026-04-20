/**
 * Admin "all workers" overview — table of every active employee with
 * YTD hours / earned / paid / balance, clickable through to the per-
 * worker detail page.
 *
 * Shares data hooks with the `/crm/finance` page (same numbers, same
 * Firestore queries, same canonical bucket formula) so admins see
 * identical balances whether they're looking at the aggregate or the
 * per-worker drill-down.
 */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert,
    Avatar,
    Box,
    CircularProgress,
    Container,
    IconButton,
    InputAdornment,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import GroupsIcon from '@mui/icons-material/Groups';
import SearchIcon from '@mui/icons-material/Search';
import { format } from 'date-fns';

import { WorkSession } from '../../../types/timeTracking.types';
import {
    calculatePayrollBuckets,
    defaultFinanceStartDate,
    useEmployeesWithRates,
    useFinanceLedger,
    type Employee,
} from '../../finance';

function fmtUsdShort(n: number): string {
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
    if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
    return `${sign}$${abs.toFixed(0)}`;
}

interface WorkerRow {
    id: string;
    name: string;
    hourlyRate: number;
    hours: number;
    salary: number;
    payments: number;
    balance: number;
    sessionCount: number;
}

const AdminWorkersListPage: React.FC = () => {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');

    const [startDate] = useState(defaultFinanceStartDate());
    const [endDate] = useState(new Date());

    const employeesDir = useEmployeesWithRates();
    const directory = employeesDir.loading
        ? null
        : {
              employees: employeesDir.employees,
              telegramIdToUid: employeesDir.telegramIdToUid,
              uidToName: employeesDir.uidToName,
          };
    const ledger = useFinanceLedger({ startDate, endDate, directory });

    const rows = useMemo<WorkerRow[]>(() => {
        if (employeesDir.loading || ledger.loading) return [];

        // Index entries by UID for O(1) lookup per employee.
        const byEmployee = new Map<string, WorkSession[]>();
        for (const entry of ledger.entries) {
            const key = String(entry.employeeId);
            if (!byEmployee.has(key)) byEmployee.set(key, []);
            byEmployee.get(key)!.push(entry);
        }

        return employeesDir.employees
            .map((emp: Employee) => {
                const own = byEmployee.get(emp.id) || [];
                const buckets = calculatePayrollBuckets(own);
                return {
                    id: emp.id,
                    name: emp.name,
                    hourlyRate: emp.hourlyRate || 0,
                    hours: buckets.totalHours,
                    salary: buckets.salary,
                    payments: buckets.payments,
                    balance: buckets.balance,
                    sessionCount: own.filter(s => !s.type || s.type === 'regular').length,
                };
            })
            // Hide completely inactive workers (no sessions AND no rate AND zero balance).
            .filter(w => w.hours > 0 || w.payments > 0 || w.balance !== 0 || w.hourlyRate > 0);
    }, [employeesDir.loading, employeesDir.employees, ledger.loading, ledger.entries]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = q
            ? rows.filter(r => r.name.toLowerCase().includes(q))
            : rows;
        // Sort: largest positive balance first (need to pay), then by earnings.
        return [...list].sort((a, b) => {
            if (a.balance > 0 && b.balance <= 0) return -1;
            if (b.balance > 0 && a.balance <= 0) return 1;
            return b.salary - a.salary;
        });
    }, [rows, search]);

    const loading = employeesDir.loading || ledger.loading;
    const error = employeesDir.error || ledger.error;

    // Company totals row — matches what FinancePage shows in its KPI cards.
    const totals = useMemo(() => {
        return rows.reduce(
            (acc, r) => ({
                hours: acc.hours + r.hours,
                salary: acc.salary + r.salary,
                payments: acc.payments + r.payments,
                balance: acc.balance + r.balance,
            }),
            { hours: 0, salary: 0, payments: 0, balance: 0 }
        );
    }, [rows]);

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            <Stack direction="row" alignItems="center" spacing={2} mb={2}>
                <Avatar sx={{ bgcolor: 'primary.main' }}>
                    <GroupsIcon />
                </Avatar>
                <Box flex={1}>
                    <Typography variant="h5" fontWeight={700}>
                        Работники
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        За период&nbsp;
                        <strong>{format(startDate, 'dd.MM.yyyy')}</strong>
                        {' — '}
                        <strong>{format(endDate, 'dd.MM.yyyy')}</strong>
                        {' · '}
                        {filtered.length} {filtered.length === 1 ? 'сотрудник' : 'сотрудников'}
                    </Typography>
                </Box>
                <TextField
                    size="small"
                    placeholder="Поиск по имени..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon fontSize="small" />
                            </InputAdornment>
                        ),
                    }}
                    sx={{ minWidth: 240 }}
                />
            </Stack>

            {error && (
                <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                    {error}
                </Alert>
            )}

            {/* Totals strip — company-wide numbers. Mirrors FinancePage KPIs. */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
                    gap: 1.5,
                    mb: 2,
                }}
            >
                <TotalCard label="Часов" value={totals.hours.toFixed(0) + 'ч'} />
                <TotalCard label="Начислено" value={fmtUsdShort(totals.salary)} />
                <TotalCard label="Выплачено" value={fmtUsdShort(totals.payments)} />
                <TotalCard
                    label="К выплате"
                    value={fmtUsdShort(totals.balance)}
                    color={totals.balance > 0 ? 'warning' : 'success'}
                />
            </Box>

            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <TableContainer>
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell>Сотрудник</TableCell>
                                <TableCell align="right">Ставка</TableCell>
                                <TableCell align="right">Часы</TableCell>
                                <TableCell align="right">Начислено</TableCell>
                                <TableCell align="right">Выплачено</TableCell>
                                <TableCell align="right">К выплате</TableCell>
                                <TableCell align="right">Сессии</TableCell>
                                <TableCell width={40} />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                                        <CircularProgress size={24} />
                                    </TableCell>
                                </TableRow>
                            ) : filtered.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                                        <Typography variant="body2" color="text.secondary">
                                            {search
                                                ? 'Никто не нашёлся по твоему поиску.'
                                                : 'Пока нет активных сотрудников за этот период.'}
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filtered.map(row => (
                                    <WorkerTableRow
                                        key={row.id}
                                        row={row}
                                        onOpen={() => navigate(`/admin/workers/${row.id}`)}
                                    />
                                ))
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>
        </Container>
    );
};

// ─────────────────────────────────────────────────────────────────────
// Row — single worker + balance color cues
// ─────────────────────────────────────────────────────────────────────

interface RowProps {
    row: WorkerRow;
    onOpen: () => void;
}

const WorkerTableRow: React.FC<RowProps> = ({ row, onOpen }) => {
    const balanceColor =
        row.balance > 0 ? 'warning.main' : row.balance < 0 ? 'error.main' : 'text.secondary';

    return (
        <TableRow
            hover
            onClick={onOpen}
            sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
        >
            <TableCell>
                <Stack direction="row" spacing={1.25} alignItems="center">
                    <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>
                        {row.name.charAt(0).toUpperCase()}
                    </Avatar>
                    <Typography variant="body2" fontWeight={500}>
                        {row.name}
                    </Typography>
                </Stack>
            </TableCell>
            <TableCell align="right">
                {row.hourlyRate ? `$${row.hourlyRate}/ч` : (
                    <Tooltip title="Ставка не установлена">
                        <Typography variant="caption" color="warning.main">—</Typography>
                    </Tooltip>
                )}
            </TableCell>
            <TableCell align="right">{row.hours.toFixed(1)}</TableCell>
            <TableCell align="right">{fmtUsdShort(row.salary)}</TableCell>
            <TableCell align="right">{fmtUsdShort(row.payments)}</TableCell>
            <TableCell align="right" sx={{ color: balanceColor, fontWeight: 700 }}>
                {fmtUsdShort(row.balance)}
            </TableCell>
            <TableCell align="right" sx={{ color: 'text.secondary' }}>
                {row.sessionCount}
            </TableCell>
            <TableCell>
                <IconButton size="small">
                    <ChevronRightIcon fontSize="small" />
                </IconButton>
            </TableCell>
        </TableRow>
    );
};

// ─────────────────────────────────────────────────────────────────────
// Company totals card (4 across)
// ─────────────────────────────────────────────────────────────────────

const TotalCard: React.FC<{
    label: string;
    value: string;
    color?: 'warning' | 'success';
}> = ({ label, value, color }) => {
    const valueColor =
        color === 'warning' ? 'warning.main' : color === 'success' ? 'success.main' : 'text.primary';
    return (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
            <Typography variant="h5" fontWeight={700} sx={{ color: valueColor, mt: 0.5 }}>
                {value}
            </Typography>
        </Paper>
    );
};

export default AdminWorkersListPage;
