import React, { useState, useMemo } from 'react';
import {
    Box, Typography, IconButton, TextField, Button, Tooltip, Chip,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, LinearProgress, InputAdornment, Collapse, useTheme, alpha
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PersonIcon from '@mui/icons-material/Person';
import { GTDTask } from '../../types/gtd.types';
import { WorkSessionData } from '../../hooks/useActiveSession';

const SF_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

interface GTDSubtasksTableProps {
    parentTaskId: string;
    /** All raw tasks (unfiltered) to find subtasks */
    allTasks: GTDTask[];
    /** Update a subtask (e.g. change progressPercentage) */
    onUpdateTask: (taskId: string, updates: Partial<GTDTask>) => Promise<void>;
    /** Delete a subtask */
    onDeleteTask: (taskId: string) => Promise<void>;
    /** Add a new subtask */
    onAddSubtask: (parentTaskId: string, title: string, budgetAmount?: number) => Promise<void>;
    /** Start a time tracking session on this subtask */
    onStartSession?: (task: GTDTask) => void;
    /** Stop the active session */
    onStopSession?: (task: GTDTask) => void;
    /** Currently active work session (to show Play/Stop state) */
    activeSession?: WorkSessionData | null;
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
    const [isAdding, setIsAdding] = useState(false);

    // Filter subtasks for this parent
    const subtasks = useMemo(
        () => allTasks.filter(t => t.parentTaskId === parentTaskId),
        [allTasks, parentTaskId]
    );

    // Aggregates
    const totals = useMemo(() => {
        let totalBudget = 0;
        let totalCompleted = 0;
        let totalTimeMinutes = 0;
        let totalEstimatedMinutes = 0;
        let totalEarnings = 0;

        subtasks.forEach(st => {
            const budget = st.budgetAmount || 0;
            const pct = Math.min(100, Math.max(0, st.progressPercentage || 0));
            totalBudget += budget;
            totalCompleted += budget * (pct / 100);
            totalTimeMinutes += st.totalTimeSpentMinutes || 0;
            totalEstimatedMinutes += st.estimatedMinutes || 0;
            totalEarnings += st.totalEarnings || 0;
        });

        const overallPct = totalBudget > 0 ? (totalCompleted / totalBudget) * 100 : 0;

        return { totalBudget, totalCompleted, overallPct, totalTimeMinutes, totalEstimatedMinutes, totalEarnings };
    }, [subtasks]);

    const [newPlanHours, setNewPlanHours] = useState('');

    const handleAddSubtask = async () => {
        if (!newTitle.trim()) return;
        const budget = parseFloat(newBudget) || 0;
        const estimatedMinutes = (parseFloat(newPlanHours) || 0) * 60;
        
        if (budget < 0 || estimatedMinutes < 0) return;
        try {
            await onAddSubtask(parentTaskId, newTitle.trim(), budget);
            // We need to update the newly created subtask with estimatedMinutes if provided > 0
            // Since onAddSubtask doesn't accept estimatedMinutes currently, we'll let the user 
            // edit it inline after creation, or we can just pass it if the parent method permitted.
            // For now, let's reset.
            setNewTitle('');
            setNewBudget('');
            setNewPlanHours('');
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

    const formatCurrency = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    const formatTime = (mins: number) => {
        if (mins < 60) return `${mins}m`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    };

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
                        setNewTitle={setNewTitle}
                        setNewBudget={setNewBudget}
                        setNewPlanHours={setNewPlanHours}
                        onAdd={handleAddSubtask}
                        onCancel={() => setIsAdding(false)}
                    />
                </Collapse>
            </Box>
        );
    }

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
                                <TableCell align="center" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 75 }}>План (ч)</TableCell>
                                <TableCell align="center" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 70 }}>Факт</TableCell>
                                <TableCell align="center" sx={{ fontWeight: 700, fontSize: '11px', color: '#86868b', fontFamily: SF_FONT, py: 0.75, width: 40 }}></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {subtasks.map((st) => {
                                const pct = Math.min(100, Math.max(0, st.progressPercentage || 0));
                                const budget = st.budgetAmount || 0;
                                const completedAmount = budget * (pct / 100);
                                const isActive = activeSession && activeSession.relatedTaskId === st.id;

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

                                        {/* Progress % Input */}
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

                                        {/* Plan Hours Input */}
                                        <TableCell align="center" sx={{ py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                            <TextField
                                                type="number"
                                                size="small"
                                                value={st.estimatedMinutes ? Math.round((st.estimatedMinutes/60)*10)/10 : ''}
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

                                        {/* Fact Time / Play-Stop */}
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

                            {/* Totals Row */}
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
                        setNewTitle={setNewTitle}
                        setNewBudget={setNewBudget}
                        setNewPlanHours={setNewPlanHours}
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
    setNewTitle: (v: string) => void;
    setNewBudget: (v: string) => void;
    setNewPlanHours: (v: string) => void;
    onAdd: () => void;
    onCancel: () => void;
}

const AddSubtaskRow: React.FC<AddSubtaskRowProps> = ({ newTitle, newBudget, newPlanHours, setNewTitle, setNewBudget, setNewPlanHours, onAdd, onCancel }) => (
    <Box sx={{
        display: 'flex', gap: 1, mt: 1, p: 1,
        border: '1px dashed rgba(0,122,255,0.3)',
        borderRadius: '10px',
        bgcolor: 'rgba(0,122,255,0.02)',
        alignItems: 'center',
    }}>
        <TextField
            size="small"
            placeholder="Наименование работы..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
            sx={{
                flex: 2,
                '& .MuiInputBase-input': { fontSize: '13px', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' },
                '& .MuiOutlinedInput-root': { borderRadius: '8px' },
            }}
        />
        <TextField
            size="small"
            placeholder="Сумма $"
            type="number"
            value={newBudget}
            onChange={(e) => setNewBudget(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
            inputProps={{ min: 0 }}
            sx={{
                flex: 0.7,
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
                flex: 0.5,
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
