/**
 * @fileoverview AiDecomposeDialog — Phase 5.1
 *
 * Modal dialog for AI Task Decomposition. Two visual stages:
 *
 *   1. Loading: spinner while `decomposeAiTask({ taskId })` runs.
 *   2. Preview: editable list of proposed subtasks (title, description,
 *      duration, priority). Operator can tweak fields, remove rows, or
 *      cancel before clicking "Apply" which calls `confirmAiDecomposition`.
 *
 * Open the dialog with `open={true}` and pass the parent task id + title.
 * The dialog calls `decomposeAiTask` on first open and re-uses the cached
 * preview if the operator closes-and-reopens the same task within the
 * dialog lifetime.
 *
 * Calls back via `onSuccess(createdTaskIds)` so the parent page can
 * refetch the task (subtasks now appear in `subtaskIds[]` after the
 * `onTaskUpdate` rollup trigger fires).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    MenuItem,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
    confirmAiDecomposition,
    decomposeAiTask,
    type AiSubtaskPriority,
    type ProposedSubtask,
} from '../../api/aiTaskApi';

const PRIORITY_OPTIONS: AiSubtaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const PRIORITY_COLORS: Record<AiSubtaskPriority, { bg: string; fg: string }> = {
    urgent: { bg: '#FEE2E2', fg: '#991B1B' },
    high: { bg: '#FED7AA', fg: '#9A3412' },
    medium: { bg: '#FEF3C7', fg: '#92400E' },
    low: { bg: '#E0F2FE', fg: '#075985' },
};

/** Editable row state — same shape as ProposedSubtask but with a stable id. */
interface EditableSubtaskRow {
    rowId: string;
    title: string;
    description: string;
    estimatedDurationMinutes: number;
    priority: AiSubtaskPriority;
    rationale?: string;
}

function toEditable(sub: ProposedSubtask, idx: number): EditableSubtaskRow {
    return {
        rowId: `row-${idx}-${Date.now()}`,
        title: sub.title,
        description: sub.description ?? '',
        estimatedDurationMinutes: sub.estimatedDurationMinutes,
        priority: sub.priority,
        rationale: sub.rationale,
    };
}

export interface AiDecomposeDialogProps {
    open: boolean;
    parentTaskId: string;
    parentTitle: string;
    onClose: () => void;
    /** Called after subtasks are created. Receives the new task ids. */
    onSuccess: (createdTaskIds: string[]) => void;
}

export const AiDecomposeDialog: React.FC<AiDecomposeDialogProps> = ({
    open,
    parentTaskId,
    parentTitle,
    onClose,
    onSuccess,
}) => {
    const [phase, setPhase] = useState<'loading' | 'preview' | 'applying' | 'error'>(
        'loading',
    );
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [summary, setSummary] = useState<string>('');
    const [auditLogId, setAuditLogId] = useState<string | undefined>(undefined);
    const [rows, setRows] = useState<EditableSubtaskRow[]>([]);

    // Cache the last decomposition for the current taskId so close+reopen
    // doesn't burn another Claude call. Reset when the parent task changes.
    const cacheRef = useRef<{
        taskId: string;
        rows: EditableSubtaskRow[];
        summary: string;
        auditLogId?: string;
    } | null>(null);

    const fetchDecomposition = useCallback(async () => {
        setPhase('loading');
        setErrorMessage(null);
        try {
            const response = await decomposeAiTask({ taskId: parentTaskId });
            if (!response.success) {
                setPhase('error');
                setErrorMessage(
                    response.error ||
                        'AI returned an invalid response. Please try again.',
                );
                return;
            }
            const next = response.proposedSubtasks.map(toEditable);
            setRows(next);
            setSummary(response.summary);
            setAuditLogId(response.auditLogId);
            cacheRef.current = {
                taskId: parentTaskId,
                rows: next,
                summary: response.summary,
                auditLogId: response.auditLogId,
            };
            setPhase('preview');
        } catch (err) {
            const message =
                err instanceof Error ? err.message : 'Decomposition failed';
            setPhase('error');
            setErrorMessage(message);
        }
    }, [parentTaskId]);

    // Open trigger: load fresh OR restore from cache (same task id).
    useEffect(() => {
        if (!open) return;
        if (cacheRef.current && cacheRef.current.taskId === parentTaskId) {
            setRows(cacheRef.current.rows);
            setSummary(cacheRef.current.summary);
            setAuditLogId(cacheRef.current.auditLogId);
            setPhase('preview');
            return;
        }
        fetchDecomposition();
    }, [open, parentTaskId, fetchDecomposition]);

    const updateRow = (rowId: string, patch: Partial<EditableSubtaskRow>) => {
        setRows((prev) =>
            prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
        );
    };

    const removeRow = (rowId: string) => {
        setRows((prev) => prev.filter((r) => r.rowId !== rowId));
    };

    const totalMinutes = useMemo(
        () => rows.reduce((acc, r) => acc + (r.estimatedDurationMinutes || 0), 0),
        [rows],
    );

    const canApply =
        rows.length > 0 &&
        rows.every(
            (r) =>
                r.title.trim().length > 0 &&
                r.estimatedDurationMinutes >= 5 &&
                r.estimatedDurationMinutes <= 60 * 24 * 7,
        );

    const handleApply = async () => {
        if (!canApply) return;
        setPhase('applying');
        setErrorMessage(null);
        try {
            const response = await confirmAiDecomposition({
                parentTaskId,
                auditLogId,
                subtasks: rows.map((r) => ({
                    title: r.title.trim(),
                    description: r.description.trim() || undefined,
                    estimatedDurationMinutes: r.estimatedDurationMinutes,
                    priority: r.priority,
                })),
            });
            // Cache invalidated — fresh decomposition next time.
            cacheRef.current = null;
            onSuccess(response.createdTaskIds);
            onClose();
        } catch (err) {
            const message =
                err instanceof Error ? err.message : 'Failed to create subtasks';
            setPhase('preview');
            setErrorMessage(message);
        }
    };

    const handleClose = () => {
        if (phase === 'applying') return;
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="md"
            fullWidth
            aria-labelledby="ai-decompose-dialog-title"
        >
            <DialogTitle
                id="ai-decompose-dialog-title"
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    pr: 6,
                    background:
                        'linear-gradient(135deg, rgba(124,58,237,0.06) 0%, rgba(37,99,235,0.06) 100%)',
                }}
            >
                <AutoAwesomeIcon sx={{ color: '#7c3aed' }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        variant="h6"
                        component="div"
                        sx={{ fontWeight: 600, lineHeight: 1.2 }}
                    >
                        Decompose with AI
                    </Typography>
                    <Typography
                        variant="caption"
                        sx={{ color: '#6B7280', display: 'block' }}
                        noWrap
                    >
                        Parent: {parentTitle}
                    </Typography>
                </Box>
            </DialogTitle>

            <DialogContent dividers sx={{ p: 0 }}>
                {phase === 'loading' && (
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            py: 8,
                            gap: 2,
                        }}
                    >
                        <CircularProgress />
                        <Typography variant="body2" color="text.secondary">
                            Claude is splitting the task into subtasks…
                        </Typography>
                    </Box>
                )}

                {phase === 'error' && (
                    <Box sx={{ p: 3 }}>
                        <Alert
                            severity="error"
                            action={
                                <Button
                                    size="small"
                                    onClick={fetchDecomposition}
                                    color="inherit"
                                >
                                    Retry
                                </Button>
                            }
                        >
                            {errorMessage ?? 'AI decomposition failed'}
                        </Alert>
                    </Box>
                )}

                {(phase === 'preview' || phase === 'applying') && (
                    <Box sx={{ p: { xs: 2, md: 3 } }}>
                        {summary && (
                            <Alert
                                severity="info"
                                icon={<AutoAwesomeIcon fontSize="small" />}
                                sx={{ mb: 2 }}
                            >
                                {summary}
                            </Alert>
                        )}

                        {errorMessage && (
                            <Alert severity="error" sx={{ mb: 2 }}>
                                {errorMessage}
                            </Alert>
                        )}

                        <Stack
                            direction="row"
                            alignItems="center"
                            justifyContent="space-between"
                            sx={{ mb: 2 }}
                        >
                            <Typography variant="subtitle2" sx={{ color: '#374151' }}>
                                {rows.length} subtask{rows.length === 1 ? '' : 's'} ·{' '}
                                {Math.round(totalMinutes / 60)}h{' '}
                                {totalMinutes % 60 ? `${totalMinutes % 60}m` : ''} total
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{ color: '#9CA3AF', fontStyle: 'italic' }}
                            >
                                Edit any field before applying
                            </Typography>
                        </Stack>

                        <Stack spacing={1.5}>
                            {rows.map((row, idx) => {
                                const priorityStyle =
                                    PRIORITY_COLORS[row.priority] ??
                                    PRIORITY_COLORS.medium;
                                const titleInvalid = row.title.trim().length === 0;
                                const durationInvalid =
                                    !Number.isFinite(row.estimatedDurationMinutes) ||
                                    row.estimatedDurationMinutes < 5 ||
                                    row.estimatedDurationMinutes > 60 * 24 * 7;
                                return (
                                    <Box
                                        key={row.rowId}
                                        sx={{
                                            p: 2,
                                            border: '1px solid #E5E7EB',
                                            borderRadius: 2,
                                            bgcolor: '#FAFAFA',
                                        }}
                                    >
                                        <Stack
                                            direction="row"
                                            spacing={1}
                                            alignItems="flex-start"
                                            sx={{ mb: 1.5 }}
                                        >
                                            <Chip
                                                label={`#${idx + 1}`}
                                                size="small"
                                                sx={{
                                                    bgcolor: '#E5E7EB',
                                                    color: '#374151',
                                                    fontWeight: 600,
                                                    flexShrink: 0,
                                                    mt: 1,
                                                }}
                                            />
                                            <TextField
                                                value={row.title}
                                                onChange={(e) =>
                                                    updateRow(row.rowId, {
                                                        title: e.target.value,
                                                    })
                                                }
                                                placeholder="Subtask title"
                                                size="small"
                                                fullWidth
                                                error={titleInvalid}
                                                helperText={
                                                    titleInvalid
                                                        ? 'Title is required'
                                                        : undefined
                                                }
                                                disabled={phase === 'applying'}
                                                sx={{
                                                    '& .MuiInputBase-input': {
                                                        fontWeight: 600,
                                                        fontSize: '0.95rem',
                                                    },
                                                }}
                                            />
                                            <Tooltip title="Remove">
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() =>
                                                            removeRow(row.rowId)
                                                        }
                                                        disabled={phase === 'applying'}
                                                    >
                                                        <DeleteOutlineIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </Stack>

                                        <TextField
                                            value={row.description}
                                            onChange={(e) =>
                                                updateRow(row.rowId, {
                                                    description: e.target.value,
                                                })
                                            }
                                            placeholder="Description (optional)"
                                            size="small"
                                            fullWidth
                                            multiline
                                            minRows={1}
                                            maxRows={4}
                                            disabled={phase === 'applying'}
                                            sx={{ mb: 1.5 }}
                                        />

                                        <Stack
                                            direction="row"
                                            spacing={1.5}
                                            alignItems="center"
                                            flexWrap="wrap"
                                        >
                                            <TextField
                                                label="Duration (min)"
                                                type="number"
                                                size="small"
                                                value={row.estimatedDurationMinutes}
                                                onChange={(e) =>
                                                    updateRow(row.rowId, {
                                                        estimatedDurationMinutes:
                                                            Number(e.target.value),
                                                    })
                                                }
                                                slotProps={{
                                                    htmlInput: {
                                                        min: 5,
                                                        max: 60 * 24 * 7,
                                                        step: 15,
                                                    },
                                                }}
                                                error={durationInvalid}
                                                helperText={
                                                    durationInvalid
                                                        ? '5 min – 7 days'
                                                        : undefined
                                                }
                                                disabled={phase === 'applying'}
                                                sx={{ width: 140 }}
                                            />
                                            <TextField
                                                label="Priority"
                                                select
                                                size="small"
                                                value={row.priority}
                                                onChange={(e) =>
                                                    updateRow(row.rowId, {
                                                        priority: e.target
                                                            .value as AiSubtaskPriority,
                                                    })
                                                }
                                                disabled={phase === 'applying'}
                                                sx={{ width: 140 }}
                                            >
                                                {PRIORITY_OPTIONS.map((p) => (
                                                    <MenuItem key={p} value={p}>
                                                        {p}
                                                    </MenuItem>
                                                ))}
                                            </TextField>
                                            <Chip
                                                label={row.priority}
                                                size="small"
                                                sx={{
                                                    bgcolor: priorityStyle.bg,
                                                    color: priorityStyle.fg,
                                                    fontWeight: 600,
                                                }}
                                            />
                                        </Stack>

                                        {row.rationale && (
                                            <>
                                                <Divider sx={{ my: 1.5 }} />
                                                <Typography
                                                    variant="caption"
                                                    sx={{
                                                        color: '#6B7280',
                                                        fontStyle: 'italic',
                                                    }}
                                                >
                                                    💡 {row.rationale}
                                                </Typography>
                                            </>
                                        )}
                                    </Box>
                                );
                            })}
                        </Stack>

                        {rows.length === 0 && (
                            <Alert severity="warning" sx={{ mt: 2 }}>
                                No subtasks left. Re-run the decomposition or close.
                            </Alert>
                        )}
                    </Box>
                )}
            </DialogContent>

            <DialogActions sx={{ px: 3, py: 2 }}>
                <Button
                    onClick={handleClose}
                    disabled={phase === 'applying'}
                    color="inherit"
                >
                    Cancel
                </Button>
                <Box sx={{ flex: 1 }} />
                <Button
                    onClick={fetchDecomposition}
                    disabled={phase === 'loading' || phase === 'applying'}
                    variant="text"
                >
                    Re-generate
                </Button>
                <Button
                    onClick={handleApply}
                    variant="contained"
                    disabled={!canApply || phase !== 'preview'}
                    startIcon={
                        phase === 'applying' ? (
                            <CircularProgress size={16} color="inherit" />
                        ) : (
                            <AutoAwesomeIcon />
                        )
                    }
                    sx={{
                        background:
                            'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)',
                        '&:hover': {
                            background:
                                'linear-gradient(135deg, #6d28d9 0%, #1d4ed8 100%)',
                        },
                    }}
                >
                    {phase === 'applying'
                        ? 'Creating subtasks…'
                        : `Apply (${rows.length})`}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AiDecomposeDialog;
