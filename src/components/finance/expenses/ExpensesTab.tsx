import React, { useMemo, useState } from 'react';
import {
    Box, Typography, Paper, Card, CardContent, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Chip, CircularProgress,
    FormControl, InputLabel, Select, MenuItem, IconButton, Dialog,
    DialogContent, DialogTitle, TablePagination, Button, Tooltip, LinearProgress,
} from '@mui/material';
import PhotoIcon from '@mui/icons-material/Photo';
import CloseIcon from '@mui/icons-material/Close';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import DashboardIcon from '@mui/icons-material/Dashboard';
import LinkIcon from '@mui/icons-material/Link';
import { useNavigate } from 'react-router-dom';
import {
    CostEntry,
    COST_CATEGORIES,
    getCategoryLabel,
    getCategoryColor,
    getCategoryHexColor,
} from '../../../types/finance.types';

// ── Props ────────────────────────────────────────────────────────────────────

interface ExpensesTabProps {
    costs: CostEntry[];
    loading: boolean;
    startDate: Date;
    endDate: Date;
}

// ── Component ────────────────────────────────────────────────────────────────

export const ExpensesTab: React.FC<ExpensesTabProps> = ({ costs, loading, startDate, endDate }) => {
    const navigate = useNavigate();

    // Filters
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterEmployee, setFilterEmployee] = useState('all');
    const [filterClient, setFilterClient] = useState('all');

    // Pagination
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);

    // Photo preview
    const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

    // ── Derived data ─────────────────────────────────────────────────────────

    const uniqueEmployees = useMemo(() => {
        const emps = new Map<string, string>();
        costs.forEach(c => {
            if (c.userId && c.userName) emps.set(c.userId, c.userName);
        });
        return Array.from(emps.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [costs]);

    const uniqueClients = useMemo(() => {
        const clients = new Set(costs.map(c => c.clientName).filter(Boolean));
        return Array.from(clients).sort();
    }, [costs]);

    const filteredCosts = useMemo(() => {
        return costs.filter(cost => {
            const matchesCategory = filterCategory === 'all' || cost.category === filterCategory;
            const matchesEmployee = filterEmployee === 'all' || cost.userId === filterEmployee;
            const matchesClient = filterClient === 'all' || cost.clientName === filterClient;
            return matchesCategory && matchesEmployee && matchesClient;
        });
    }, [costs, filterCategory, filterEmployee, filterClient]);

    // Reset page on filter change
    React.useEffect(() => { setPage(0); }, [filterCategory, filterEmployee, filterClient]);

    // ── Statistics ────────────────────────────────────────────────────────────

    const stats = useMemo(() => {
        let totalExpenses = 0;
        let reimbursements = 0;

        filteredCosts.forEach(c => {
            if (c.category === 'reimbursement') {
                reimbursements += Math.abs(c.amount);
            } else {
                totalExpenses += Math.abs(c.amount);
            }
        });

        return {
            totalCosts: totalExpenses,
            reimbursements,
            net: totalExpenses - reimbursements,
            count: filteredCosts.length,
        };
    }, [filteredCosts]);

    // ── Category Breakdown ───────────────────────────────────────────────────

    const categoryBreakdown = useMemo(() => {
        const map = new Map<string, number>();
        filteredCosts.forEach(c => {
            if (c.category !== 'reimbursement') {
                const prev = map.get(c.category) || 0;
                map.set(c.category, prev + Math.abs(c.amount));
            }
        });
        const entries = Array.from(map.entries())
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => b.amount - a.amount);
        const maxAmount = entries.length > 0 ? entries[0].amount : 1;
        return { entries, maxAmount };
    }, [filteredCosts]);

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <Box sx={{ mt: 4, textAlign: 'center' }}>
                <CircularProgress />
                <Typography sx={{ mt: 2 }} color="text.secondary">Loading expenses…</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ mt: 2 }}>
            {/* ── Quick Links ───────────────────────────────────────────────── */}
            <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ReceiptLongIcon />}
                    onClick={() => navigate('/crm/costs')}
                >
                    Full Costs Report
                </Button>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AccountBalanceIcon />}
                    onClick={() => navigate('/crm/bank-statements')}
                >
                    Bank Statements
                </Button>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<DashboardIcon />}
                    onClick={() => navigate('/crm/expenses-board')}
                >
                    Expenses Board
                </Button>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<LinkIcon />}
                    onClick={() => navigate('/crm/reconciliation')}
                >
                    Reconciliation
                </Button>
            </Box>

            {/* ── Summary Cards ─────────────────────────────────────────────── */}
            <Box sx={{ display: 'flex', gap: 3, mb: 4, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 180 }}>
                    <Card sx={{ bgcolor: '#ff9800', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Total Costs</Typography>
                            <Typography variant="h4" fontWeight="bold">
                                ${stats.totalCosts.toFixed(2)}
                            </Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 180 }}>
                    <Card sx={{ bgcolor: '#4caf50', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Reimbursements</Typography>
                            <Typography variant="h4" fontWeight="bold">
                                -${stats.reimbursements.toFixed(2)}
                            </Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 180 }}>
                    <Card sx={{ bgcolor: stats.net > 0 ? '#f44336' : '#4caf50', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Net Expenses</Typography>
                            <Typography variant="h4" fontWeight="bold">
                                ${stats.net.toFixed(2)}
                            </Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 180 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent>
                            <Typography color="textSecondary" variant="body2">Entries</Typography>
                            <Typography variant="h4" fontWeight="bold">{stats.count}</Typography>
                        </CardContent>
                    </Card>
                </Box>
            </Box>

            {/* ── Category Breakdown ────────────────────────────────────────── */}
            {categoryBreakdown.entries.length > 0 && (
                <Paper sx={{ p: 2, mb: 3 }}>
                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                        Category Breakdown
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {categoryBreakdown.entries.map(({ category, amount }) => (
                            <Box key={category} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Box sx={{ width: 140, flexShrink: 0 }}>
                                    <Chip
                                        label={getCategoryLabel(category)}
                                        color={getCategoryColor(category)}
                                        size="small"
                                        variant="outlined"
                                    />
                                </Box>
                                <Box sx={{ flex: 1 }}>
                                    <Tooltip title={`$${amount.toFixed(2)}`}>
                                        <LinearProgress
                                            variant="determinate"
                                            value={(amount / categoryBreakdown.maxAmount) * 100}
                                            sx={{
                                                height: 12,
                                                borderRadius: 1,
                                                bgcolor: 'grey.200',
                                                '& .MuiLinearProgress-bar': {
                                                    bgcolor: getCategoryHexColor(category),
                                                    borderRadius: 1,
                                                },
                                            }}
                                        />
                                    </Tooltip>
                                </Box>
                                <Typography variant="body2" fontWeight="bold" sx={{ width: 90, textAlign: 'right', flexShrink: 0 }}>
                                    ${amount.toFixed(2)}
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                </Paper>
            )}

            {/* ── Filters ──────────────────────────────────────────────────── */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <Typography variant="subtitle2" gutterBottom fontWeight="bold">Filters</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>Category</InputLabel>
                        <Select
                            value={filterCategory}
                            label="Category"
                            onChange={(e) => setFilterCategory(e.target.value)}
                        >
                            <MenuItem value="all">All Categories</MenuItem>
                            {COST_CATEGORIES.map(cat => (
                                <MenuItem key={cat.id} value={cat.id}>{cat.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>Employee</InputLabel>
                        <Select
                            value={filterEmployee}
                            label="Employee"
                            onChange={(e) => setFilterEmployee(e.target.value)}
                        >
                            <MenuItem value="all">All Employees</MenuItem>
                            {uniqueEmployees.map(emp => (
                                <MenuItem key={emp.id} value={emp.id}>{emp.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>Client</InputLabel>
                        <Select
                            value={filterClient}
                            label="Client"
                            onChange={(e) => setFilterClient(e.target.value)}
                        >
                            <MenuItem value="all">All Clients</MenuItem>
                            {uniqueClients.map(client => (
                                <MenuItem key={client} value={client}>{client}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Box>
            </Paper>

            {/* ── Costs Table ──────────────────────────────────────────────── */}
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                            <TableCell>Date / Time</TableCell>
                            <TableCell>Employee</TableCell>
                            <TableCell>Client</TableCell>
                            <TableCell>Category</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell>Photo</TableCell>
                            <TableCell>Note</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {filteredCosts.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} align="center">
                                    <Typography color="text.secondary" sx={{ py: 4 }}>
                                        No cost entries found for this period
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredCosts
                                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                                .map((cost) => {
                                    const date = cost.createdAt
                                        ? new Date(cost.createdAt.seconds * 1000)
                                        : new Date();
                                    const isReimbursement = cost.category === 'reimbursement';

                                    return (
                                        <TableRow key={cost.id} hover>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight="bold">
                                                    {date.toLocaleDateString()}
                                                </Typography>
                                                <Typography variant="caption" color="textSecondary">
                                                    {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>{cost.userName}</TableCell>
                                            <TableCell>{cost.clientName}</TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={getCategoryLabel(cost.category)}
                                                    color={getCategoryColor(cost.category)}
                                                    size="small"
                                                    variant={isReimbursement ? 'filled' : 'outlined'}
                                                />
                                            </TableCell>
                                            <TableCell
                                                align="right"
                                                sx={{
                                                    fontWeight: 'bold',
                                                    color: isReimbursement ? 'green' : 'inherit',
                                                }}
                                            >
                                                {isReimbursement ? '-' : ''}${Math.abs(cost.amount).toFixed(2)}
                                            </TableCell>
                                            <TableCell>
                                                {cost.receiptPhotoUrl ? (
                                                    <IconButton
                                                        size="small"
                                                        color="primary"
                                                        onClick={() => setPreviewPhoto(cost.receiptPhotoUrl)}
                                                    >
                                                        <PhotoIcon />
                                                    </IconButton>
                                                ) : null}
                                            </TableCell>
                                            <TableCell>
                                                <Tooltip title={cost.description || ''}>
                                                    <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                                        {cost.description || '-'}
                                                    </Typography>
                                                </Tooltip>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                        )}
                    </TableBody>
                </Table>
                {filteredCosts.length > 0 && (
                    <TablePagination
                        component="div"
                        count={filteredCosts.length}
                        page={page}
                        onPageChange={(_, newPage) => setPage(newPage)}
                        rowsPerPage={rowsPerPage}
                        onRowsPerPageChange={(e) => {
                            setRowsPerPage(parseInt(e.target.value, 10));
                            setPage(0);
                        }}
                        rowsPerPageOptions={[10, 25, 50, 100]}
                    />
                )}
            </TableContainer>

            {/* ── Photo Preview Dialog ─────────────────────────────────────── */}
            <Dialog open={!!previewPhoto} onClose={() => setPreviewPhoto(null)} maxWidth="md">
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Receipt Photo
                    <IconButton onClick={() => setPreviewPhoto(null)}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    {previewPhoto && (
                        <img
                            src={previewPhoto}
                            alt="Receipt"
                            style={{ maxWidth: '100%', maxHeight: '70vh' }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </Box>
    );
};
