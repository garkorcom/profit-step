import React, { useState, useMemo, useCallback } from 'react';
import {
    Box, Typography, IconButton, TextField, Button, Tooltip, Chip,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, LinearProgress, InputAdornment, Collapse, useTheme, alpha,
    Select, MenuItem, FormControl, Dialog, DialogTitle, DialogContent,
    DialogActions, List, ListItem, ListItemText, Divider,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PersonIcon from '@mui/icons-material/Person';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { Timestamp } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { GTDTask, Payment, PaymentMethod } from '../../types/gtd.types';
import { WorkSessionData } from '../../hooks/useActiveSession';

const SF_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

/** Preset budget categories */
const BUDGET_CATEGORIES = [
    'HVAC', 'Electrical', 'Plumbing', 'Framing', 'Drywall',
    'Flooring', 'Materials', 'Consulting', 'Admin', 'Other',
] as const;

const UNCATEGORIZED_KEY = '__uncategorized__';
const UNCATEGORIZED_LABEL = 'Общие работы';

const PAYMENT_METHODS: { value: PaymentMethod; label: string; emoji: string }[] = [
    { value: 'check', label: 'Чек', emoji: '🏦' },
    { value: 'wire', label: 'Перевод', emoji: '🔄' },
    { value: 'cash', label: 'Наличные', emoji: '💵' },
    { value: 'card', label: 'Карта', emoji: '💳' },
];

/** Payment status indicator */
const getPaymentStatus = (budgetAmount: number, paidAmount: number): {
    label: string; color: string; bgColor: string; emoji: string;
} => {
    if (budgetAmount <= 0) return { label: '', color: '#86868b', bgColor: 'transparent', emoji: '' };
    if (paidAmount <= 0) return { label: 'Не оплачено', color: '#86868b', bgColor: '#f0f0f2', emoji: '○' };
    if (paidAmount > budgetAmount) return { label: 'Переплата', color: '#c2410c', bgColor: '#fff7ed', emoji: '⚠' };
    if (paidAmount >= budgetAmount) return { label: 'Оплачено', color: '#166534', bgColor: '#dcfce7', emoji: '✓' };
    return { label: 'Частично', color: '#92400e', bgColor: '#FEF3C7', emoji: '◐' };
};

interface GTDSubtasksTableProps {
    parentTaskId: string;
    allTasks: GTDTask[];
    onUpdateTask: (taskId: string, updates: Partial<GTDTask>) => Promise<void>;
    onDeleteTask: (taskId: string) => Promise<void>;
    onAddSubtask: (parentTaskId: string, title: string, budgetAmount?: number, extras?: { estimatedMinutes?: number; budgetCategory?: string }) => Promise<void>;
    onStartSession?: (task: GTDTask) => void;
    onStopSession?: (task: GTDTask) => void;
    activeSession?: WorkSessionData | null;
}

/** Grouped subtasks by category */
interface CategoryGroup {
    key: string;
    label: string;
    subtasks: GTDTask[];
    totalBudget: number;
    totalCompleted: number;
    totalPaid: number;
    totalDebt: number;
    totalEstimatedMinutes: number;
    totalTimeMinutes: number;
    overallPct: number;
}

const GTDSubtasksTable: React.FC<GTDSubtasksTableProps> = ({
    parentTaskId,
    allTasks,
    onUpdateTask,
    onDeleteTask,
    onAddSubtask,
    onStartSession,
    onStopSession,
    activeSession,
}) => {
    const theme = useTheme();
    const [isExpanded, setIsExpanded] = useState(true);
    const [newTitle, setNewTitle] = useState('');
    const [newBudget, setNewBudget] = useState('');
    const [newPlanHours, setNewPlanHours] = useState('');
    const [newCategory, setNewCategory] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

    // Payment dialog state
    const [paymentDialogTask, setPaymentDialogTask] = useState<GTDTask | null>(null);
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [paymentNote, setPaymentNote] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
    const [paymentSaving, setPaymentSaving] = useState(false);

    // Payment history dialog state
    const [historyTask, setHistoryTask] = useState<GTDTask | null>(null);

    // Filter subtasks for this parent
    const subtasks = useMemo(
        () => allTasks.filter(t => t.parentTaskId === parentTaskId),
        [allTasks, parentTaskId]
    );

    // Group subtasks by budgetCategory
    const categoryGroups: CategoryGroup[] = useMemo(() => {
        const groupMap = new Map<string, GTDTask[]>();

        subtasks.forEach(st => {
            const key = st.budgetCategory || UNCATEGORIZED_KEY;
            if (!groupMap.has(key)) groupMap.set(key, []);
            groupMap.get(key)!.push(st);
        });

        const groups: CategoryGroup[] = [];
        groupMap.forEach((tasks, key) => {
            let totalBudget = 0;
            let totalCompleted = 0;
            let totalPaid = 0;
            let totalEstimatedMinutes = 0;
            let totalTimeMinutes = 0;

            tasks.forEach(st => {
                const budget = st.budgetAmount || 0;
                const pct = Math.min(100, Math.max(0, st.progressPercentage || 0));
                const paid = st.paidAmount || 0;
                totalBudget += budget;
                totalCompleted += budget * (pct / 100);
                totalPaid += paid;
                totalEstimatedMinutes += st.estimatedMinutes || 0;
                totalTimeMinutes += st.totalTimeSpentMinutes || 0;
            });

            groups.push({
                key,
                label: key === UNCATEGORIZED_KEY ? UNCATEGORIZED_LABEL : key,
                subtasks: tasks,
                totalBudget,
                totalCompleted,
                totalPaid,
                totalDebt: totalBudget - totalPaid,
                totalEstimatedMinutes,
                totalTimeMinutes,
                overallPct: totalBudget > 0 ? (totalCompleted / totalBudget) * 100 : 0,
            });
        });

        // Sort: named categories first (alphabetical), uncategorized last
        groups.sort((a, b) => {
            if (a.key === UNCATEGORIZED_KEY) return 1;
            if (b.key === UNCATEGORIZED_KEY) return -1;
            return a.label.localeCompare(b.label);
        });

        return groups;
    }, [subtasks]);

    // Has multiple categories?
    const hasMultipleCategories = categoryGroups.length > 1;

    // Grand totals
    const totals = useMemo(() => {
        let totalBudget = 0;
        let totalCompleted = 0;
        let totalPaid = 0;
        let totalTimeMinutes = 0;
        let totalEstimatedMinutes = 0;

        subtasks.forEach(st => {
            const budget = st.budgetAmount || 0;
            const pct = Math.min(100, Math.max(0, st.progressPercentage || 0));
            totalBudget += budget;
            totalCompleted += budget * (pct / 100);
            totalPaid += st.paidAmount || 0;
            totalTimeMinutes += st.totalTimeSpentMinutes || 0;
            totalEstimatedMinutes += st.estimatedMinutes || 0;
        });

        const overallPct = totalBudget > 0 ? (totalCompleted / totalBudget) * 100 : 0;
        const totalDebt = totalBudget - totalPaid;

        return { totalBudget, totalCompleted, totalPaid, totalDebt, overallPct, totalTimeMinutes, totalEstimatedMinutes };
    }, [subtasks]);

    const toggleCategory = (key: string) => {
        setCollapsedCategories(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const handleAddSubtask = async () => {
        if (!newTitle.trim()) return;
        const budget = parseFloat(newBudget) || 0;
        const estimatedMinutes = (parseFloat(newPlanHours) || 0) * 60;

        if (budget < 0 || estimatedMinutes < 0) return;
        try {
            await onAddSubtask(parentTaskId, newTitle.trim(), budget, {
                estimatedMinutes: estimatedMinutes > 0 ? estimatedMinutes : undefined,
                budgetCategory: newCategory || undefined,
            });
            setNewTitle('');
            setNewBudget('');
            setNewPlanHours('');
            setNewCategory('');
            setIsAdding(false);
        } catch (e) {
            console.error('Failed to add subtask:', e);
        }
    };

    const handleProgressChange = async (taskId: string, value: string) => {
        const num = Math.min(100, Math.max(0, parseInt(value) || 0));
        await onUpdateTask(taskId, { progressPercentage: num });
    };

    const handlePlanHoursChange = async (taskId: string, value: string) => {
        const num = Math.max(0, parseFloat(value) || 0);
        await onUpdateTask(taskId, { estimatedMinutes: num * 60 });
    };

    const openPaymentDialog = useCallback((task: GTDTask) => {
        setPaymentDialogTask(task);
        setPaymentAmount('');
        setPaymentDate(new Date().toISOString().split('T')[0]);
        setPaymentNote('');
        setPaymentMethod('');
        setPaymentSaving(false);
    }, []);

    const closePaymentDialog = useCallback(() => {
        setPaymentDialogTask(null);
    }, []);

    const handleSavePayment = useCallback(async () => {
        if (!paymentDialogTask || !paymentAmount) return;
        const amount = parseFloat(paymentAmount);
        if (isNaN(amount) || amount <= 0) return;

        setPaymentSaving(true);
        try {
            const newPayment: Payment = {
                id: nanoid(),
                amount,
                date: Timestamp.fromDate(new Date(paymentDate + 'T12:00:00')),
                note: paymentNote.trim() || undefined,
                method: (paymentMethod as PaymentMethod) || undefined,
                createdBy: 'owner', // will be resolved on display
                createdAt: Timestamp.now(),
            };

            const existingPayments = paymentDialogTask.payments || [];
            const updatedPayments = [...existingPayments, newPayment];
            const newPaidAmount = updatedPayments.reduce((sum, p) => sum + p.amount, 0);

            await onUpdateTask(paymentDialogTask.id, {
                payments: updatedPayments,
                paidAmount: newPaidAmount,
            } as Partial<GTDTask>);

            closePaymentDialog();
        } catch (e) {
            console.error('Failed to save payment:', e);
        } finally {
            setPaymentSaving(false);
        }
    }, [paymentDialogTask, paymentAmount, paymentDate, paymentNote, paymentMethod, onUpdateTask, closePaymentDialog]);

    const handleDeletePayment = useCallback(async (task: GTDTask, paymentId: string) => {
        const existingPayments = task.payments || [];
        const updatedPayments = existingPayments.filter(p => p.id !== paymentId);
        const newPaidAmount = updatedPayments.reduce((sum, p) => sum + p.amount, 0);

        await onUpdateTask(task.id, {
            payments: updatedPayments,
            paidAmount: newPaidAmount,
        } as Partial<GTDTask>);

        // Update history dialog if open
        if (historyTask?.id === task.id) {
            const updatedTask = { ...task, payments: updatedPayments, paidAmount: newPaidAmount };
            setHistoryTask(updatedTask);
        }
    }, [onUpdateTask, historyTask]);

    const formatCurrency = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    const formatTime = (mins: number) => {
        if (mins < 60) return `${mins}m`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    };

    // ─── Empty state ───
    if (subtasks.length === 0 && !isAdding) {
        return (
            <Box sx={{ mt: 2 }}>
                <Button
                    startIcon={<AddIcon />}
                    onClick={() => setIsAdding(true)}
                    fullWidth
                    sx={{
                        borderStyle: 'dashed',
                        borderColor: alpha(theme.palette.primary.main, 0.3),
                        borderWidth: 1,
                        borderRadius: '10px',
                        py: 1.5,
                        textTransform: 'none',
                        fontWeight: 600,
                        fontSize: '13px',
                        color: theme.palette.primary.main,
                        fontFamily: SF_FONT,
                        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) },
                    }}
                    variant="outlined"
                >
                    Добавить подзадачи (Смета / Progress Tracking)
                </Button>
                <Collapse in={isAdding}>
                    <AddSubtaskRow
                        newTitle={newTitle}
                        newBudget={newBudget}
                        newPlanHours={newPlanHours}
                        newCategory={newCategory}
                        setNewTitle={setNewTitle}
                        setNewBudget={setNewBudget}
                        setNewPlanHours={setNewPlanHours}
                        setNewCategory={setNewCategory}
                        onAdd={handleAddSubtask}
                        onCancel={() => setIsAdding(false)}
                    />
                </Collapse>
            </Box>
        );
    }

    // ─── Column count for subtotal/total colSpan calculations ───
    const COL_COUNT = 9; // Title, Budget, %, Completed, Paid, Debt, Plan, Fact+Timer, Delete

    return (
        <Box sx={{ mt: 2 }}>
            {/* Header */}
            <Box
                onClick={() => setIsExpanded(!isExpanded)}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    mb: 1,
                    p: 1,
                    borderRadius: '10px',
                    bgcolor: alpha(theme.palette.info.main, 0.04),
                    '&:hover': { bgcolor: alpha(theme.palette.info.main, 0.08) },
                    transition: 'background 0.2s',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{
                        fontSize: '13px', fontWeight: 700, color: '#1d1d1f',
                        fontFamily: SF_FONT, textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>
                        📊 Подзадачи / Смета ({subtasks.length})
                    </Typography>
                    <Chip
                        label={`${Math.round(totals.overallPct)}%`}
                        size="small"
                        sx={{
                            height: 22,
                            fontSize: '11px',
                            fontWeight: 700,
                            bgcolor: totals.overallPct >= 100 ? '#dcfce7' : totals.overallPct > 50 ? '#FEF3C7' : '#f0f0f2',
                            color: totals.overallPct >= 100 ? '#166534' : totals.overallPct > 50 ? '#92400e' : '#6B7280',
                            fontFamily: SF_FONT,
                        }}
                    />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#86868b', fontFamily: SF_FONT }}>
                        {formatCurrency(totals.totalCompleted)} / {formatCurrency(totals.totalBudget)}
                    </Typography>
                    {isExpanded ? <ExpandLessIcon sx={{ fontSize: 18, color: '#86868b' }} /> : <ExpandMoreIcon sx={{ fontSize: 18, color: '#86868b' }} />}
                </Box>
            </Box>

            {/* Progress Bar */}
            <LinearProgress
                variant="determinate"
                value={Math.min(100, totals.overallPct)}
                sx={{
                    height: 6,
                    borderRadius: 3,
                    mb: 1.5,
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    '& .MuiLinearProgress-bar': {
                        borderRadius: 3,
                        background: totals.overallPct >= 100
                            ? 'linear-gradient(90deg, #34c759, #30d158)'
                            : 'linear-gradient(90deg, #007aff, #5ac8fa)',
                    },
                }}
            />

            {/* Table */}
            <Collapse in={isExpanded}>
                <TableContainer component={Paper} elevation={0} sx={{ borderRadius: '10px', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow sx={{ bgcolor: '#f9fafb' }}>
                                <TableCell sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75 }}>Работа</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 80 }}>Смета</TableCell>
                                <TableCell align="center" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 75 }}>% Готов.</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 80 }}>Выполн.</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 85 }}>Оплачено</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 80 }}>Дебет</TableCell>
                                <TableCell align="center" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 75 }}>План (ч)</TableCell>
                                <TableCell align="center" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 70 }}>Факт</TableCell>
                                <TableCell align="center" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 40 }}></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {categoryGroups.map((group) => (
                                <React.Fragment key={group.key}>
                                    {/* Category Header (only if multiple categories) */}
                                    {hasMultipleCategories && (
                                        <TableRow
                                            onClick={() => toggleCategory(group.key)}
                                            sx={{
                                                cursor: 'pointer',
                                                bgcolor: alpha(theme.palette.primary.main, 0.03),
                                                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) },
                                            }}
                                        >
                                            <TableCell colSpan={COL_COUNT} sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    {collapsedCategories.has(group.key)
                                                        ? <KeyboardArrowRightIcon sx={{ fontSize: 16, color: '#86868b' }} />
                                                        : <KeyboardArrowDownIcon sx={{ fontSize: 16, color: '#86868b' }} />
                                                    }
                                                    <Typography sx={{
                                                        fontSize: '11.5px', fontWeight: 700, fontFamily: SF_FONT,
                                                        color: '#1d1d1f', textTransform: 'uppercase', letterSpacing: '0.03em',
                                                    }}>
                                                        {group.label}
                                                    </Typography>
                                                    <Typography sx={{ fontSize: '11px', fontWeight: 500, fontFamily: SF_FONT, color: '#86868b', ml: 0.5 }}>
                                                        ({group.subtasks.length})
                                                    </Typography>
                                                    <Box sx={{ flex: 1 }} />
                                                    {collapsedCategories.has(group.key) && (
                                                        <Typography sx={{ fontSize: '11px', fontWeight: 600, fontFamily: SF_FONT, color: '#86868b' }}>
                                                            {formatCurrency(group.totalBudget)} • {Math.round(group.overallPct)}%
                                                            {group.totalPaid > 0 && ` • Опл: ${formatCurrency(group.totalPaid)}`}
                                                            {group.totalDebt > 0 && ` • Долг: ${formatCurrency(group.totalDebt)}`}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    )}

                                    {/* Subtask rows */}
                                    {!collapsedCategories.has(group.key) && group.subtasks.map((st) => {
                                        const pct = Math.min(100, Math.max(0, st.progressPercentage || 0));
                                        const budget = st.budgetAmount || 0;
                                        const completedAmount = budget * (pct / 100);
                                        const paid = st.paidAmount || 0;
                                        const debt = budget - paid;
                                        const isActive = activeSession && activeSession.relatedTaskId === st.id;
                                        const isFullyPaid = budget > 0 && paid >= budget;
                                        const hasDebt = budget > 0 && debt > 0;
                                        const paymentStatus = getPaymentStatus(budget, paid);

                                        return (
                                            <TableRow
                                                key={st.id}
                                                sx={{
                                                    '&:hover': { bgcolor: 'rgba(0,0,0,0.02)' },
                                                    bgcolor: isActive ? 'rgba(52,199,89,0.06)' : 'transparent',
                                                    transition: 'background 0.2s',
                                                }}
                                            >
                                                {/* Title */}
                                                <TableCell sx={{ py: 0.75, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    <Typography sx={{
                                                        fontSize: '12.5px', fontWeight: 500, fontFamily: SF_FONT,
                                                        color: pct >= 100 ? '#86868b' : '#1d1d1f',
                                                        textDecoration: pct >= 100 ? 'line-through' : 'none',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200,
                                                    }}>
                                                        {st.title}
                                                    </Typography>
                                                    {st.assigneeName && (
                                                        <Typography sx={{ fontSize: '10px', color: '#86868b', fontFamily: SF_FONT, display: 'flex', alignItems: 'center', gap: 0.3 }}>
                                                            <PersonIcon sx={{ fontSize: 10 }} /> {st.assigneeName}
                                                        </Typography>
                                                    )}
                                                </TableCell>

                                                {/* Budget */}
                                                <TableCell align="right" sx={{ py: 0.75, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    <Typography sx={{ fontSize: '12px', fontWeight: 600, fontFamily: SF_FONT, color: '#1d1d1f' }}>
                                                        {budget > 0 ? formatCurrency(budget) : '—'}
                                                    </Typography>
                                                </TableCell>

                                                {/* Progress % */}
                                                <TableCell align="center" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    <TextField
                                                        type="number"
                                                        size="small"
                                                        value={pct}
                                                        onChange={(e) => handleProgressChange(st.id, e.target.value)}
                                                        inputProps={{ min: 0, max: 100, step: 5 }}
                                                        InputProps={{
                                                            endAdornment: <InputAdornment position="end" sx={{ '& .MuiTypography-root': { fontSize: '11px' } }}>%</InputAdornment>,
                                                        }}
                                                        sx={{
                                                            width: 70,
                                                            '& .MuiInputBase-input': { fontSize: '12px', fontWeight: 600, py: 0.5, px: 0.5, textAlign: 'center', fontFamily: SF_FONT },
                                                            '& .MuiOutlinedInput-root': { borderRadius: '6px' },
                                                        }}
                                                    />
                                                </TableCell>

                                                {/* Completed Amount */}
                                                <TableCell align="right" sx={{ py: 0.75, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    <Typography sx={{
                                                        fontSize: '12px', fontWeight: 700, fontFamily: SF_FONT,
                                                        color: pct >= 100 ? '#166534' : pct > 0 ? '#0e7490' : '#86868b',
                                                    }}>
                                                        {completedAmount > 0 ? formatCurrency(completedAmount) : '—'}
                                                    </Typography>
                                                </TableCell>

                                                {/* Paid Amount + Payment Button */}
                                                <TableCell align="right" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                                                        {paid > 0 ? (
                                                            <Tooltip title="Показать историю оплат">
                                                                <Box
                                                                    onClick={() => setHistoryTask(st)}
                                                                    sx={{ cursor: 'pointer', '&:hover': { opacity: 0.7 } }}
                                                                >
                                                                    <Typography sx={{
                                                                        fontSize: '12px', fontWeight: 600, fontFamily: SF_FONT,
                                                                        color: paymentStatus.color,
                                                                    }}>
                                                                        {formatCurrency(paid)}
                                                                    </Typography>
                                                                    <Typography sx={{
                                                                        fontSize: '9px', fontWeight: 600, fontFamily: SF_FONT,
                                                                        color: paymentStatus.color, textAlign: 'right',
                                                                    }}>
                                                                        {paymentStatus.emoji} {paymentStatus.label}
                                                                    </Typography>
                                                                </Box>
                                                            </Tooltip>
                                                        ) : (
                                                            <Typography sx={{ fontSize: '12px', color: '#86868b', fontFamily: SF_FONT }}>
                                                                —
                                                            </Typography>
                                                        )}
                                                        <Tooltip title="Записать оплату">
                                                            <IconButton
                                                                size="small"
                                                                onClick={() => openPaymentDialog(st)}
                                                                sx={{
                                                                    width: 24, height: 24,
                                                                    fontSize: '14px',
                                                                    '&:hover': { bgcolor: 'rgba(0,122,255,0.08)' },
                                                                }}
                                                            >
                                                                💰
                                                            </IconButton>
                                                        </Tooltip>
                                                    </Box>
                                                </TableCell>

                                                {/* Debt (auto-calculated) */}
                                                <TableCell align="right" sx={{ py: 0.75, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    <Typography sx={{
                                                        fontSize: '12px', fontWeight: 700, fontFamily: SF_FONT,
                                                        color: budget === 0 ? '#86868b' : isFullyPaid ? '#166534' : hasDebt ? '#dc2626' : '#86868b',
                                                    }}>
                                                        {budget > 0
                                                            ? (debt <= 0 ? '✓' : formatCurrency(debt))
                                                            : '—'
                                                        }
                                                    </Typography>
                                                </TableCell>

                                                {/* Plan Hours */}
                                                <TableCell align="center" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    <TextField
                                                        type="number"
                                                        size="small"
                                                        value={st.estimatedMinutes ? Math.round((st.estimatedMinutes / 60) * 10) / 10 : ''}
                                                        onChange={(e) => handlePlanHoursChange(st.id, e.target.value)}
                                                        inputProps={{ min: 0, step: 0.5 }}
                                                        InputProps={{
                                                            endAdornment: <InputAdornment position="end" sx={{ '& .MuiTypography-root': { fontSize: '11px' } }}>ч</InputAdornment>,
                                                        }}
                                                        sx={{
                                                            width: 65,
                                                            '& .MuiInputBase-input': { fontSize: '12px', fontWeight: 600, py: 0.5, px: 0.5, textAlign: 'center', fontFamily: SF_FONT },
                                                            '& .MuiOutlinedInput-root': { borderRadius: '6px' },
                                                        }}
                                                    />
                                                </TableCell>

                                                {/* Fact Time + Timer */}
                                                <TableCell align="center" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                                        <Typography sx={{ fontSize: '11px', fontWeight: 600, fontFamily: SF_FONT, color: st.totalTimeSpentMinutes ? '#1d1d1f' : '#86868b' }}>
                                                            {formatTime(st.totalTimeSpentMinutes || 0)}
                                                        </Typography>
                                                        {isActive && onStopSession ? (
                                                            <Tooltip title="Остановить">
                                                                <IconButton
                                                                    size="small"
                                                                    onClick={() => onStopSession(st)}
                                                                    sx={{ width: 24, height: 24, bgcolor: '#ff3b30', color: 'white', '&:hover': { bgcolor: '#e63329' } }}
                                                                >
                                                                    <StopIcon sx={{ fontSize: 14 }} />
                                                                </IconButton>
                                                            </Tooltip>
                                                        ) : onStartSession ? (
                                                            <Tooltip title="Начать трекинг">
                                                                <IconButton
                                                                    size="small"
                                                                    onClick={() => onStartSession(st)}
                                                                    sx={{ width: 24, height: 24, bgcolor: '#34c759', color: 'white', '&:hover': { bgcolor: '#2da44e' } }}
                                                                >
                                                                    <PlayArrowIcon sx={{ fontSize: 14 }} />
                                                                </IconButton>
                                                            </Tooltip>
                                                        ) : null}
                                                    </Box>
                                                </TableCell>

                                                {/* Delete */}
                                                <TableCell align="center" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => onDeleteTask(st.id)}
                                                        sx={{ opacity: 0.4, '&:hover': { opacity: 1, color: '#ff3b30' } }}
                                                    >
                                                        <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}

                                    {/* Category Subtotal (only when multiple categories and not collapsed) */}
                                    {hasMultipleCategories && !collapsedCategories.has(group.key) && (
                                        <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.02) }}>
                                            <TableCell sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                                <Typography sx={{ fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT, color: '#86868b', pl: 1 }}>
                                                    Итого {group.label}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                                <Typography sx={{ fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT, color: '#6B7280' }}>
                                                    {formatCurrency(group.totalBudget)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="center" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                                <Typography sx={{ fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT, color: '#6B7280' }}>
                                                    {Math.round(group.overallPct)}%
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                                <Typography sx={{ fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT, color: '#6B7280' }}>
                                                    {formatCurrency(group.totalCompleted)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                                <Typography sx={{
                                                    fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT,
                                                    color: group.totalPaid > 0 ? '#166534' : '#6B7280',
                                                }}>
                                                    {formatCurrency(group.totalPaid)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                                <Typography sx={{
                                                    fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT,
                                                    color: group.totalDebt > 0 ? '#dc2626' : '#166534',
                                                }}>
                                                    {group.totalDebt <= 0 ? '✓' : formatCurrency(group.totalDebt)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="center" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                                <Typography sx={{ fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT, color: '#6B7280' }}>
                                                    {formatTime(group.totalEstimatedMinutes)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="center" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                                <Typography sx={{ fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT, color: '#6B7280' }}>
                                                    {formatTime(group.totalTimeMinutes)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell sx={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }} />
                                        </TableRow>
                                    )}
                                </React.Fragment>
                            ))}

                            {/* Grand Totals Row */}
                            <TableRow sx={{ bgcolor: '#f9fafb' }}>
                                <TableCell sx={{ py: 1, fontWeight: 700, fontSize: '12px', fontFamily: SF_FONT, color: '#1d1d1f' }}>
                                    ИТОГО
                                </TableCell>
                                <TableCell align="right" sx={{ py: 1 }}>
                                    <Typography sx={{ fontSize: '12px', fontWeight: 700, fontFamily: SF_FONT, color: '#1d1d1f' }}>
                                        {formatCurrency(totals.totalBudget)}
                                    </Typography>
                                </TableCell>
                                <TableCell align="center" sx={{ py: 1 }}>
                                    <Chip
                                        label={`${Math.round(totals.overallPct)}%`}
                                        size="small"
                                        sx={{
                                            height: 22, fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT,
                                            bgcolor: totals.overallPct >= 100 ? '#dcfce7' : '#eee',
                                            color: totals.overallPct >= 100 ? '#166534' : '#333',
                                        }}
                                    />
                                </TableCell>
                                <TableCell align="right" sx={{ py: 1 }}>
                                    <Typography sx={{ fontSize: '12px', fontWeight: 700, fontFamily: SF_FONT, color: totals.overallPct >= 100 ? '#166534' : '#0e7490' }}>
                                        {formatCurrency(totals.totalCompleted)}
                                    </Typography>
                                </TableCell>
                                <TableCell align="right" sx={{ py: 1 }}>
                                    <Typography sx={{
                                        fontSize: '12px', fontWeight: 700, fontFamily: SF_FONT,
                                        color: totals.totalPaid > 0 ? '#166534' : '#86868b',
                                    }}>
                                        {formatCurrency(totals.totalPaid)}
                                    </Typography>
                                </TableCell>
                                <TableCell align="right" sx={{ py: 1 }}>
                                    <Typography sx={{
                                        fontSize: '12px', fontWeight: 700, fontFamily: SF_FONT,
                                        color: totals.totalDebt <= 0 ? '#166534' : '#dc2626',
                                    }}>
                                        {totals.totalDebt <= 0 ? '✓' : formatCurrency(totals.totalDebt)}
                                    </Typography>
                                </TableCell>
                                <TableCell align="center" sx={{ py: 1 }}>
                                    <Typography sx={{ fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT, color: '#86868b' }}>
                                        {formatTime(totals.totalEstimatedMinutes)}
                                    </Typography>
                                </TableCell>
                                <TableCell align="center" sx={{ py: 1 }}>
                                    <Typography sx={{ fontSize: '11px', fontWeight: 700, fontFamily: SF_FONT, color: '#1d1d1f' }}>
                                        {formatTime(totals.totalTimeMinutes)}
                                    </Typography>
                                </TableCell>
                                <TableCell />
                            </TableRow>
                        </TableBody>
                    </Table>
                </TableContainer>

                {/* Add New Subtask */}
                {isAdding ? (
                    <AddSubtaskRow
                        newTitle={newTitle}
                        newBudget={newBudget}
                        newPlanHours={newPlanHours}
                        newCategory={newCategory}
                        setNewTitle={setNewTitle}
                        setNewBudget={setNewBudget}
                        setNewPlanHours={setNewPlanHours}
                        setNewCategory={setNewCategory}
                        onAdd={handleAddSubtask}
                        onCancel={() => setIsAdding(false)}
                    />
                ) : (
                    <Button
                        startIcon={<AddIcon />}
                        onClick={() => setIsAdding(true)}
                        size="small"
                        sx={{
                            mt: 1,
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: '12px',
                            color: '#007aff',
                            fontFamily: SF_FONT,
                            borderRadius: '8px',
                            '&:hover': { bgcolor: 'rgba(0,122,255,0.06)' },
                        }}
                    >
                        Добавить строку
                    </Button>
                )}
            </Collapse>

            {/* ═══ Payment Dialog ═══ */}
            <Dialog
                open={!!paymentDialogTask}
                onClose={closePaymentDialog}
                maxWidth="xs"
                fullWidth
                PaperProps={{ sx: { borderRadius: '14px', fontFamily: SF_FONT } }}
            >
                {paymentDialogTask && (() => {
                    const taskBudget = paymentDialogTask.budgetAmount || 0;
                    const taskPaid = paymentDialogTask.paidAmount || 0;
                    const remaining = Math.max(0, taskBudget - taskPaid);
                    return (
                        <>
                            <DialogTitle sx={{
                                fontFamily: SF_FONT, fontWeight: 700, fontSize: '16px',
                                pb: 0.5, display: 'flex', alignItems: 'center', gap: 1,
                            }}>
                                💰 Записать оплату
                            </DialogTitle>
                            <DialogContent>
                                <Box sx={{ mb: 2, mt: 1, p: 1.5, bgcolor: '#f9fafb', borderRadius: '10px' }}>
                                    <Typography sx={{ fontSize: '13px', fontWeight: 600, fontFamily: SF_FONT, color: '#1d1d1f', mb: 0.5 }}>
                                        {paymentDialogTask.title}
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 2 }}>
                                        <Typography sx={{ fontSize: '12px', fontFamily: SF_FONT, color: '#86868b' }}>
                                            Смета: <b>{formatCurrency(taskBudget)}</b>
                                        </Typography>
                                        <Typography sx={{ fontSize: '12px', fontFamily: SF_FONT, color: '#86868b' }}>
                                            Оплачено: <b>{formatCurrency(taskPaid)}</b>
                                        </Typography>
                                        {remaining > 0 && (
                                            <Typography sx={{ fontSize: '12px', fontFamily: SF_FONT, color: '#dc2626' }}>
                                                Остаток: <b>{formatCurrency(remaining)}</b>
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>

                                <TextField
                                    autoFocus
                                    fullWidth
                                    label="Сумма"
                                    type="number"
                                    value={paymentAmount}
                                    onChange={(e) => setPaymentAmount(e.target.value)}
                                    inputProps={{ min: 0, step: 100 }}
                                    InputProps={{
                                        startAdornment: <InputAdornment position="start">$</InputAdornment>,
                                    }}
                                    sx={{
                                        mb: 2,
                                        '& .MuiInputBase-input': { fontFamily: SF_FONT, fontWeight: 600 },
                                        '& .MuiOutlinedInput-root': { borderRadius: '10px' },
                                    }}
                                    helperText={remaining > 0 ? `Остаток: ${formatCurrency(remaining)}` : undefined}
                                />

                                <TextField
                                    fullWidth
                                    label="Дата"
                                    type="date"
                                    value={paymentDate}
                                    onChange={(e) => setPaymentDate(e.target.value)}
                                    sx={{
                                        mb: 2,
                                        '& .MuiInputBase-input': { fontFamily: SF_FONT },
                                        '& .MuiOutlinedInput-root': { borderRadius: '10px' },
                                    }}
                                    InputLabelProps={{ shrink: true }}
                                />

                                <FormControl fullWidth sx={{ mb: 2 }}>
                                    <Select
                                        value={paymentMethod}
                                        onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}
                                        displayEmpty
                                        sx={{
                                            fontFamily: SF_FONT, borderRadius: '10px',
                                            '& .MuiSelect-select': { fontSize: '14px' },
                                        }}
                                    >
                                        <MenuItem value="">
                                            <em>Метод оплаты (необязательно)</em>
                                        </MenuItem>
                                        {PAYMENT_METHODS.map(m => (
                                            <MenuItem key={m.value} value={m.value} sx={{ fontSize: '14px' }}>
                                                {m.emoji} {m.label}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                <TextField
                                    fullWidth
                                    label="Заметка"
                                    placeholder="Check #1234, Invoice ref, etc."
                                    value={paymentNote}
                                    onChange={(e) => setPaymentNote(e.target.value)}
                                    multiline
                                    minRows={2}
                                    sx={{
                                        '& .MuiInputBase-input': { fontFamily: SF_FONT, fontSize: '14px' },
                                        '& .MuiOutlinedInput-root': { borderRadius: '10px' },
                                    }}
                                />
                            </DialogContent>
                            <DialogActions sx={{ px: 3, pb: 2 }}>
                                <Button
                                    onClick={closePaymentDialog}
                                    sx={{
                                        textTransform: 'none', fontFamily: SF_FONT, fontWeight: 600,
                                        color: '#86868b', borderRadius: '10px',
                                    }}
                                >
                                    Отмена
                                </Button>
                                <Button
                                    variant="contained"
                                    onClick={handleSavePayment}
                                    disabled={!paymentAmount || parseFloat(paymentAmount) <= 0 || paymentSaving}
                                    sx={{
                                        textTransform: 'none', fontFamily: SF_FONT, fontWeight: 700,
                                        bgcolor: '#007aff', borderRadius: '10px', boxShadow: 'none',
                                        px: 3,
                                        '&:hover': { bgcolor: '#0066cc', boxShadow: 'none' },
                                    }}
                                >
                                    {paymentSaving ? 'Сохраняю...' : 'Записать'}
                                </Button>
                            </DialogActions>
                        </>
                    );
                })()}
            </Dialog>

            {/* ═══ Payment History Dialog ═══ */}
            <Dialog
                open={!!historyTask}
                onClose={() => setHistoryTask(null)}
                maxWidth="xs"
                fullWidth
                PaperProps={{ sx: { borderRadius: '14px', fontFamily: SF_FONT } }}
            >
                {historyTask && (() => {
                    const payments = historyTask.payments || [];
                    const taskBudget = historyTask.budgetAmount || 0;
                    const taskPaid = payments.reduce((sum, p) => sum + p.amount, 0);
                    const status = getPaymentStatus(taskBudget, taskPaid);
                    return (
                        <>
                            <DialogTitle sx={{
                                fontFamily: SF_FONT, fontWeight: 700, fontSize: '16px',
                                pb: 0.5,
                            }}>
                                📋 История оплат
                            </DialogTitle>
                            <DialogContent>
                                <Box sx={{ mb: 2, p: 1.5, bgcolor: '#f9fafb', borderRadius: '10px' }}>
                                    <Typography sx={{ fontSize: '13px', fontWeight: 600, fontFamily: SF_FONT, color: '#1d1d1f', mb: 0.5 }}>
                                        {historyTask.title}
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                        <Typography sx={{ fontSize: '12px', fontFamily: SF_FONT, color: '#86868b' }}>
                                            Смета: <b>{formatCurrency(taskBudget)}</b>
                                        </Typography>
                                        <Typography sx={{ fontSize: '12px', fontFamily: SF_FONT, color: '#86868b' }}>
                                            Оплачено: <b>{formatCurrency(taskPaid)}</b>
                                        </Typography>
                                        <Chip
                                            label={`${status.emoji} ${status.label}`}
                                            size="small"
                                            sx={{
                                                height: 20, fontSize: '10px', fontWeight: 700,
                                                bgcolor: status.bgColor, color: status.color,
                                                fontFamily: SF_FONT,
                                            }}
                                        />
                                    </Box>
                                </Box>

                                {payments.length === 0 ? (
                                    <Typography sx={{ fontSize: '13px', color: '#86868b', fontFamily: SF_FONT, textAlign: 'center', py: 3 }}>
                                        Нет записей об оплатах
                                    </Typography>
                                ) : (
                                    <List dense disablePadding>
                                        {payments
                                            .slice()
                                            .sort((a, b) => {
                                                const aMs = a.date?.toMillis?.() || 0;
                                                const bMs = b.date?.toMillis?.() || 0;
                                                return bMs - aMs;
                                            })
                                            .map((p, idx) => {
                                                const dateStr = p.date?.toDate?.()
                                                    ? p.date.toDate().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
                                                    : '—';
                                                const methodInfo = PAYMENT_METHODS.find(m => m.value === p.method);
                                                return (
                                                    <React.Fragment key={p.id}>
                                                        {idx > 0 && <Divider />}
                                                        <ListItem
                                                            sx={{ px: 0.5, py: 0.75 }}
                                                            secondaryAction={
                                                                <Tooltip title="Удалить оплату">
                                                                    <IconButton
                                                                        edge="end"
                                                                        size="small"
                                                                        onClick={() => handleDeletePayment(historyTask, p.id)}
                                                                        sx={{ opacity: 0.4, '&:hover': { opacity: 1, color: '#ff3b30' } }}
                                                                    >
                                                                        <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                                                                    </IconButton>
                                                                </Tooltip>
                                                            }
                                                        >
                                                            <ListItemText
                                                                primary={
                                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                                        <Typography sx={{ fontSize: '13px', fontWeight: 700, fontFamily: SF_FONT, color: '#1d1d1f' }}>
                                                                            {formatCurrency(p.amount)}
                                                                        </Typography>
                                                                        <Typography sx={{ fontSize: '11px', fontFamily: SF_FONT, color: '#86868b' }}>
                                                                            {dateStr}
                                                                        </Typography>
                                                                        {methodInfo && (
                                                                            <Chip
                                                                                label={`${methodInfo.emoji} ${methodInfo.label}`}
                                                                                size="small"
                                                                                sx={{
                                                                                    height: 18, fontSize: '10px',
                                                                                    bgcolor: '#f0f0f2', color: '#6B7280',
                                                                                    fontFamily: SF_FONT,
                                                                                }}
                                                                            />
                                                                        )}
                                                                    </Box>
                                                                }
                                                                secondary={p.note ? (
                                                                    <Typography sx={{ fontSize: '11px', fontFamily: SF_FONT, color: '#86868b', mt: 0.25 }}>
                                                                        {p.note}
                                                                    </Typography>
                                                                ) : undefined}
                                                            />
                                                        </ListItem>
                                                    </React.Fragment>
                                                );
                                            })}
                                    </List>
                                )}
                            </DialogContent>
                            <DialogActions sx={{ px: 3, pb: 2 }}>
                                <Button
                                    onClick={() => {
                                        setHistoryTask(null);
                                        openPaymentDialog(historyTask);
                                    }}
                                    startIcon={<AddIcon />}
                                    sx={{
                                        textTransform: 'none', fontFamily: SF_FONT, fontWeight: 600,
                                        color: '#007aff', borderRadius: '10px',
                                    }}
                                >
                                    Добавить оплату
                                </Button>
                                <Box sx={{ flex: 1 }} />
                                <Button
                                    onClick={() => setHistoryTask(null)}
                                    sx={{
                                        textTransform: 'none', fontFamily: SF_FONT, fontWeight: 600,
                                        color: '#86868b', borderRadius: '10px',
                                    }}
                                >
                                    Закрыть
                                </Button>
                            </DialogActions>
                        </>
                    );
                })()}
            </Dialog>
        </Box>
    );
};

// ═══════════════════════════════════════
// INTERNAL: Add Subtask Row
// ═══════════════════════════════════════

interface AddSubtaskRowProps {
    newTitle: string;
    newBudget: string;
    newPlanHours: string;
    newCategory: string;
    setNewTitle: (v: string) => void;
    setNewBudget: (v: string) => void;
    setNewPlanHours: (v: string) => void;
    setNewCategory: (v: string) => void;
    onAdd: () => void;
    onCancel: () => void;
}

const AddSubtaskRow: React.FC<AddSubtaskRowProps> = ({
    newTitle, newBudget, newPlanHours, newCategory,
    setNewTitle, setNewBudget, setNewPlanHours, setNewCategory,
    onAdd, onCancel,
}) => (
    <Box sx={{
        display: 'flex', gap: 1, mt: 1, p: 1,
        border: '1px dashed rgba(0,122,255,0.3)',
        borderRadius: '10px',
        bgcolor: 'rgba(0,122,255,0.02)',
        alignItems: 'center',
        flexWrap: 'wrap',
    }}>
        <TextField
            size="small"
            placeholder="Наименование работы..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
            sx={{
                flex: 2, minWidth: 150,
                '& .MuiInputBase-input': { fontSize: '13px', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' },
                '& .MuiOutlinedInput-root': { borderRadius: '8px' },
            }}
        />
        <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                displayEmpty
                sx={{
                    fontSize: '12px',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                    borderRadius: '8px',
                    '& .MuiSelect-select': { py: '7.5px' },
                }}
            >
                <MenuItem value="" sx={{ fontSize: '12px' }}>
                    <em>Категория</em>
                </MenuItem>
                {BUDGET_CATEGORIES.map(cat => (
                    <MenuItem key={cat} value={cat} sx={{ fontSize: '12px' }}>{cat}</MenuItem>
                ))}
            </Select>
        </FormControl>
        <TextField
            size="small"
            placeholder="Сумма $"
            type="number"
            value={newBudget}
            onChange={(e) => setNewBudget(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
            inputProps={{ min: 0 }}
            sx={{
                flex: 0.7, minWidth: 80,
                '& .MuiInputBase-input': { fontSize: '13px', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' },
                '& .MuiOutlinedInput-root': { borderRadius: '8px' },
            }}
        />
        <TextField
            size="small"
            placeholder="План (ч)"
            type="number"
            value={newPlanHours}
            onChange={(e) => setNewPlanHours(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
            inputProps={{ min: 0, step: 0.5 }}
            sx={{
                flex: 0.5, minWidth: 70,
                '& .MuiInputBase-input': { fontSize: '13px', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' },
                '& .MuiOutlinedInput-root': { borderRadius: '8px' },
            }}
        />
        <Button
            variant="contained"
            size="small"
            onClick={onAdd}
            disabled={!newTitle.trim()}
            sx={{
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '12px',
                borderRadius: '8px',
                bgcolor: '#007aff',
                boxShadow: 'none',
                minWidth: 'auto',
                px: 2,
                '&:hover': { bgcolor: '#0066cc', boxShadow: 'none' },
            }}
        >
            +
        </Button>
        <IconButton size="small" onClick={onCancel} sx={{ color: '#86868b' }}>
            ✕
        </IconButton>
    </Box>
);

export default GTDSubtasksTable;
